import {
  albumUrl,
  extractPhotos,
  localDate,
  period,
  validDate,
  type Chore,
  type Person,
  type Settings,
} from "./domain";

interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  ADMIN_PASSWORD: string;
  TOKEN_ENCRYPTION_KEY: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
}
class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const fail = (status: number, message: string): never => {
  throw new HttpError(status, message);
};
const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
const id = () => crypto.randomUUID();
const now = () => Math.floor(Date.now() / 1000);
const text = (v: unknown, max = 120) => {
  if (typeof v !== "string" || !v.trim() || v.length > max)
    fail(400, "Invalid text value.");
  return (v as string).trim();
};
const hash = async (s: string) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)),
    ),
  ]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
async function crypt(value: string, env: Env, decrypt = false) {
  if (!env.TOKEN_ENCRYPTION_KEY)
    fail(503, "Encryption key has not been configured.");
  const bytes = Uint8Array.from(atob(env.TOKEN_ENCRYPTION_KEY), (c) =>
    c.charCodeAt(0),
  );
  if (bytes.length !== 32) fail(503, "Encryption key must contain 32 bytes.");
  const key = await crypto.subtle.importKey("raw", bytes, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
  if (decrypt) {
    const input = Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
    return new TextDecoder().decode(
      await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: input.slice(0, 12) },
        key,
        input.slice(12),
      ),
    );
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(value),
    ),
  );
  return btoa(String.fromCharCode(...iv, ...encrypted));
}
async function body(req: Request) {
  if (Number(req.headers.get("Content-Length") || 0) > 32768)
    fail(413, "Request too large.");
  const s = await req.text();
  if (s.length > 32768) fail(413, "Request too large.");
  try {
    return JSON.parse(s);
  } catch {
    return fail(400, "Invalid JSON.");
  }
}
async function settings(env: Env): Promise<Settings> {
  const row = await env.DB.prepare(
    "SELECT value FROM settings WHERE id=1",
  ).first<{ value: string }>();
  return JSON.parse(row!.value);
}
async function role(req: Request, env: Env) {
  const token = req.headers
    .get("Cookie")
    ?.match(/(?:^|;\s*)hq_session=([^;]+)/)?.[1];
  if (!token) return null;
  const tokenHash = await hash(token);
  const session = await env.DB.prepare(
    "SELECT role FROM sessions WHERE token_hash=? AND expires>?",
  )
    .bind(tokenHash, now())
    .first<{ role: string }>();
  return session ? { role: session.role, hash: tokenHash } : null;
}
async function session(env: Env, role: string, req: Request) {
  const token = id() + id();
  const days = role === "display" ? 365 : 30;
  await env.DB.prepare("INSERT INTO sessions VALUES (?,?,?)")
    .bind(await hash(token), role, now() + days * 86400)
    .run();
  return jsonSession(
    role,
    `hq_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${days * 86400}${new URL(req.url).protocol === "https:" ? "; Secure" : ""}`,
  );
}
function jsonSession(role: string, cookie: string) {
  return Response.json(
    { role },
    { headers: { "Set-Cookie": cookie, "Cache-Control": "no-store" } },
  );
}
async function throttle(req: Request, env: Env) {
  const bucket = await hash(
    (req.headers.get("CF-Connecting-IP") || "local") +
      ":" +
      Math.floor(now() / 600),
  );
  const row = await env.DB.prepare(
    "INSERT INTO attempts VALUES (?,1) ON CONFLICT(bucket) DO UPDATE SET count=count+1 RETURNING count",
  )
    .bind(bucket)
    .first<{ count: number }>();
  if (row!.count > 20)
    fail(429, "Too many attempts. Try again in ten minutes.");
}
async function remoteJson(url: string, token: string) {
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15000),
    redirect: "error",
  });
  if (!r.ok) throw new Error(`Remote service returned ${r.status}.`);
  return (await r.json()) as any;
}
async function cache(
  env: Env,
  name: string,
  seconds: number,
  load: () => Promise<unknown>,
) {
  const old = await env.DB.prepare(
    "SELECT value,updated FROM integration_cache WHERE name=?",
  )
    .bind(name)
    .first<{ value: string; updated: number }>();
  if (old && now() - old.updated < seconds)
    return {
      data: JSON.parse(old.value),
      updated: old.updated,
      stale: false,
      error: null,
    };
  try {
    const data = await load();
    await env.DB.prepare(
      "INSERT INTO integration_cache VALUES (?,?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value,updated=excluded.updated",
    )
      .bind(name, JSON.stringify(data), now())
      .run();
    return { data, updated: now(), stale: false, error: null };
  } catch (e) {
    return {
      data: old ? JSON.parse(old.value) : [],
      updated: old?.updated || null,
      stale: true,
      error: e instanceof Error ? e.message : "Connection failed.",
    };
  }
}
async function googleToken(account: any, env: Env) {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID!,
      client_secret: env.GOOGLE_CLIENT_SECRET!,
      refresh_token: await crypt(account.refresh_token, env, true),
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(15000),
  });
  const data = (await r.json()) as any;
  if (!r.ok)
    throw new Error(
      "Google authorization expired. Reconnect this account in Settings.",
    );
  return data.access_token as string;
}
async function googleList(url: string, token: string, key: string) {
  let result: any[] = [];
  let next = "";
  do {
    const u = new URL(url);
    if (next) u.searchParams.set("pageToken", next);
    const data = await remoteJson(u.href, token);
    result.push(...(data[key] || []));
    next = data.nextPageToken || "";
    if (result.length > 10000) throw new Error("Calendar result is too large.");
  } while (next);
  return result;
}
async function calendar(env: Env, config: Settings, from: string, to: string) {
  const accounts = (await env.DB.prepare("SELECT * FROM google_accounts").all())
    .results;
  return await Promise.all(
    accounts.map(async (account: any) => ({
      accountId: account.id,
      email: account.email,
      ...(await cache(
        env,
        `calendar:${account.id}:${from}:${to}`,
        300,
        async () => {
          const token = await googleToken(account, env);
          const selected = JSON.parse(account.calendars) as string[];
          const lists = await Promise.all(
            selected.map(async (cid) => {
              const u = new URL(
                `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cid)}/events`,
              );
              u.search = new URLSearchParams({
                singleEvents: "true",
                orderBy: "startTime",
                timeMin: from,
                timeMax: to,
                timeZone: config.timezone,
                maxResults: "2500",
              }).toString();
              return (await googleList(u.href, token, "items"))
                .filter((x) => x.status !== "cancelled")
                .map((x) => ({
                  id: `${account.id}:${cid}:${x.id}`,
                  title: x.summary || "Busy",
                  start: x.start.dateTime || x.start.date,
                  end: x.end.dateTime || x.end.date,
                  allDay: !!x.start.date,
                  personId: account.person_id,
                  location: x.location || "",
                }));
            }),
          );
          return lists.flat();
        },
      )),
    })),
  );
}
async function photos(env: Env, config: Settings) {
  if (!config.albumUrl)
    return { data: [], updated: null, stale: false, error: null };
  return cache(env, "photos", 1200, async () => {
    let url = albumUrl(config.albumUrl);
    let response: Response | undefined;
    for (let n = 0; n < 5; n++) {
      response = await fetch(url, {
        redirect: "manual",
        headers: { "User-Agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(15000),
      });
      if (response.status >= 300 && response.status < 400) {
        const next = response.headers.get("Location");
        if (!next) throw new Error("Album redirect is invalid.");
        url = albumUrl(new URL(next, url).href);
      } else break;
    }
    if (!response?.ok)
      throw new Error("Shared album could not be loaded. Check link sharing.");
    const html = await response.text();
    if (html.length > 15000000) throw new Error("Album page is too large.");
    const images = extractPhotos(html);
    if (!images.length)
      throw new Error(
        "No images found. The album may be empty, private, or use a changed Google page format.",
      );
    return images;
  });
}
function haUrl(value: string) {
  if (!value) return "";
  const u = new URL(value);
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    /^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[)/.test(u.hostname)
  )
    fail(400, "Home Assistant must use a reachable HTTPS endpoint.");
  return u.href.replace(/\/$/, "");
}
async function home(env: Env, config: Settings) {
  if (!config.haUrl)
    return { data: [], updated: null, stale: false, error: null };
  return cache(env, "home", 30, async () => {
    const row = await env.DB.prepare("SELECT value FROM secrets WHERE name=?")
      .bind("haToken")
      .first<{ value: string }>();
    if (!row) throw new Error("Home Assistant token is missing.");
    const token = await crypt(row.value, env, true);
    return await Promise.all(
      config.haEntities.map(async (entity) => {
        const x = await remoteJson(
          `${config.haUrl}/api/states/${encodeURIComponent(entity)}`,
          token,
        );
        return {
          id: x.entity_id,
          name: x.attributes.friendly_name || x.entity_id,
          state: x.state,
          unit: x.attributes.unit_of_measurement || "",
          temperature: x.attributes.current_temperature,
          brightness: x.attributes.brightness,
          targetTemperature: x.attributes.temperature,
          minTemperature: x.attributes.min_temp,
          maxTemperature: x.attributes.max_temp,
          updated: x.last_updated,
        };
      }),
    );
  });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    if (!path.startsWith("/api/")) return env.ASSETS.fetch(req);
    try {
      if (!env.DB) fail(503, "Database binding is not configured.");
      if (req.method !== "GET" && req.headers.get("Origin") !== url.origin)
        fail(403, "Requests must come from this dashboard.");
      const user = await role(req, env);
      if (path === "/api/auth/session")
        return json({ role: user?.role || null });
      if (path === "/api/auth/login" && req.method === "POST") {
        await throttle(req, env);
        const input = await body(req);
        if (!env.ADMIN_PASSWORD) fail(503, "Admin password is not configured.");
        if (
          typeof input.password !== "string" ||
          (await hash(input.password)) !== (await hash(env.ADMIN_PASSWORD))
        )
          fail(401, "Incorrect password.");
        return session(env, "admin", req);
      }
      if (path === "/api/auth/pair" && req.method === "POST") {
        await throttle(req, env);
        const input = await body(req);
        if (typeof input.code !== "string" || !/^\d{6}$/.test(input.code))
          fail(400, "Enter the six-digit pairing code.");
        const deleted = await env.DB.prepare(
          "DELETE FROM pairing WHERE code_hash=? AND expires>? RETURNING code_hash",
        )
          .bind(await hash(input.code), now())
          .first();
        if (!deleted) fail(401, "Pairing code expired or invalid.");
        return session(env, "display", req);
      }
      if (!user) fail(401, "Sign in or pair this display.");
      if (path === "/api/auth/logout" && req.method === "POST") {
        await env.DB.prepare("DELETE FROM sessions WHERE token_hash=?")
          .bind(user!.hash)
          .run();
        return jsonSession(
          "",
          "hq_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
        );
      }
      if (path === "/api/dashboard" && req.method === "GET") {
        const config = await settings(env);
        const today = localDate(new Date(), config.timezone);
        const people = (
          await env.DB.prepare(
            "SELECT p.*,COALESCE(SUM(c.points),0) AS points FROM people p LEFT JOIN completions c ON c.person_id=p.id WHERE p.active=1 GROUP BY p.id ORDER BY p.rowid",
          ).all<Person>()
        ).results;
        const chores = (
          await env.DB.prepare(
            "SELECT * FROM chores WHERE active=1 ORDER BY rowid",
          ).all<Chore>()
        ).results;
        const completed = (
          await env.DB.prepare(
            "SELECT * FROM completions ORDER BY completed_at DESC LIMIT 2000",
          ).all()
        ).results;
        const activeChores = await Promise.all(
          chores.map(async (c) => {
            const p = period(c, today);
            const done = p
              ? await env.DB.prepare(
                  "SELECT id FROM completions WHERE chore_id=? AND period=?",
                )
                  .bind(c.id, p)
                  .first()
              : null;
            return { ...c, period: p, completed: !!done };
          }),
        );
        return json({
          settings: {
            familyName: config.familyName,
            timezone: config.timezone,
            photoSeconds: config.photoSeconds,
            shuffle: config.shuffle,
            frameCompletion: config.frameCompletion,
            homeControls: config.homeControls,
          },
          people,
          chores: activeChores,
          completions: completed,
          role: user!.role,
        });
      }
      if (path === "/api/calendar" && req.method === "GET") {
        const from = url.searchParams.get("from") || "";
        const to = url.searchParams.get("to") || "";
        if (
          !Number.isFinite(Date.parse(from)) ||
          !Number.isFinite(Date.parse(to)) ||
          Date.parse(to) <= Date.parse(from) ||
          Date.parse(to) - Date.parse(from) > 100 * 86400000
        )
          fail(400, "Calendar range must be valid and at most 100 days.");
        return json(
          await calendar(
            env,
            await settings(env),
            new Date(from).toISOString(),
            new Date(to).toISOString(),
          ),
        );
      }
      if (path === "/api/photos" && req.method === "GET")
        return json(await photos(env, await settings(env)));
      if (path === "/api/home" && req.method === "GET")
        return json(await home(env, await settings(env)));
      if (path === "/api/home/action" && req.method === "POST") {
        const config = await settings(env);
        if (user!.role !== "admin" && !config.homeControls)
          fail(403, "Home controls are disabled for this display.");
        const input = await body(req);
        const entityId = text(input.entityId);
        if (!config.haUrl || !config.haEntities.includes(entityId))
          fail(403, "Entity is not enabled in household settings.");
        const domain = entityId.split(".")[0];
        const allowed: Record<string, string[]> = {
          light: ["turn_on", "turn_off"],
          switch: ["turn_on", "turn_off"],
          scene: ["turn_on"],
          script: ["turn_on"],
          cover: ["open_cover", "close_cover", "stop_cover"],
          climate: ["set_temperature"],
        };
        if (!allowed[domain]?.includes(input.action))
          fail(400, "Unsupported Home Assistant action.");
        const row = await env.DB.prepare(
          "SELECT value FROM secrets WHERE name=?",
        )
          .bind("haToken")
          .first<{ value: string }>();
        if (!row) fail(503, "Home Assistant token is missing.");
        const token = await crypt(row!.value, env, true);
        const payload: any = { entity_id: entityId };
        if (domain === "climate") {
          const state = await remoteJson(
            `${config.haUrl}/api/states/${encodeURIComponent(entityId)}`,
            token,
          );
          const min = state.attributes.min_temp;
          const max = state.attributes.max_temp;
          if (
            !Number.isFinite(input.value) ||
            !Number.isFinite(min) ||
            !Number.isFinite(max) ||
            input.value < min ||
            input.value > max
          )
            fail(400, "Temperature is outside the thermostat limits.");
          payload.temperature = input.value;
        }
        const response = await fetch(
          `${config.haUrl}/api/services/${domain}/${input.action}`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
            redirect: "error",
            signal: AbortSignal.timeout(15000),
          },
        );
        if (!response.ok)
          fail(502, "Home Assistant did not accept the command.");
        await env.DB.prepare("DELETE FROM integration_cache WHERE name=?")
          .bind("home")
          .run();
        return json({ ok: true });
      }
      if (path === "/api/completions" && req.method === "POST") {
        const config = await settings(env);
        if (user!.role !== "admin" && !config.frameCompletion)
          fail(403, "Complete chores in the admin browser.");
        const input = await body(req);
        const chore = await env.DB.prepare(
          "SELECT * FROM chores WHERE id=? AND active=1",
        )
          .bind(text(input.choreId))
          .first<Chore>();
        if (!chore) fail(404, "Chore no longer exists.");
        const personId = chore!.person_id || text(input.personId);
        if (
          !(await env.DB.prepare(
            "SELECT id FROM people WHERE id=? AND active=1",
          )
            .bind(personId)
            .first())
        )
          fail(400, "Choose an active family member.");
        const p = period(chore!, localDate(new Date(), config.timezone));
        if (!p) fail(400, "This chore is not due yet.");
        await env.DB.prepare(
          "INSERT OR IGNORE INTO completions VALUES (?,?,?,?,?,?,?)",
        )
          .bind(
            id(),
            chore!.id,
            personId,
            p,
            chore!.points,
            chore!.title,
            new Date().toISOString(),
          )
          .run();
        return json({ ok: true });
      }
      if (user!.role !== "admin") fail(403, "Admin access required.");
      if (path === "/api/admin/settings" && req.method === "GET") {
        const secret = await env.DB.prepare(
          "SELECT name FROM secrets WHERE name=?",
        )
          .bind("haToken")
          .first();
        return json({
          ...(await settings(env)),
          haTokenConfigured: !!secret,
          googleConfigured: !!(
            env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
          ),
        });
      }
      if (path === "/api/admin/settings" && req.method === "PUT") {
        const input = await body(req);
        const config: Settings = {
          familyName: text(input.familyName),
          timezone: text(input.timezone),
          albumUrl: albumUrl(input.albumUrl || ""),
          haUrl: haUrl(input.haUrl || ""),
          haEntities: input.haEntities,
          photoSeconds: Number(input.photoSeconds),
          shuffle: !!input.shuffle,
          frameCompletion: !!input.frameCompletion,
          homeControls: !!input.homeControls,
        };
        try {
          new Intl.DateTimeFormat("en-US", {
            timeZone: config.timezone,
          }).format();
        } catch {
          fail(400, "Invalid timezone.");
        }
        if (
          !Number.isInteger(config.photoSeconds) ||
          config.photoSeconds < 5 ||
          config.photoSeconds > 300 ||
          !Array.isArray(config.haEntities) ||
          config.haEntities.length > 40 ||
          config.haEntities.some(
            (e) => typeof e !== "string" || !/^\w+\.\w+$/.test(e),
          )
        )
          fail(400, "Check photo timing and Home Assistant entity IDs.");
        const old = await settings(env);
        const statements = [
          env.DB.prepare("UPDATE settings SET value=? WHERE id=1").bind(
            JSON.stringify(config),
          ),
        ];
        if (input.haToken)
          statements.push(
            env.DB.prepare(
              "INSERT INTO secrets VALUES (?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value",
            ).bind("haToken", await crypt(text(input.haToken, 4096), env)),
          );
        if (old.albumUrl !== config.albumUrl)
          statements.push(
            env.DB.prepare("DELETE FROM integration_cache WHERE name=?").bind(
              "photos",
            ),
          );
        if (
          old.haUrl !== config.haUrl ||
          input.haToken ||
          JSON.stringify(old.haEntities) !== JSON.stringify(config.haEntities)
        )
          statements.push(
            env.DB.prepare("DELETE FROM integration_cache WHERE name=?").bind(
              "home",
            ),
          );
        await env.DB.batch(statements);
        return json({ ok: true });
      }
      if (path === "/api/admin/pairing" && req.method === "POST") {
        const n = new Uint32Array(1);
        crypto.getRandomValues(n);
        const code = String(100000 + (n[0] % 900000));
        await env.DB.prepare("DELETE FROM pairing").run();
        await env.DB.prepare("INSERT INTO pairing VALUES (?,?)")
          .bind(await hash(code), now() + 600)
          .run();
        return json({ code, expires: now() + 600 });
      }
      if (path === "/api/admin/displays" && req.method === "DELETE") {
        await env.DB.prepare("DELETE FROM sessions WHERE role='display'").run();
        return json({ ok: true });
      }
      if (path === "/api/admin/people" && req.method === "POST") {
        const input = await body(req);
        const color = text(input.color);
        if (!/^#[0-9a-fA-F]{6}$/.test(color))
          fail(400, "Choose a valid color.");
        const personId = input.id || id();
        await env.DB.prepare(
          "INSERT INTO people VALUES (?,?,?,1) ON CONFLICT(id) DO UPDATE SET name=excluded.name,color=excluded.color",
        )
          .bind(personId, text(input.name), color)
          .run();
        return json({ id: personId });
      }
      if (path.startsWith("/api/admin/people/") && req.method === "DELETE") {
        const pid = path.split("/").pop()!;
        await env.DB.batch([
          env.DB.prepare("UPDATE people SET active=0 WHERE id=?").bind(pid),
          env.DB.prepare(
            "UPDATE chores SET person_id=NULL WHERE person_id=?",
          ).bind(pid),
          env.DB.prepare("DELETE FROM google_accounts WHERE person_id=?").bind(
            pid,
          ),
        ]);
        return json({ ok: true });
      }
      if (path === "/api/admin/chores" && req.method === "POST") {
        const input = await body(req);
        if (
          !validDate(input.start_date) ||
          !["daily", "weekly", "once"].includes(input.recurrence) ||
          !Number.isInteger(input.points) ||
          input.points < 0 ||
          input.points > 1000
        )
          fail(400, "Check chore date, recurrence, and points.");
        if (
          input.person_id &&
          !(await env.DB.prepare(
            "SELECT id FROM people WHERE id=? AND active=1",
          )
            .bind(input.person_id)
            .first())
        )
          fail(400, "Choose an active family member.");
        const choreId = input.id || id();
        await env.DB.prepare(
          "INSERT INTO chores VALUES (?,?,?,?,?,?,1) ON CONFLICT(id) DO UPDATE SET title=excluded.title,person_id=excluded.person_id,points=excluded.points,recurrence=excluded.recurrence,start_date=excluded.start_date",
        )
          .bind(
            choreId,
            text(input.title),
            input.person_id || null,
            input.points,
            input.recurrence,
            input.start_date,
          )
          .run();
        return json({ id: choreId });
      }
      if (path.startsWith("/api/admin/chores/") && req.method === "DELETE") {
        await env.DB.prepare("UPDATE chores SET active=0 WHERE id=?")
          .bind(path.split("/").pop()!)
          .run();
        return json({ ok: true });
      }
      if (
        path.startsWith("/api/admin/completions/") &&
        req.method === "DELETE"
      ) {
        await env.DB.prepare("DELETE FROM completions WHERE id=?")
          .bind(path.split("/").pop()!)
          .run();
        return json({ ok: true });
      }
      if (path === "/api/admin/google" && req.method === "GET")
        return json(
          (
            await env.DB.prepare(
              "SELECT id,person_id,email,calendars FROM google_accounts",
            ).all()
          ).results.map((a: any) => ({
            ...a,
            calendars: JSON.parse(a.calendars),
          })),
        );
      if (path === "/api/admin/google/start" && req.method === "GET") {
        if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET)
          fail(503, "Configure Google OAuth credentials first.");
        const personId = url.searchParams.get("personId");
        if (
          !personId ||
          !(await env.DB.prepare(
            "SELECT id FROM people WHERE id=? AND active=1",
          )
            .bind(personId)
            .first())
        )
          fail(400, "Choose a family member.");
        const state = id();
        await env.DB.prepare("INSERT INTO oauth_states VALUES (?,?,?,?)")
          .bind(state, user!.hash, personId, now() + 600)
          .run();
        const dest = new URL("https://accounts.google.com/o/oauth2/v2/auth");
        dest.search = new URLSearchParams({
          client_id: env.GOOGLE_CLIENT_ID!,
          redirect_uri: url.origin + "/api/admin/google/callback",
          response_type: "code",
          scope:
            "openid email https://www.googleapis.com/auth/calendar.readonly",
          access_type: "offline",
          prompt: "consent select_account",
          state,
        }).toString();
        return Response.redirect(dest.href, 302);
      }
      if (path === "/api/admin/google/callback" && req.method === "GET") {
        const state = url.searchParams.get("state") || "";
        const stored = await env.DB.prepare(
          "DELETE FROM oauth_states WHERE state=? AND session_hash=? AND expires>? RETURNING person_id",
        )
          .bind(state, user!.hash, now())
          .first<{ person_id: string }>();
        if (!stored || !url.searchParams.get("code"))
          fail(400, "Google connection was cancelled or expired.");
        const r = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          body: new URLSearchParams({
            client_id: env.GOOGLE_CLIENT_ID!,
            client_secret: env.GOOGLE_CLIENT_SECRET!,
            code: url.searchParams.get("code")!,
            redirect_uri: url.origin + "/api/admin/google/callback",
            grant_type: "authorization_code",
          }),
        });
        const token = (await r.json()) as any;
        if (!r.ok || !token.refresh_token)
          fail(
            400,
            "Google did not grant offline access. Reconnect and accept calendar access.",
          );
        const profile = await remoteJson(
          "https://openidconnect.googleapis.com/v1/userinfo",
          token.access_token,
        );
        await env.DB.prepare(
          "INSERT INTO google_accounts VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET person_id=excluded.person_id,email=excluded.email,refresh_token=excluded.refresh_token",
        )
          .bind(
            profile.sub,
            stored!.person_id,
            profile.email,
            await crypt(token.refresh_token, env),
            '["primary"]',
          )
          .run();
        await env.DB.prepare("DELETE FROM integration_cache WHERE name LIKE ?")
          .bind(`calendar:${profile.sub}:%`)
          .run();
        return Response.redirect(url.origin + "/admin?connected=1", 302);
      }
      const accountMatch = path.match(
        /^\/api\/admin\/google\/([^/]+)(?:\/(calendars))?$/,
      );
      if (accountMatch) {
        const account = await env.DB.prepare(
          "SELECT * FROM google_accounts WHERE id=?",
        )
          .bind(accountMatch[1])
          .first<any>();
        if (!account) fail(404, "Account not connected.");
        if (req.method === "DELETE") {
          await env.DB.prepare("DELETE FROM google_accounts WHERE id=?")
            .bind(account!.id)
            .run();
          await env.DB.prepare(
            "DELETE FROM integration_cache WHERE name LIKE ?",
          )
            .bind(`calendar:${account!.id}:%`)
            .run();
          return json({ ok: true });
        }
        if (req.method === "GET" && accountMatch[2])
          return json(
            await googleList(
              "https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=250",
              await googleToken(account, env),
              "items",
            ),
          );
        if (req.method === "PUT") {
          const input = await body(req);
          if (
            !Array.isArray(input.calendars) ||
            input.calendars.length > 20 ||
            input.calendars.some(
              (x: unknown) => typeof x !== "string" || x.length > 300,
            )
          )
            fail(400, "Choose at most 20 calendars.");
          await env.DB.prepare(
            "UPDATE google_accounts SET calendars=? WHERE id=?",
          )
            .bind(JSON.stringify(input.calendars), account!.id)
            .run();
          await env.DB.prepare(
            "DELETE FROM integration_cache WHERE name LIKE ?",
          )
            .bind(`calendar:${account!.id}:%`)
            .run();
          return json({ ok: true });
        }
      }
      if (path === "/api/admin/refresh" && req.method === "POST") {
        await env.DB.prepare("DELETE FROM integration_cache").run();
        return json({ ok: true });
      }
      return json({ error: "Route not found." }, 404);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      if (e instanceof Error && /Google Photos|HTTPS/.test(e.message))
        return json({ error: e.message }, 400);
      console.error(
        "Dashboard request failed",
        path,
        e instanceof Error ? e.name : "unknown",
      );
      return json(
        { error: "Request failed. Check server configuration or try again." },
        500,
      );
    }
  },
  async scheduled(_event: ScheduledController, env: Env) {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM sessions WHERE expires<?").bind(now()),
      env.DB.prepare("DELETE FROM pairing WHERE expires<?").bind(now()),
      env.DB.prepare("DELETE FROM oauth_states WHERE expires<?").bind(now()),
      env.DB.prepare("DELETE FROM attempts"),
      env.DB.prepare(
        "DELETE FROM integration_cache WHERE updated<? AND name LIKE ?",
      ).bind(now() - 7 * 86400, "calendar:%"),
    ]);
  },
} satisfies ExportedHandler<Env>;
