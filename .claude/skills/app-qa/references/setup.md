# First-time environment setup (fresh sandbox/container)

Part of the `app-qa` skill.

A clean checkout is missing several things `npm run screenshot`/`build:napi` need.
Do this once per fresh environment, before step 4 of `SKILL.md`. Skip whatever is already
present (`node_modules/`, a working `cargo check`, etc.).

1. **Node deps**: `npm install` if `node_modules/` doesn't exist yet.

2. **Native build deps for the Tauri/GTK backend** (Linux sandboxes typically lack
   these): `libgtk-3-dev`, `libsoup-3.0-dev`, `libjavascriptcoregtk-4.1-dev`,
   `libwebkit2gtk-4.1-dev`. Install with `apt-get install -y <package>`; if apt
   reports unmet dependencies or 404s on individual `.deb`s, run `apt-get update`
   and then `apt-get install -y --fix-broken` to pull the rest in — a stale package
   index is the usual cause, not a real missing package.

3. **CA trust for the outbound proxy** (if the session runs behind the agent proxy
   described in `/root/.ccr/README.md`): the proxy's CA is dropped into
   `/usr/local/share/ca-certificates/` at container start, but the compiled system
   bundle (`/etc/ssl/certs/ca-certificates.crt`) can be stale. If a `cargo build`
   fails with a TLS error like `invalid peer certificate: UnknownIssuer` while
   fetching a crate's build-time download, run `update-ca-certificates --fresh` and
   retry — most such failures are this, not a real network block.
