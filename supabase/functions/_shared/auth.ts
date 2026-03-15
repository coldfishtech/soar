import { isUuid } from "./validate.ts";

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2 || !parts[1]) return null;
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(base64.length + (4 - (base64.length % 4 || 4)) % 4, "=");
    const json = atob(padded);
    const payload = JSON.parse(json);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
    return payload as Record<string, unknown>;
  } catch (_err) {
    return null;
  }
}

export function getBearerToken(req: Request): string | null {
  const auth = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!auth) return null;
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) return null;
  return match[1].trim() || null;
}

export function getAuthUserId(req: Request): string | null {
  const token = getBearerToken(req);
  if (!token) return null;
  const payload = decodeJwtPayload(token);
  const sub = String(payload?.sub ?? "");
  return isUuid(sub) ? sub : null;
}

export async function getVerifiedAuthUserId(
  req: Request,
  supabase: any,
): Promise<string | null> {
  const token = getBearerToken(req);
  if (!token) return null;
  const { data, error } = await supabase.auth.getUser(token);
  if (error) return null;
  const userId = String(data?.user?.id ?? "");
  return isUuid(userId) ? userId : null;
}
