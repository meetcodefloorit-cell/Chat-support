/** Normalize API / fetch errors for user-visible banners (never raw JSON blobs). */
export function parseError(err: unknown): string {
  if (!(err instanceof Error)) return "Something went wrong. Please try again.";
  const message = err.message || "";
  const normalized = message.trim().toLowerCase();
  if (
    normalized.startsWith("<!doctype html") ||
    normalized.startsWith("<html") ||
    normalized.includes("<body")
  ) {
    return "Server error. Please retry.";
  }
  try {
    const parsed = JSON.parse(message) as { detail?: unknown; message?: unknown };
    const d = parsed.detail ?? parsed.message;
    if (typeof d === "string") return d;
    if (Array.isArray(d) && d.length > 0 && typeof d[0] === "object" && d[0] && "msg" in d[0]) {
      return String((d[0] as { msg?: string }).msg ?? message);
    }
    return message;
  } catch {
    if (message.startsWith("Request failed:")) return "Server error. Please try again.";
    if (message.includes("Too many")) return message;
    return message;
  }
}
