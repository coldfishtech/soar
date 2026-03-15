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
import {
  normalizeInstagram,
  normalizeUsername,
  validateUsername,
} from "../_shared/validate.ts";

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
      p_key: `leaderboard-profile:ip:${ip}`,
      p_max: 5,
      p_window_seconds: 60,
    });
    if (ipLimitError) {
      console.error("leaderboard-profile ip limit error", ipLimitError);
      return jsonResponse({ error: "Rate limiter failed." }, 500);
    }
    if (!allowedByIp) {
      return jsonResponse({ error: "Too many requests. Please retry shortly." }, 429);
    }

    const body = await parseJsonBody(req);
    const username = normalizeUsername(body.username);
    const instagram = normalizeInstagram(body.instagram_username);

    if (!validateUsername(username)) {
      return jsonResponse({ error: "Username must be 3-20 characters." }, 400);
    }

    const { data, error } = await supabase
      .from("leaderboard_profiles")
      .insert({
        auth_user_id: authUserId,
        username,
        instagram_username: instagram,
      })
      .select("id, username, instagram_username, created_at")
      .single();

    if (error || !data) {
      console.error("leaderboard-profile insert error", error);
      return jsonResponse({ error: "Failed to create leaderboard profile." }, 500);
    }

    // Opportunistic cleanup to keep limiter table bounded.
    if (Math.random() < 0.02) {
      const { error: cleanupError } = await supabase.rpc("cleanup_rate_limit_counters");
      if (cleanupError) console.warn("leaderboard-profile cleanup warning", cleanupError);
    }

    return jsonResponse(
      {
        profile_id: data.id,
        username: data.username,
        instagram_username: data.instagram_username,
        created_at: data.created_at,
      },
      201,
    );
  } catch (err) {
    console.error("leaderboard-profile unhandled error", err);
    return jsonResponse({ error: "Internal server error." }, 500);
  }
});
