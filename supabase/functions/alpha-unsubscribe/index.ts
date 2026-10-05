// One-click unsubscribe for alpha waitlist emails (prds/marketing.md, "Alpha
// waitlist"). Each email links to
//
//   <functions url>/alpha-unsubscribe?token=<alpha_waitlist.unsubscribe_token>
//
// GET (a person clicking the link) and POST (a mail provider's RFC 8058
// List-Unsubscribe-Post request) both set unsubscribed_at, which stops every
// later send. The account and the waitlist row stay, so the user can rejoin
// from the dashboard.
//
// There is no Supabase JWT on these requests (verify_jwt = false in
// config.toml); the token is the credential. Every request gets the same
// page whether or not the token exists, so the endpoint cannot be used to
// test tokens. Repeating a request changes nothing.
//
// One PostgREST call as the service role, so this uses fetch rather than
// supabase-js.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const webUrl = Deno.env.get("WEB_URL") ?? "https://treq.dev";

function page(title: string, body: string, status: number): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}</title>
<style>
body{font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5;color:#1f2937;background:#fff}
a{color:#2563eb}
@media (prefers-color-scheme:dark){body{color:#e5e7eb;background:#111827}a{color:#93c5fd}}
</style>
</head>
<body>
${body}
</body>
</html>
`;
  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      // The token is in this page's URL; never pass it on in a Referer.
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
    },
  });
}

const unsubscribed = () =>
  page(
    "Unsubscribed from Treq alpha emails",
    `<h1>You're unsubscribed</h1>
<p>Treq will not send you any more alpha emails. Your Treq account is unchanged.</p>
<p>Changed your mind? <a href="${webUrl}/dashboard?tab=alpha">Rejoin the alpha from your dashboard</a>.</p>`,
    200,
  );

const failed = () =>
  page(
    "Unsubscribe failed",
    `<h1>Something went wrong</h1>
<p>Your unsubscribe was not saved. Open the link again in a few minutes.</p>`,
    500,
  );

Deno.serve(async (req) => {
  if (req.method !== "GET" && req.method !== "POST") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { Allow: "GET, POST" },
    });
  }

  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (!UUID_RE.test(token)) return unsubscribed();

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  // The is.null filter keeps the first unsubscribe time on repeat clicks.
  // An unknown token matches no row, which is not an error.
  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/alpha_waitlist?unsubscribe_token=eq.${token}&unsubscribed_at=is.null`,
      {
        method: "PATCH",
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({ unsubscribed_at: new Date().toISOString() }),
      },
    );
    await res.body?.cancel();
    if (!res.ok) {
      console.error(`alpha-unsubscribe: update failed with HTTP ${res.status}`);
      return failed();
    }
  } catch (err) {
    console.error(`alpha-unsubscribe: update failed: ${(err as Error).message}`);
    return failed();
  }
  return unsubscribed();
});
