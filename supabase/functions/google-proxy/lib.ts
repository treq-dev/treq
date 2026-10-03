// Request logic for the google-proxy Edge Function, kept free of Deno and
// Supabase imports so it runs under the repo's unit tests.

export type StoredToken = {
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
  updated_at: string;
};

export type TokenUpdate = Omit<StoredToken, "updated_at">;

export interface TokenStore {
  load(): Promise<StoredToken | null>;
  save(update: TokenUpdate): Promise<void>;
}

export interface ProxyDeps {
  store: TokenStore;
  /** Whether the user has an active Pro plan; the proxy is Pro-only. */
  isPro: () => Promise<boolean>;
  fetch: typeof fetch;
  googleClient: { id: string; secret: string } | null;
  now?: () => number;
}

export type ProxyRequest = {
  /** `"status"` reports whether the user has linked Google; nothing is forwarded. */
  op?: "status";
  method?: string;
  url?: string;
  body?: unknown;
};

export type ProxyResult = {
  status: number;
  body: string;
  contentType: string;
};

export const PRO_REQUIRED_MESSAGE =
  "Connecting Google through treq needs an active Pro plan. Use your own OAuth client in Settings instead.";

export const RECONNECT_MESSAGE =
  "Google authorization expired. Reconnect Google Workspace in treq settings.";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REFRESH_MARGIN_MS = 60_000;
const SEGMENT = "[A-Za-z0-9_-]+";
const TASKS = "https://tasks.googleapis.com/tasks/v1";
const DRIVE = "https://www.googleapis.com/drive/v3";

// Exactly the calls the desktop app makes, by method and path. Anything
// else (deleting or sharing Drive files, other Google APIs) is refused, so a
// stolen treq session cannot be turned into general access to the grant.
const ALLOWED_ENDPOINTS: { method: string; path: RegExp }[] = [
  ["GET", `${TASKS}/users/@me/lists`],
  ["POST", `${TASKS}/users/@me/lists`],
  ["GET", `${TASKS}/lists/${SEGMENT}/tasks`],
  ["POST", `${TASKS}/lists/${SEGMENT}/tasks`],
  ["PATCH", `${TASKS}/lists/${SEGMENT}/tasks/${SEGMENT}`],
  ["DELETE", `${TASKS}/lists/${SEGMENT}/tasks/${SEGMENT}`],
  ["POST", `${TASKS}/lists/${SEGMENT}/tasks/${SEGMENT}/move`],
  ["GET", `${DRIVE}/files`],
  ["GET", `${DRIVE}/files/${SEGMENT}`],
  ["GET", `${DRIVE}/files/${SEGMENT}/export`],
  ["POST", `${DRIVE}/files/${SEGMENT}/comments`],
].map(([method, path]) => ({
  method,
  path: new RegExp(`^${path.replace(/[.]/g, "\\.")}$`),
}));

function json(body: unknown, status: number): ProxyResult {
  return {
    status,
    body: JSON.stringify(body),
    contentType: "application/json",
  };
}

export function isAllowedRequest(method: string, raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.username || url.password || url.hash) return false;
  // `new URL` has already resolved dot segments, so `files/../x` cannot
  // slip past the anchored patterns.
  const target = `${url.origin}${url.pathname}`;
  return ALLOWED_ENDPOINTS.some(
    (endpoint) => endpoint.method === method && endpoint.path.test(target),
  );
}

function needsRefresh(token: StoredToken, now: number): boolean {
  if (!token.expires_at) return false;
  return Date.parse(token.expires_at) - now < REFRESH_MARGIN_MS;
}

async function refreshToken(
  token: StoredToken,
  deps: ProxyDeps,
  now: number,
): Promise<string | null> {
  if (!token.refresh_token || !deps.googleClient) return null;
  const res = await deps.fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: deps.googleClient.id,
      client_secret: deps.googleClient.secret,
      refresh_token: token.refresh_token,
      grant_type: "refresh_token",
    }).toString(),
  });
  if (!res.ok) {
    console.error("[google-proxy] token refresh failed:", res.status);
    return null;
  }
  const grant = await res.json();
  if (!grant.access_token) return null;
  try {
    await deps.store.save({
      access_token: grant.access_token,
      // Google usually omits the refresh token on refresh; keep the old one.
      refresh_token: grant.refresh_token ?? token.refresh_token,
      expires_at: grant.expires_in
        ? new Date(now + grant.expires_in * 1000).toISOString()
        : null,
    });
  } catch (err) {
    console.error(
      "[google-proxy] storing refreshed token failed:",
      String(err),
    );
  }
  return grant.access_token as string;
}

export async function proxyGoogleRequest(
  request: ProxyRequest,
  deps: ProxyDeps,
): Promise<ProxyResult> {
  let pro: boolean;
  try {
    pro = await deps.isPro();
  } catch (err) {
    console.error("[google-proxy] plan lookup failed:", String(err));
    return json({ error: "Failed to check your plan" }, 500);
  }
  if (!pro) return json({ error: PRO_REQUIRED_MESSAGE }, 403);
  if (request.op === "status") {
    try {
      return json({ linked: (await deps.store.load()) !== null }, 200);
    } catch (err) {
      console.error("[google-proxy] token lookup failed:", String(err));
      return json({ error: "Failed to retrieve Google token" }, 500);
    }
  }
  const method = (request.method ?? "GET").toUpperCase();
  if (!request.url || !isAllowedRequest(method, request.url)) {
    return json({ error: "Request not allowed" }, 400);
  }
  const now = (deps.now ?? Date.now)();

  let token: StoredToken | null;
  try {
    token = await deps.store.load();
  } catch (err) {
    console.error("[google-proxy] token lookup failed:", String(err));
    return json({ error: "Failed to retrieve Google token" }, 500);
  }
  if (!token) return json({ error: "Google account not linked" }, 403);

  try {
    let accessToken = token.access_token;
    if (needsRefresh(token, now)) {
      const refreshed = await refreshToken(token, deps, now);
      if (!refreshed) return json({ error: RECONNECT_MESSAGE }, 401);
      accessToken = refreshed;
    }
    const hasBody = request.body !== undefined && request.body !== null;
    const response = await deps.fetch(request.url, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(hasBody ? { "Content-Type": "application/json" } : {}),
      },
      body: hasBody ? JSON.stringify(request.body) : undefined,
    });
    if (response.status === 401) {
      return json({ error: RECONNECT_MESSAGE }, 401);
    }
    return {
      status: response.status,
      body: await response.text(),
      contentType: response.headers.get("content-type") ?? "application/json",
    };
  } catch (err) {
    console.error("[google-proxy] request failed:", String(err));
    return json({ error: "Failed to proxy Google request" }, 502);
  }
}
