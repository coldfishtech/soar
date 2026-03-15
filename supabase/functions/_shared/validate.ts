const USERNAME_ALLOWED = /[^A-Za-z0-9._ \-]/g;
const INSTAGRAM_ALLOWED = /[^A-Za-z0-9._]/g;
const BUILD_VERSION_ALLOWED = /[^A-Za-z0-9._\-]/g;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeUsername(raw: unknown): string {
  return String(raw ?? "")
    .replace(USERNAME_ALLOWED, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 20);
}

export function normalizeInstagram(raw: unknown): string | null {
  const cleaned = String(raw ?? "")
    .trim()
    .replace(/^@+/, "")
    .replace(INSTAGRAM_ALLOWED, "")
    .slice(0, 30);
  return cleaned || null;
}

export function validateUsername(username: string): boolean {
  return username.length >= 3 && username.length <= 20;
}

export function parseScore(raw: unknown): number | null {
  const num = Number(raw);
  if (!Number.isFinite(num)) return null;
  if (!Number.isInteger(num)) return null;
  if (num < 0) return null;
  if (num > 2147483647) return null;
  return num;
}

export function parsePositiveInt(raw: unknown, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  const int = Math.floor(n);
  if (int < min) return min;
  if (int > max) return max;
  return int;
}

export function parseDurationMs(raw: unknown): number | null {
  const num = Number(raw);
  if (!Number.isFinite(num)) return null;
  if (!Number.isInteger(num)) return null;
  if (num < 0) return null;
  if (num > 86_400_000) return null;
  return num;
}

export function normalizeBuildVersion(raw: unknown): string {
  return String(raw ?? "")
    .replace(BUILD_VERSION_ALLOWED, "")
    .trim()
    .slice(0, 64);
}

export async function sha256Hex(raw: string): Promise<string> {
  const bytes = new TextEncoder().encode(raw);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const out = new Uint8Array(digest);
  return Array.from(out).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function isUuid(value: unknown): boolean {
  return UUID_RE.test(String(value ?? ""));
}
