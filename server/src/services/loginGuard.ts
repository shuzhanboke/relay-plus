import { query } from '../db/pool.js';
import type { Request } from 'express';

/**
 * 登录安全防护（用 rate_counters 表跨实例共享计数）：
 * - 邮箱级失败锁定：连续失败达阈值后锁定一段时间（按到期时间戳）
 * - IP 级短时限流：同一 IP 窗口内尝试过多则临时拒绝
 *
 * 计数存储约定：
 *   scope='login:fail:<email>'  bucket=整数秒(minute)  count=该分钟失败次数（用于短窗口聚合）
 *   scope='login:fail:<email>'  bucket='until'        count=锁定截止时间戳(秒)（0/空=未锁定）
 *   scope='login:ip:<ip>'       bucket=整数秒         count=该秒 IP 尝试次数
 */
export interface LoginGuardResult {
  allowed: boolean;
  retryAfterSec?: number;
  reason?: string;
}

const MAX_FAILS = Number(process.env.LOGIN_MAX_FAILS || 5);        // 连续失败次数
const LOCK_SECONDS = Number(process.env.LOGIN_LOCK_SECONDS || 600); // 锁定秒数（10min）
const IP_BURST = Number(process.env.LOGIN_IP_BURST || 20);          // IP 窗口内最多尝试
const IP_WINDOW_SEC = Number(process.env.LOGIN_IP_WINDOW_SEC || 60);

export function getClientIp(req: Request): string {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.ip || 'unknown';
}

export async function checkLoginAllowed(email: string, req: Request): Promise<LoginGuardResult> {
  const ip = getClientIp(req);
  const nowSec = Math.floor(Date.now() / 1000);
  const failKey = `login:fail:${email.toLowerCase()}`;

  // 1) 邮箱锁定到期检查
  const until = await query<{ count: string }>(
    `SELECT count::text FROM rate_counters WHERE scope = $1 AND bucket = 'until'`, [failKey]
  );
  const untilTs = until.rows[0] ? Number(until.rows[0].count) : 0;
  if (untilTs > nowSec) {
    return { allowed: false, retryAfterSec: untilTs - nowSec, reason: 'ACCOUNT_LOCKED' };
  }

  // 2) 最近窗口内失败累计（聚合最近若干分钟）
  const sum = await query<{ total: string }>(
    `SELECT COALESCE(SUM(count),0)::int AS total FROM rate_counters
      WHERE scope = $1 AND bucket SIMILAR TO '[0-9]+' AND bucket::int > $2`,
    [failKey, nowSec - 300]
  );
  const failCount = Number(sum.rows[0]?.total || 0);
  if (failCount >= MAX_FAILS) {
    return { allowed: false, retryAfterSec: LOCK_SECONDS, reason: 'ACCOUNT_LOCKED' };
  }

  // 3) IP 级限流
  const ipKey = `login:ip:${ip}`;
  const ipWin = String(Math.floor(nowSec / IP_WINDOW_SEC) * IP_WINDOW_SEC);
  const ipRes = await query<{ count: string }>(
    `INSERT INTO rate_counters (scope, bucket, count) VALUES ($1, $2, 1)
     ON CONFLICT (scope, bucket) DO UPDATE SET count = rate_counters.count + 1 RETURNING count::text`,
    [ipKey, ipWin]
  );
  if (Number(ipRes.rows[0].count) > IP_BURST) {
    return { allowed: false, retryAfterSec: IP_WINDOW_SEC, reason: 'IP_RATE_LIMITED' };
  }

  return { allowed: true };
}

/** 登录失败：记录，达到阈值即设置锁定到期时间。 */
export async function recordLoginFailure(email: string): Promise<void> {
  const failKey = `login:fail:${email.toLowerCase()}`;
  const nowSec = Math.floor(Date.now() / 1000);
  const minuteBucket = String(nowSec);
  await query(
    `INSERT INTO rate_counters (scope, bucket, count) VALUES ($1, $2, 1)
     ON CONFLICT (scope, bucket) DO UPDATE SET count = rate_counters.count + 1`,
    [failKey, minuteBucket]
  );
  const sum = await query<{ total: string }>(
    `SELECT COALESCE(SUM(count),0)::int AS total FROM rate_counters
      WHERE scope = $1 AND bucket SIMILAR TO '[0-9]+' AND bucket::int > $2`,
    [failKey, nowSec - 300]
  );
  if (Number(sum.rows[0]?.total || 0) >= MAX_FAILS) {
    await query(
      `INSERT INTO rate_counters (scope, bucket, count) VALUES ($1, 'until', $2)
       ON CONFLICT (scope, bucket) DO UPDATE SET count = EXCLUDED.count`,
      [failKey, nowSec + LOCK_SECONDS]
    );
  }
}

/** 登录成功：清除该邮箱的失败计数与锁定标记。 */
export async function clearLoginFailures(email: string): Promise<void> {
  const failKey = `login:fail:${email.toLowerCase()}`;
  await query(`DELETE FROM rate_counters WHERE scope = $1`, [failKey]);
}

/** 过期数据清理。 */
export async function cleanupLoginGuard(): Promise<void> {
  const cutoff = Math.floor(Date.now() / 1000);
  // 失效的锁（到期已过）
  await query(
    `DELETE FROM rate_counters WHERE scope LIKE 'login:fail:%' AND bucket = 'until' AND count::int < $1`,
    [cutoff]
  );
  // 5 分钟前的失败分钟桶
  await query(`DELETE FROM rate_counters WHERE scope LIKE 'login:fail:%' AND bucket SIMILAR TO '[0-9]+' AND bucket::int < $1`, [cutoff - 300]);
  // IP 窗口过期桶
  await query(`DELETE FROM rate_counters WHERE scope LIKE 'login:ip:%' AND bucket::int < $1`, [cutoff - IP_WINDOW_SEC - 30]);
  // 注册 IP 分钟桶（10 分钟前）
  await query(`DELETE FROM rate_counters WHERE scope LIKE 'register:ip:%' AND bucket::int < $1`, [cutoff - 600]);
}

setInterval(() => { cleanupLoginGuard().catch(() => {}); }, 60_000).unref();
