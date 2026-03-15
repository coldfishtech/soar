import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  corsHeaders,
  createSupabaseAdminClient,
  jsonResponse,
  methodNotAllowed,
} from "../_shared/http.ts";
import { parsePositiveInt } from "../_shared/validate.ts";

const MAX_LIMIT = 50;
const MAX_OFFSET = 100000;

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "GET") return methodNotAllowed();

  try {
    const url = new URL(req.url);
    const limit = parsePositiveInt(url.searchParams.get("limit"), MAX_LIMIT, 1, MAX_LIMIT);
    const offset = parsePositiveInt(url.searchParams.get("offset"), 0, 0, MAX_OFFSET);

    const { supabaseUrl, serviceRoleKey } = createSupabaseAdminClient();
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data, error } = await supabase.rpc("leaderboard_runs_page", {
      p_limit: limit,
      p_offset: offset,
    });

    if (error) {
      console.error("leaderboard-runs rpc error", error);
      return jsonResponse({ error: "Failed to fetch leaderboard runs." }, 500);
    }

    const rows = Array.isArray(data)
      ? data.map((row) => ({
          rank: Number(row.rank) || 0,
          username: String(row.username ?? "-"),
          score: Number(row.score) || 0,
          run_id: Number(row.run_id) || 0,
        }))
      : [];
    const nextOffset = rows.length >= limit ? offset + rows.length : null;

    return jsonResponse({
      rows,
      next_offset: nextOffset,
    });
  } catch (err) {
    console.error("leaderboard-runs unhandled error", err);
    return jsonResponse({ error: "Internal server error." }, 500);
  }
});
