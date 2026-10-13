// Run against an isolated local Wrangler server after `npm run db:local`.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const vars = readFileSync(".dev.vars", "utf8");
const password = vars.match(/^ADMIN_PASSWORD="([^"]+)"/m)?.[1];
if (!password)
  throw new Error("Set a local ADMIN_PASSWORD in .dev.vars first.");
const origin = "http://127.0.0.1:8787";
function client() {
  let cookie = "";
  return async (
    path,
    method = "GET",
    data,
    expected = 200,
    sendOrigin = true,
  ) => {
    const response = await fetch(origin + "/api" + path, {
      method,
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        ...(sendOrigin ? { Origin: origin } : {}),
        ...(data === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    assert.equal(
      response.status,
      expected,
      `Unexpected status for ${path}: ${response.status}`,
    );
    if (response.headers.get("set-cookie"))
      cookie = response.headers.get("set-cookie").split(";")[0];
    return response.json();
  };
}
const admin = client(),
  display = client(),
  stranger = client();
await stranger("/dashboard", "GET", undefined, 401);
await stranger("/auth/login", "POST", { password }, 403, false);
await admin("/auth/login", "POST", { password });
const person = await admin("/admin/people", "POST", {
  name: "Integration test member",
  color: "#2D5BFF",
});
const config = await admin("/admin/settings");
const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: config.timezone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());
const chore = await admin("/admin/chores", "POST", {
  title: "Integration test chore",
  person_id: person.id,
  points: 7,
  recurrence: "daily",
  start_date: today,
});
const pairing = await admin("/admin/pairing", "POST", {});
await display("/auth/pair", "POST", { code: pairing.code });
await stranger("/auth/pair", "POST", { code: pairing.code }, 401);
await display("/admin/settings", "GET", undefined, 403);
await display(
  "/admin/people",
  "POST",
  { name: "Unauthorised", color: "#111111" },
  403,
);
await admin("/admin/settings", "PUT", { ...config, frameCompletion: false });
await display("/completions", "POST", { choreId: chore.id }, 403);
await display(
  "/home/action",
  "POST",
  { entityId: "light.kitchen", action: "turn_on" },
  403,
);
await admin(
  "/home/action",
  "POST",
  { entityId: "light.not_selected", action: "turn_on" },
  403,
);
await admin("/completions", "POST", { choreId: chore.id });
await admin("/completions", "POST", { choreId: chore.id });
let data = await admin("/dashboard");
assert.equal(
  data.people.find((p) => p.id === person.id).points,
  7,
  "Repeated completion must not award duplicate points",
);
assert.equal(data.chores.find((c) => c.id === chore.id).completed, true);
assert.equal(data.completions.filter((c) => c.chore_id === chore.id).length, 1);
const completion = data.completions.find((c) => c.chore_id === chore.id);
await admin("/admin/completions/" + completion.id, "DELETE");
data = await admin("/dashboard");
assert.equal(
  data.people.find((p) => p.id === person.id).points,
  0,
  "Undo must remove points",
);
await admin("/admin/settings", "PUT", { ...config, frameCompletion: true });
await display("/completions", "POST", { choreId: chore.id });
await admin(
  "/admin/chores",
  "POST",
  { title: "Bad chore", points: -1, recurrence: "daily", start_date: today },
  400,
);
await admin(
  "/admin/settings",
  "PUT",
  { ...config, albumUrl: "https://evil.example/album" },
  400,
);
await admin(
  "/admin/settings",
  "PUT",
  { ...config, timezone: "Invalid/Timezone" },
  400,
);
await admin(
  "/admin/settings",
  "PUT",
  { ...config, haUrl: "http://localhost:8123" },
  400,
);
await admin("/calendar?from=bad&to=bad", "GET", undefined, 400);
await admin("/admin/google/start?personId=" + person.id, "GET", undefined, 503);
await admin("/admin/chores/" + chore.id, "DELETE");
await admin("/admin/people/" + person.id, "DELETE");
data = await admin("/dashboard");
assert(!data.people.some((p) => p.id === person.id));
assert(!data.chores.some((c) => c.id === chore.id));
assert(
  data.completions.some((c) => c.chore_id === chore.id),
  "Archiving must preserve history",
);
await admin(
  "/admin/completions/" +
    data.completions.find((c) => c.chore_id === chore.id).id,
  "DELETE",
);
await admin("/admin/settings", "PUT", config);
await admin("/admin/displays", "DELETE");
await display("/dashboard", "GET", undefined, 401);
await admin("/auth/logout", "POST");
await admin("/dashboard", "GET", undefined, 401);
console.log(
  "Integration checks passed: authentication, CSRF, pairing, display permissions, recurring points, idempotency, undo, validation, archive history, revocation.",
);
