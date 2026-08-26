import { query } from '../db/pool.js';

/**
 * 滑动窗口速率限制（基于数据库计数）。
 * 用于 RPM/TPM/并发前置校验。高并发场景下应替换为 Redis，这里用 DB 窗口+本地内存近似。
 */
export interface RateInfo {
  rps: number | null;
  rpm: number | null;
  tpm: number | null;
  concurrency: number | null; // 并发上限
  model: string;
}

export class RateLimiter {
  /** 在内存里维护并发计数（近似），解决 DB 计数难以表达并发的问题。 */
  private concurrent = new Map<number, number>(); // keyId -> current
  private concurrencyCap = new Map<number, number>(); // keyId -> cap

  setConcurrencyCap(keyId: number, cap: number | null): void {
    if (cap === null || cap <= 0) this.concurrencyCap.delete(keyId);
    else this.concurrencyCap.set(keyId, cap);
  }

  acquire(keyId: number): boolean {
    const cap = this.concurrencyCap.get(keyId);
    if (cap === undefined) return true; // 不限并发
    const cur = this.concurrent.get(keyId) || 0;
    if (cur >= cap) return false;
    this.concurrent.set(keyId, cur + 1);
    return true;
  }

  release(keyId: number): void {
    const cur = this.concurrent.get(keyId) || 0;
    if (cur > 1) this.concurrent.set(keyId, cur - 1);
    else this.concurrent.delete(keyId);
  }

  /**
   * 检查 RPM/TPM 是否超限。返回剩余允许额度（null 表示不设限）。
   * bucket 用 Unix 分钟/秒整除值。不加锁，允许轻微超卖。
   */
  async checkWindow(keyId: number, limitValue: number | null, scope: 'minute' | 'second', tokens: number): Promise<boolean> {
    if (limitValue === null || limitValue <= 0) return true;
    const bucket = scope === 'minute'
      ? String(Math.floor(Date.now() / 60_000))
      : String(Math.floor(Date.now() / 1000));
    const key = `key:${keyId}:${scope}`;
    const res = await query<{ count: string }>(
      `INSERT INTO rate_counters (scope, bucket, count)
       VALUES ($1, $2, 1)
       ON CONFLICT (scope, bucket) DO UPDATE SET count = rate_counters.count + 1
       RETURNING count`,
      [key, bucket]
    );
    return Number(res.rows[0].count) <= limitValue;
  }

  /** 定期清理过期计数（由定时任务调用）。 */
  async cleanup(): Promise<void> {
    const cutoffMinute = String(Math.floor((Date.now() - 2 * 60_000) / 60_000));
    await query(`DELETE FROM rate_counters WHERE scope LIKE '%:minute' AND bucket < $1`, [cutoffMinute]);
    const cutoffSecond = String(Math.floor((Date.now() - 3_000) / 1000));
    await query(`DELETE FROM rate_counters WHERE scope LIKE '%:second' AND bucket < $1`, [cutoffSecond]);
  }
}

export const rateLimiter = new RateLimiter();

// 后台清理定时器
setInterval(() => {
  rateLimiter.cleanup().catch(() => { /* ignore */ });
}, 60_000).unref();
