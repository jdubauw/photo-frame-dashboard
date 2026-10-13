# React household dashboard

Runtime variables are managed in the Cloudflare dashboard. `keep_vars: true`
preserves dashboard-set values such as `GOOGLE_CLIENT_ID` on deployment, and the
configuration-generation test verifies that this reaches the production config.
Wrangler also preserves existing encrypted secrets on normal deployments. This
workflow does not upload, replace, delete, or rotate runtime secrets. CI's local
test credentials are removed before the deployment step. Keep the existing
`TOKEN_ENCRYPTION_KEY` stable so stored account tokens remain decryptable.

The frame opens `/`; browser editing is at `/admin`. React retains Wes's paper/ink palette, large clock, serif headlines, golden event panel, and sidebar. JavaScript targets Chromium 106 and CSS targets Chrome 61 for frame compatibility. The Worker serves the app and private API. D1 stores household data, points, encrypted integration credentials, and revocable sessions. Production starts empty.

## Cloudflare setup

1. Create a D1 database named **household** in Cloudflare, or run `npx wrangler d1 create household` from this directory.
2. Add its UUID to GitHub Actions secrets as `CLOUDFLARE_D1_DATABASE_ID`, alongside the existing account ID and API token. The token also needs D1 migration permissions for this database.
3. Merge the implementation branch. Actions builds, tests, applies migrations, and deploys. The all-zero database ID in tracked configuration is for local development; production deployment rejects it. An ignored `wrangler.deploy.json` is generated from the secret.
4. After the first deployment, add Worker runtime secrets under **Workers → home-dashboard → Settings → Variables and Secrets**:

| Secret                 | Purpose                                                   |
| ---------------------- | --------------------------------------------------------- |
| `ADMIN_PASSWORD`       | Strong household password for browser editing             |
| `TOKEN_ENCRYPTION_KEY` | Base64-encoded 32-byte AES key; keep stable and backed up |
| `GOOGLE_CLIENT_ID`     | Google OAuth web application's client ID                  |
| `GOOGLE_CLIENT_SECRET` | That client's secret                                      |

Generate an encryption key with `openssl rand -base64 32` and enter it directly as a Worker secret. Never commit it or send it in chat. Rotating this key without re-encrypting stored tokens breaks existing connections. These runtime secrets are separate from GitHub deployment credentials. Login fails closed until an admin password is configured.

Use Actions as the deployment source; disable duplicate Cloudflare Git-connected builds if enabled. For terminal deployment, export the three Cloudflare deployment variables and run `npm run deploy`. That applies the D1 migration and deploys, but does not provision runtime secrets.

## Connect your Google calendars

1. Create a Google Cloud project and enable **Google Calendar API**.
2. Configure the OAuth consent screen. In Testing mode, add both partners as test users. Calendar refresh tokens expire after seven days in Testing mode; configure the appropriate production consent status for ongoing use.
3. Create an OAuth **Web application** client. Add the exact redirect URI `https://YOUR-WORKER-URL/api/admin/google/callback`.
4. Set the Google client ID and secret on the Worker.
5. In `/admin`, add family members and colors. Open **Calendars**, choose a member, connect that person's Google account, and select calendars. Repeat for the other account using Google's account chooser.

The app requests `calendar.readonly` plus identity/email and never modifies Google events. Google expands recurrence; all-day end dates are exclusive. Reads are cached for five minutes. Refresh integrations clears the cache. Failed refreshes show the saved data and an explicit stale-data error.

References: [OAuth server flow](https://developers.google.com/identity/protocols/oauth2/web-server), [Calendar scopes](https://developers.google.com/workspace/calendar/api/auth).

## Family, chores, and points

Edit these in `/admin`. Chores recur daily, weekly (anchored to the start date), or once, using the household timezone. Completion awards points once per chore per period. Repeated taps cannot double-award points. History snapshots the title and points; Undo removes that completion and its awarded points. Archiving preserves history. Archiving a person unassigns their chores and disconnects their Google account.

The frame is display-only by default. **Display → Allow chore completion on the frame** enables completion and points, but never editing. The browser always supports completion. Points are an accumulating score; reward redemption is not implemented.

## One shared Google Photos album

Paste the album's shared link under **Photos** and enable link sharing in Google Photos. Choose shuffle and timing. The backend validates redirects, extracts image URLs from the shared page, and caches them for 20 minutes.

This is an unofficial adapter, not a supported Google album-sync API. It reads up to 500 image URLs without pagination. Large albums or Google page-format changes can require additional parsing. Errors are visible and cached URLs remain available. Broken images have an explicit fallback. Test your real album before relying on refresh. Photos are not copied to R2; offline slideshow is not guaranteed.

Anyone possessing the original shared link can view the Google album. Keep it in private admin settings, not source or public issues.

## Home Assistant

Under **Home**, enter an externally reachable HTTPS base URL exposing HA's standard REST API, a long-lived access token, and selected entity IDs (one per line). Credentials are encrypted in D1 and never returned to clients. The backend reads `/api/states/<entity_id>` and shows actual states, names, units, and temperatures when available, refreshing every 30 seconds.

Lights and switches support on/off, scenes and scripts support activation, covers support open/close/stop, and climate entities support a target temperature within the limits reported by HA. Enable **Allow Home Assistant controls on the frame** to allow display sessions to send those commands. Commands are restricted to selected entities and fixed actions; arbitrary service calls, unlocking, camera streaming, and Lovelace layout replication are not implemented. Controls have not been tested against a real HA endpoint yet. An endpoint with a different API contract needs an adapter once its contract is known. Cloudflare cannot reach a local-only HA address. [Home Assistant API](https://developers.home-assistant.io/docs/api/rest/).

## Pair the frame

In `/admin`, open **Display → Generate pairing code**. Enter the code on the frame. It expires in ten minutes and works once. Display sessions last a year and can be revoked together; admin sessions last 30 days. Cookies are HttpOnly and Secure on HTTPS. Writes require the same origin; password/pairing attempts are rate limited.

Save the deployed URL using `adb -d shell am start -n com.wesbos.homehq/.MainActivity --es url https://YOUR-WORKER-URL/`. The frame receives browser edits on its 30-second refresh, subject to calendar/photo caching. Google sign-in is performed in your browser, not inside Android WebView.

## Local development and validation

Use Node 24. Copy `.dev.vars.example` to ignored `.dev.vars`, choose a local password, and generate a separate development encryption key. Run these from `dashboard/`:

    npm ci
    npm run build
    npm run db:local
    npm run dev:api

Open `http://127.0.0.1:8787/admin`. For hot reload, run `npm run dev` in another terminal; Vite proxies `/api` to the Worker.

    npm run check
    npm test
    npm run test:integration
    npx wrangler deploy --dry-run

Integration checks require the isolated local Worker to be running. They create/archive explicitly named test records, remove awarded test points, and revoke local display sessions. Never run them against production.

## Verification and remaining setup

Build, dry run, local D1 migration, domain tests, and API tests passed. Tests cover timezone/recurrence, invalid dates, album restrictions/parser, auth/CSRF, role separation, single-use pairing, duplicate points, undo, archive history, and revocation. Browser editing and points were tested interactively. React was paired and rendered on the actual Runxion RK3326 / Android 8.1 / WebView 106 frame using isolated preview data over USB.

Real Google accounts, a real shared album, and HA require your configuration and live tests. No production migration or deployment was performed during implementation.
