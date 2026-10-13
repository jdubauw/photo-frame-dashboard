import test from "node:test";
import assert from "node:assert/strict";
import {
  period,
  localDate,
  validDate,
  albumUrl,
  extractPhotos,
} from "./domain.ts";
const chore = {
  id: "c",
  title: "Test",
  person_id: "p",
  points: 5,
  recurrence: "weekly" as const,
  start_date: "2026-10-13",
  active: 1,
};
test("recurrence stays anchored to start date across month and DST boundaries", () => {
  assert.equal(period(chore, "2026-10-12"), null);
  assert.equal(period(chore, "2026-10-13"), "week:0");
  assert.equal(period(chore, "2026-10-19"), "week:0");
  assert.equal(period(chore, "2026-10-20"), "week:1");
  assert.equal(period(chore, "2026-11-03"), "week:3");
  assert.equal(
    period({ ...chore, recurrence: "daily" }, "2026-10-20"),
    "2026-10-20",
  );
  assert.equal(period({ ...chore, recurrence: "once" }, "2027-01-01"), "once");
});
test("household date respects its timezone, not UTC or frame timezone", () => {
  assert.equal(
    localDate(new Date("2026-10-14T03:00:00Z"), "America/Chicago"),
    "2026-10-13",
  );
  assert.equal(
    localDate(new Date("2026-10-14T03:00:00Z"), "Asia/Tokyo"),
    "2026-10-14",
  );
});
test("invalid dates and non-Google album sources are rejected", () => {
  assert.equal(validDate("2026-02-30"), false);
  assert.equal(validDate("2024-02-29"), true);
  assert.equal(validDate("tomorrow"), false);
  for (const url of [
    "http://photos.google.com/share/a",
    "https://evil.example/a",
    "https://photos.google.com.evil.example",
    "https://user:password@photos.google.com/share/a",
  ])
    assert.throws(() => albumUrl(url));
  assert.equal(
    albumUrl("https://photos.app.goo.gl/example"),
    "https://photos.app.goo.gl/example",
  );
});
test("photo adapter deduplicates images and excludes short avatar URLs", () => {
  const url = "https://lh3.googleusercontent.com/pw/EXAMPLEPHOTO";
  const html = JSON.stringify([
    url + "=w300",
    url + "=w900",
    "https://lh3.googleusercontent.com/a/avatar",
    "https://evil.example/photo",
  ]);
  assert.deepEqual(extractPhotos(html), [url + "=w1280-h800"]);
  assert.deepEqual(extractPhotos("<html>Sign in to view</html>"), []);
});
