import { query } from '../db/pool.js';
import { round6 } from './pricing.js';

export interface LogInput {
  userId: number | null;
  apiKeyId: number | null;
  accountId: number | null;
  model: string | null;
  endpoint: string;
  platform: string;
  stream: boolean;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  cost: number;
  success: boolean;
  statusCode: number | null;
  errorMessage: string | null;
  latencyMs: number | null;
  ip: string | null;
}

export async function insertLog(input: LogInput): Promise<void> {
  await query(
    `INSERT INTO request_logs
       (user_id, api_key_id, account_id, model, endpoint, platform, stream,
        prompt_tokens, completion_tokens, cached_tokens, cost, success, status_code,
        error_message, latency_ms, ip)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [
      input.userId, input.apiKeyId, input.accountId, input.model, input.endpoint,
      input.platform, input.stream, input.promptTokens, input.completionTokens,
      input.cachedTokens, round6(input.cost), input.success, input.statusCode,
      input.errorMessage, input.latencyMs, input.ip,
    ]
  );
}

/** 简易统计（用于面板仪表盘）。 */
export async function dashboardStats() {
  const total = await query<{ count: string }>('SELECT COUNT(*)::text AS count FROM request_logs');
  const success = await query<{ count: string }>('SELECT COUNT(*)::text AS count FROM request_logs WHERE success = true');
  const tokens = await query<{ p: string; c: string }>('SELECT COALESCE(SUM(prompt_tokens),0)::text AS p, COALESCE(SUM(completion_tokens),0)::text AS c FROM request_logs');
  const cost = await query<{ v: string }>('SELECT COALESCE(SUM(cost),0)::text AS v FROM request_logs');
  const userCost = await query<{ v: string }>('SELECT COALESCE(SUM(cost),0)::text AS v FROM request_logs GROUP BY user_id ORDER BY SUM(cost) DESC LIMIT 1').catch(() => ({ rows: [{ v: '0' }] }));
  return {
    totalRequests: Number(total.rows[0].count),
    successRequests: Number(success.rows[0].count),
    promptTokens: Number(tokens.rows[0].p),
    completionTokens: Number(tokens.rows[0].c),
    totalCost: Number(cost.rows[0].v),
    topUserCost: userCost.rows.length ? Number(userCost.rows[0].v) : 0,
  };
}

/** 每小时聚合（近 24h）。 */
export async function hourlySeries() {
  const res = await query<{ hour: string; req: string; cost: string }>(
    `SELECT date_trunc('hour', created_at) AS hour,
            COUNT(*)::text AS req, SUM(cost)::text AS cost
       FROM request_logs
      WHERE created_at > now() - interval '24 hours'
      GROUP BY 1 ORDER BY 1`
  );
  return res.rows.map((r) => ({ hour: r.hour, requests: Number(r.req), cost: Number(r.cost) }));
}
