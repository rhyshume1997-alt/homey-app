import "server-only";
import { z } from "zod";
import { createUserClient } from "@/server/db/supabase";
import type { HouseholdSession } from "@/server/auth/session";
import { getServerEnv } from "@/server/env";
import type { AiDeps } from "./client";

/** First day of the current month (UTC), matching record_ai_usage(). */
export function currentMonth(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

export async function getMonthSpendPence(s: HouseholdSession): Promise<number | null> {
  const db = await createUserClient();
  if (!db) return null;
  const { data, error } = await db
    .from("ai_usage")
    .select("cost_pence")
    .eq("household_id", s.householdId)
    .eq("month", currentMonth())
    .limit(10000);
  if (error || !data) return null;
  const rows = z.array(z.object({ cost_pence: z.number().int() })).safeParse(data);
  return rows.success ? rows.data.reduce((n, r) => n + r.cost_pence, 0) : null;
}

export function defaultDeps(s: HouseholdSession): AiDeps {
  const env = getServerEnv();
  return {
    fetch: (...a) => fetch(...a),
    apiKey: env.ANTHROPIC_API_KEY,
    capGbp: env.AI_MONTHLY_CAP_GBP,
    getSpentPence: () => getMonthSpendPence(s),
    recordUsage: async (u) => {
      const db = await createUserClient();
      if (!db) return false;
      const { error } = await db.rpc("record_ai_usage", {
        p_household_id: s.householdId,
        p_model: u.model,
        p_input_tokens: u.inputTokens,
        p_output_tokens: u.outputTokens,
        p_cost_pence: u.costPence,
      });
      return !error;
    },
  };
}
