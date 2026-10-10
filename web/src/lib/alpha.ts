// Stored with every consent. Change it whenever the consent wording on
// /alpha changes, so each consent record names the text the user agreed to.
export const ALPHA_FORM_VERSION = "2026-10-alpha-v1";

export const ALPHA_PAGE_PATH = "/alpha";

const PENDING_JOIN_KEY = "treq.alphaPendingJoin";

// A consent given before sign-in only counts if the user comes back soon
// after, in the same tab.
const PENDING_JOIN_MAX_AGE_MS = 30 * 60 * 1000;

export interface PendingJoin {
  formVersion: string;
  sourcePage: string;
  consentedAt: number;
}

/**
 * The page that sent the visitor to /alpha (`?from=/roadmap`), else /alpha.
 * Only a plain site path is kept, so nothing else can end up in the row.
 */
export function alphaSourcePage(search: string): string {
  const from = new URLSearchParams(search).get("from");
  return from && /^\/[\w\-/]{0,200}$/.test(from) ? from : ALPHA_PAGE_PATH;
}

/** Sign-in link that brings the visitor back to /alpha to finish joining. */
export function alphaSignInHref(): string {
  return `/sign-in?redirect=${encodeURIComponent(ALPHA_PAGE_PATH)}`;
}

/**
 * Remember that a signed-out visitor ticked the consent box, so /alpha can
 * finish the join after sign-in. Returns false when storage is unavailable.
 */
export function stashPendingJoin(
  storage: Storage | undefined,
  sourcePage: string,
  now: number = Date.now(),
): boolean {
  const entry: PendingJoin = {
    formVersion: ALPHA_FORM_VERSION,
    sourcePage,
    consentedAt: now,
  };
  try {
    storage?.setItem(PENDING_JOIN_KEY, JSON.stringify(entry));
    return storage !== undefined;
  } catch {
    return false;
  }
}

/**
 * Read and remove a pending join. Returns null when there is none, it is
 * malformed, it was given for an older consent wording, or it is stale.
 */
export function takePendingJoin(
  storage: Storage | undefined,
  now: number = Date.now(),
): PendingJoin | null {
  let raw: string | null = null;
  try {
    raw = storage?.getItem(PENDING_JOIN_KEY) ?? null;
    storage?.removeItem(PENDING_JOIN_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const entry = JSON.parse(raw) as Partial<PendingJoin>;
    if (
      entry.formVersion !== ALPHA_FORM_VERSION ||
      typeof entry.sourcePage !== "string" ||
      typeof entry.consentedAt !== "number" ||
      now - entry.consentedAt > PENDING_JOIN_MAX_AGE_MS ||
      now < entry.consentedAt
    ) {
      return null;
    }
    return {
      formVersion: entry.formVersion,
      sourcePage: alphaSourcePage(`?from=${encodeURIComponent(entry.sourcePage)}`),
      consentedAt: entry.consentedAt,
    };
  } catch {
    return null;
  }
}

/** sessionStorage, or undefined when the browser blocks it. */
export function sessionStore(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.sessionStorage;
  } catch {
    return undefined;
  }
}
