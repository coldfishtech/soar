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
import { isUuid, normalizeBuildVersion, parseDurationMs, parseScore, sha256Hex } from "../_shared/validate.ts";

function hardRejectReason(score: number, durationMs: number, priorBestScore: number | null): string | null {
  if (score > 150_000) return "score exceeds allowed maximum.";
  if (durationMs < 10_000 && score > 5_000) return "score too high for very short run.";
  if (durationMs < 20_000 && score > 9_000) return "score too high for short run.";
  if (durationMs < 30_000 && score > 13_000) return "score too high for run duration.";
  if (durationMs < 60_000 && score > 25_000) return "score too high for run duration.";
  if (priorBestScore != null && score - priorBestScore > 100_000) return "score jump over prior best is too large.";
  return null;
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

    const ip = getClientIp(req);
    const { data: allowedByIp, error: ipLimitError } = await supabase.rpc("consume_rate_limit", {
      p_key: `leaderboard-submit:ip:${ip}`,
      p_max: 10,
      p_window_seconds: 60,
    });
    if (ipLimitError) {
      console.error("leaderboard-submit ip limit error", ipLimitError);
      return jsonResponse({ error: "Rate limiter failed." }, 500);
    }
    if (!allowedByIp) {
      return jsonResponse({ error: "Too many submissions. Please retry shortly." }, 429);
    }

    const { data: allowedByAuth, error: authLimitError } = await supabase.rpc("consume_rate_limit", {
      p_key: `leaderboard-submit:auth:${authUserId}`,
      p_max: 30,
      p_window_seconds: 60,
    });
    if (authLimitError) {
      console.error("leaderboard-submit auth limit error", authLimitError);
      return jsonResponse({ error: "Rate limiter failed." }, 500);
    }
    if (!allowedByAuth) {
      return jsonResponse({ error: "Too many submissions. Please retry shortly." }, 429);
    }

    const body = await parseJsonBody(req);
    const runId = String(body.run_id ?? "");
    const sessionToken = String(body.session_token ?? "");
    const score = parseScore(body.score);
    const durationMs = parseDurationMs(body.duration_ms);
    const buildVersion = normalizeBuildVersion(body.build_version || "web-unknown");

    if (!isUuid(runId)) {
      return jsonResponse({ error: "run_id must be a valid UUID." }, 400);
    }
    if (!sessionToken || sessionToken.length < 16 || sessionToken.length > 256) {
      return jsonResponse({ error: "session_token is invalid." }, 400);
    }
    if (score == null) {
      return jsonResponse({ error: "score must be an integer >= 0." }, 400);
    }
    if (durationMs == null) {
      return jsonResponse({ error: "duration_ms must be an integer >= 0." }, 400);
    }
    if (!buildVersion) {
      return jsonResponse({ error: "build_version is required." }, 400);
    }

    const sessionTokenHash = await sha256Hex(sessionToken);
    const nowIso = new Date().toISOString();

    // Atomically consume one-time session token.
    const { data: consumedRows, error: consumeError } = await supabase
      .from("leaderboard_run_sessions")
      .update({ used_at: nowIso })
      .eq("id", runId)
      .eq("auth_user_id", authUserId)
      .eq("session_token_hash", sessionTokenHash)
      .is("used_at", null)
      .gt("expires_at", nowIso)
      .select("id, profile_id, build_version");

    if (consumeError) {
      console.error("leaderboard-submit session consume error", consumeError);
      return jsonResponse({ error: "Failed to validate run session." }, 500);
    }
    const consumedSession = consumedRows && consumedRows.length ? consumedRows[0] : null;
    if (!consumedSession) {
      return jsonResponse({ error: "Run session is invalid, expired, or already used." }, 409);
    }

    const profileId = String(consumedSession.profile_id);
    const { data: profile, error: profileError } = await supabase
      .from("leaderboard_profiles")
      .select("id, auth_user_id")
      .eq("id", profileId)
      .maybeSingle();
    if (profileError) {
      console.error("leaderboard-submit profile lookup error", profileError);
      return jsonResponse({ error: "Failed to validate profile." }, 500);
    }
    if (!profile || String(profile.auth_user_id) !== authUserId) {
      return jsonResponse({ error: "Profile is not owned by this player session." }, 403);
    }

    const { data: priorBestRow, error: priorBestError } = await supabase
      .from("leaderboard_runs")
      .select("score")
      .eq("profile_id", profileId)
      .eq("auth_user_id", authUserId)
      .order("score", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (priorBestError) {
      console.error("leaderboard-submit prior best lookup error", priorBestError);
      return jsonResponse({ error: "Failed to validate score." }, 500);
    }
    const priorBestScore = priorBestRow ? Number(priorBestRow.score) : null;

    const hardReject = hardRejectReason(score, durationMs, Number.isFinite(priorBestScore) ? priorBestScore : null);
    if (hardReject) {
      return jsonResponse({
        error: `Run rejected: ${hardReject}`,
        accepted: false,
        anomaly_flagged: true,
      }, 422);
    }

    const ipHash = await sha256Hex(ip);
    const userAgent = (req.headers.get("user-agent") || "unknown").slice(0, 256);
    const scorePerSecond = durationMs > 0 ? score / (durationMs / 1000) : 0;
    const suspiciousReasons: string[] = [];

    if (scorePerSecond > 280) suspiciousReasons.push("high_score_per_second");
    if (score >= 12_000 && durationMs < 30_000) suspiciousReasons.push("high_score_short_duration");
    if (priorBestScore != null && score - priorBestScore > 30_000) suspiciousReasons.push("large_jump_over_prior_best");
    if (String(consumedSession.build_version) !== buildVersion) suspiciousReasons.push("run_build_mismatch");

    const fiveMinutesAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    const { count: recentHighCount, error: repeatedError } = await supabase
      .from("leaderboard_runs")
      .select("id", { head: true, count: "exact" })
      .eq("auth_user_id", authUserId)
      .eq("ip_hash", ipHash)
      .gte("created_at", fiveMinutesAgo)
      .gte("score", 12_000);
    if (repeatedError) {
      console.error("leaderboard-submit repeated-high lookup error", repeatedError);
      return jsonResponse({ error: "Failed to evaluate suspicious patterns." }, 500);
    }
    if ((recentHighCount || 0) >= 3) suspiciousReasons.push("repeated_high_submissions");

    const isSuspicious = suspiciousReasons.length > 0;
    const { data: run, error: runError } = await supabase
      .from("leaderboard_runs")
      .insert({
        profile_id: profileId,
        score,
        duration_ms: durationMs,
        build_version: buildVersion,
        ip_hash: ipHash,
        user_agent: userAgent,
        auth_user_id: authUserId,
        is_suspicious: isSuspicious,
        suspicious_reasons: suspiciousReasons,
      })
      .select("id, score, created_at")
      .single();

    if (runError || !run) {
      console.error("leaderboard-submit run insert error", runError);
      return jsonResponse({ error: "Failed to submit run." }, 500);
    }

    let currentRunRank: number | null = null;
    if (!isSuspicious) {
      const { data: rankData, error: rankError } = await supabase.rpc("leaderboard_run_rank", {
        p_run_id: run.id,
      });
      if (rankError) {
        console.error("leaderboard-submit rank rpc error", rankError);
        return jsonResponse({ error: "Run saved, but rank could not be computed." }, 500);
      }
      const rank = Number(rankData);
      currentRunRank = Number.isFinite(rank) && rank > 0 ? rank : null;
    }

    // Opportunistic cleanup to keep limiter table bounded.
    if (Math.random() < 0.02) {
      const { error: cleanupError } = await supabase.rpc("cleanup_rate_limit_counters");
      if (cleanupError) console.warn("leaderboard-submit cleanup warning", cleanupError);
    }

    return jsonResponse(
      {
        run_id: run.id,
        score: run.score,
        current_run_rank: currentRunRank,
        submitted_at: run.created_at,
        accepted: true,
        anomaly_flagged: isSuspicious,
      },
      201,
    );
  } catch (err) {
    console.error("leaderboard-submit unhandled error", err);
    return jsonResponse({ error: "Internal server error." }, 500);
  }
});
