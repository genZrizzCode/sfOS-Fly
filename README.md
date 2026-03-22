# sfOS

This project is a macOS-inspired web OS concept with a built-in routing demo. The UI includes a dock, menu bar, draggable windows, and a Deoxy Center that simulates system-wide routing. The project includes client-side Scramjet proxying for in-app browsing, plus a server-side Deoxy proxy for `/deoxy?target=...`.

## Open locally (static demo)

Open `index.html` directly in a browser for the UI demo only, or run a local server for Scramjet's service worker:

`python3 -m http.server 5173`

Then visit `http://localhost:5173`.

For the Deoxy proxy locally, run the Node server:

`node server.js`

Then visit `http://localhost:8443`.

## Deploy to Cloudflare Pages (with proxy)

sfOS can run on Cloudflare Pages. Scramjet is served as static assets, while Deoxy runs in a Pages Function.

### Structure

- Static files: `index.html`, `styles.css`, `app.js`, `scramjet/*`, etc.
- Deoxy function: `functions/deoxy.js` (Cloudflare Pages Function).
- Session counter: `functions/session.js` (Cloudflare Pages Function, uses D1 if available).
- Latency probe: `functions/ping.js`.

The Nebula Tunnel uses Scramjet when Deoxy is enabled. If Scramjet is unavailable, it opens the direct URL.

### Basic deployment steps

1. Push this project to a Git repository (GitHub, GitLab, etc.).
2. In Cloudflare Pages, create a new project from that repo.
3. Build settings:
  - **Framework preset**: None
  - **Build command**: leave empty (or `npm run build` if you add one later)
  - **Build output directory**: the folder containing `index.html` (for this prototype, the repo root that has `index.html` and the `functions/` directory).
4. Deploy.

Once deployed:

- Visit your `*.pages.dev` URL (or custom domain).
- Open **Nebula Tunnel** inside sfOS, enter a site (e.g. `example.com`), and click **Tunnel**.
- A new tab will open with a Scramjet URL on your Pages domain.
- The Deoxy endpoint is still available at `/deoxy?target=...`.

## Notes

- The UI and tunnel status are simulated in `app.js`.
- Scramjet uses Bare-Mux with the Epoxy transport and the Wisp endpoint `wss://wisp.mercurywork.shop/`. If that endpoint is blocked, Scramjet can fail and the app will open direct links instead.
- Update the endpoint, mode, and toggle in the Deoxy Center to see changes reflected across the UI.
- Menu bar time shows seconds and syncs to WorldTimeAPI every 10 minutes with device-time fallback.
- Menu bar battery uses the browser Battery API when available.
- Menu bar network shows Online/Offline based on browser connection events.
- Window content scrolls automatically when the window height is too small to fit the sub-app content.
- Session number uses Cloudflare D1 in production. The function will create the table on first request if `DB` is bound. If D1 is missing, it returns `{ count: null, error: "D1 not configured" }`.

Optional D1 setup (if you want to precreate the table):

```sql
CREATE TABLE IF NOT EXISTS deoxy_sessions (id INTEGER PRIMARY KEY CHECK (id = 1), count INTEGER NOT NULL);
INSERT OR IGNORE INTO deoxy_sessions (id, count) VALUES (1, 0);
```
