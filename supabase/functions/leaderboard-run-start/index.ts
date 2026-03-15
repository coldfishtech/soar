import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  corsHeaders,
  createSupabaseAdminClient,
  getClientIp,
  jsonResponse,
  methodNotAllowed,
  parseJsonBody,
} from "../_shared/http.ts";
import { getVerifiedAuthUserId } from "../_shared/auth.ts";
import { isUuid, normalizeBuildVersion, sha256Hex } from "../_shared/validate.ts";

function createSessionToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return methodNotAllowed();

  try {
    const { supabaseUrl, serviceRoleKey } = createSupabaseAdminClient();
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const authUserId = await getVerifiedAuthUserId(req, supabase);
    if (!authUserId) {
      return jsonResponse({ error: "Anonymous auth session required." }, 401);
    }

    const body = await parseJsonBody(req);
    const profileId = String(body.profile_id ?? "");
    const buildVersion = normalizeBuildVersion(body.build_version || "web-unknown");

    if (!isUuid(profileId)) {
      return jsonResponse({ error: "profile_id must be a valid UUID." }, 400);
    }
    if (!buildVersion) {
      return jsonResponse({ error: "build_version is required." }, 400);
    }

    const ip = getClientIp(req);
    const { data: allowedByIp, error: ipLimitError } = await supabase.rpc("consume_rate_limit", {
      p_key: `leaderboard-run-start:ip:${ip}`,
      p_max: 20,
      p_window_seconds: 60,
    });
    if (ipLimitError) {
      console.error("leaderboard-run-start ip limit error", ipLimitError);
      return jsonResponse({ error: "Rate limiter failed." }, 500);
    }
    if (!allowedByIp) {
      return jsonResponse({ error: "Too many requests. Please retry shortly." }, 429);
    }

    const { data: profile, error: profileError } = await supabase
      .from("leaderboard_profiles")
      .select("id, auth_user_id")
      .eq("id", profileId)
      .maybeSingle();
    if (profileError) {
      console.error("leaderboard-run-start profile lookup error", profileError);
      return jsonResponse({ error: "Failed to validate profile." }, 500);
    }
    if (!profile) {
      return jsonResponse({ error: "Profile not found." }, 404);
    }
    if (String(profile.auth_user_id) !== authUserId) {
      return jsonResponse({ error: "Profile does not belong to this player session." }, 403);
    }

    const userAgent = (req.headers.get("user-agent") || "unknown").slice(0, 256);
    const sessionToken = createSessionToken();
    const sessionTokenHash = await sha256Hex(sessionToken);
    const ipHash = await sha256Hex(ip);
    const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();

    const { data: session, error: sessionError } = await supabase
      .from("leaderboard_run_sessions")
      .insert({
        profile_id: profileId,
        auth_user_id: authUserId,
        session_token_hash: sessionTokenHash,
        build_version: buildVersion,
        ip_hash: ipHash,
        user_agent: userAgent,
        expires_at: expiresAt,
      })
      .select("id, started_at, expires_at")
      .single();
    if (sessionError || !session) {
      console.error("leaderboard-run-start insert error", sessionError);
      return jsonResponse({ error: "Failed to start run session." }, 500);
    }

    // Opportunistic cleanup to keep limiter table bounded.
    if (Math.random() < 0.02) {
      const { error: cleanupError } = await supabase.rpc("cleanup_rate_limit_counters");
      if (cleanupError) console.warn("leaderboard-run-start cleanup warning", cleanupError);
    }

    return jsonResponse({
      run_id: session.id,
      session_token: sessionToken,
      started_at: session.started_at,
      expires_at: session.expires_at,
    }, 201);
  } catch (err) {
    console.error("leaderboard-run-start unhandled error", err);
    return jsonResponse({ error: "Internal server error." }, 500);
  }
});
