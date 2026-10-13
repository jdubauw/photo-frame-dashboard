export async function api<T = any>(
  path: string,
  method = "GET",
  data?: unknown,
): Promise<T> {
  const r = await fetch("/api" + path, {
    method,
    credentials: "same-origin",
    headers: data === undefined ? {} : { "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const value: any = await r.json();
  if (!r.ok) {
    const error = new Error(value.error || "Request failed.") as Error & {
      status: number;
    };
    error.status = r.status;
    throw error;
  }
  return value;
}
