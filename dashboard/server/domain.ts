export type Settings = {
  familyName: string;
  timezone: string;
  albumUrl: string;
  photoSeconds: number;
  shuffle: boolean;
  haUrl: string;
  haEntities: string[];
  frameCompletion: boolean;
  homeControls: boolean;
};
export type Person = {
  id: string;
  name: string;
  color: string;
  active: number;
  points?: number;
};
export type Chore = {
  id: string;
  title: string;
  person_id: string | null;
  points: number;
  recurrence: "daily" | "weekly" | "once";
  start_date: string;
  active: number;
};
export function localDate(now: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
export function period(chore: Chore, today: string): string | null {
  if (today < chore.start_date) return null;
  if (chore.recurrence === "once") return "once";
  if (chore.recurrence === "daily") return today;
  const days = Math.floor(
    (Date.parse(today + "T00:00:00Z") -
      Date.parse(chore.start_date + "T00:00:00Z")) /
      86400000,
  );
  return `week:${Math.floor(days / 7)}`;
}
export function validDate(date: unknown): date is string {
  return (
    typeof date === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    !Number.isNaN(Date.parse(date)) &&
    new Date(date).toISOString().slice(0, 10) === date
  );
}
export function albumUrl(value: string) {
  if (!value) return "";
  const u = new URL(value);
  if (
    u.protocol !== "https:" ||
    (u.port && u.port !== "443") ||
    u.username ||
    u.password ||
    !["photos.app.goo.gl", "photos.google.com"].includes(u.hostname)
  )
    throw new Error("Use a Google Photos shared-album HTTPS link.");
  return u.href;
}
export function extractPhotos(html: string): string[] {
  // Shared-page URLs are unofficial and may change. Do not include avatar URLs.
  const decoded = html
    .replace(/\\u003d/g, "=")
    .replace(/\\u0026/g, "&")
    .replace(/\\\//g, "/");
  const matches =
    decoded.match(
      /https:\/\/lh3\.googleusercontent\.com\/(?:pw\/|p\/|[A-Za-z0-9_-]{40,})[^"\s<>\\]*/g,
    ) || [];
  return [
    ...new Set(
      matches.map((url) => url.replace(/=[^/]*$/, "") + "=w1280-h800"),
    ),
  ].slice(0, 500);
}
