import { query } from '../db/pool.js';
import type pg from 'pg';

/** 模型价格行 */
export interface ModelPrice {
  model: string;
  input_price: number;
  output_price: number;
  cache_read_price: number;
  cache_write_price: number;
  peak_input_price?: number | null;
  peak_output_price?: number | null;
  peak_cache_read_price?: number | null;
  peak_cache_write_price?: number | null;
}

/** 高峰时段判断（与 apikey.fun 一致）：工作日(周一至周五)北京时间 9:00-12:00、14:00-18:00 为高峰，其余为谷时。 */
export function isPeakTime(at: Date = new Date(), tzOffsetHours = 8): boolean {
  const utc = at.getTime() + tzOffsetHours * 3600_000;
  const local = new Date(utc);
  const day = local.getUTCDay(); // 0=周日 ... 6=周六
  const hour = local.getUTCHours();
  if (day === 0 || day === 6) return false; // 周末谷时
  return (hour >= 9 && hour < 12) || (hour >= 14 && hour < 18);
}

/**
 * 计算一次请求成本。tokens 单位：个。价格表为「人民币 / 1M tokens」。groupRate 为分组倍率（默认 1）。
 * cacheWrite 为本次请求写入 prompt cache 的 token 数（OpenAI: prompt_tokens_details.cache_write_tokens；
 * Anthropic: cache_creation_input_tokens），按 cache_write_price 计费。
 */
export function computeCost(
  price: ModelPrice,
  prompt: number,
  completion: number,
  cached: number,
  groupRate = 1,
  at: Date = new Date(),
  cacheWrite = 0,
): number {
  const perM = 1_000_000;
  // cache 数不得超过输入 token，防止畸形 usage 产生负成本
  const safeCached = Math.max(0, Math.min(cached, prompt));
  // cacheWrite 也不得超过 prompt 剩余非缓存部分，防止畸形 usage
  const remainingInput = Math.max(0, prompt - safeCached);
  const safeCacheWrite = Math.max(0, Math.min(cacheWrite, remainingInput));
  const peak = isPeakTime(at);
  const inputP = peak && price.peak_input_price != null ? price.peak_input_price : price.input_price;
  const outputP = peak && price.peak_output_price != null ? price.peak_output_price : price.output_price;
  const cacheReadP = peak && price.peak_cache_read_price != null ? price.peak_cache_read_price : price.cache_read_price;
  const cacheWriteP = peak && price.peak_cache_write_price != null ? price.peak_cache_write_price : price.cache_write_price;
  // 输入侧成本 = 普通输入 + 缓存读取 + 缓存写入（cache_write 是额外成本，不重复扣 input）
  const normalInput = Math.max(0, prompt - safeCached - safeCacheWrite);
  const inputCost = (normalInput / perM) * inputP
    + (safeCached / perM) * cacheReadP
    + (safeCacheWrite / perM) * cacheWriteP;
  const outputCost = (Math.max(0, completion) / perM) * outputP;
  return round6(Math.max(0, (inputCost + outputCost) * groupRate));
}

export function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

/** 下游（终端用户）售价倍率：基准 model_prices × 倍率 = 用户实付单价。默认 1（不改变现有计费）。 */
let downstreamMultiplier = 1;
let multLoadedAt = 0;
const MULT_TTL = 30_000;
async function refreshMultiplier(): Promise<void> {
  try {
    const res = await query<{ value: string }>(`SELECT value FROM settings WHERE key = 'billing_rate_multiplier'`);
    const raw = res.rows[0]?.value;
    const n = raw === undefined || raw === null ? 1 : Number(JSON.parse(String(raw)));
    downstreamMultiplier = Number.isFinite(n) && n > 0 ? n : 1;
  } catch {
    downstreamMultiplier = 1;
  }
  multLoadedAt = Date.now();
}
export async function getBillingMultiplier(): Promise<number> {
  if (Date.now() - multLoadedAt > MULT_TTL || multLoadedAt === 0) await refreshMultiplier();
  return downstreamMultiplier;
}
/** 供导入处清缓存（如管理端改价后调用，选填）。 */
export function resetBillingMultiplierCache(): void { multLoadedAt = 0; }

/** 缓存模型价格到内存。 */
export class PriceService {
  private cache: ModelPrice[] = [];
  private loadedAt = 0;
  private static readonly TTL = 60_000;

  private async load(): Promise<void> {
    const res = await query<ModelPrice>('SELECT model, input_price::float8, output_price::float8, cache_read_price::float8, cache_write_price::float8, peak_input_price::float8, peak_output_price::float8, peak_cache_read_price::float8, peak_cache_write_price::float8 FROM model_prices');
    this.cache = res.rows;
    this.loadedAt = Date.now();
  }

  private async ensureLoaded(): Promise<void> {
    if (this.cache.length === 0 || Date.now() - this.loadedAt > PriceService.TTL) {
      await this.load();
    }
  }

  /** 按模型名 + 覆盖值合并返回最终价格。缺省值从价格表取，取不到则返回 null（不计费）。 */
  async resolvePrice(model: string, override?: { input?: number; output?: number; cache_read?: number; cache_write?: number }): Promise<ModelPrice | null> {
    await this.ensureLoaded();
    // 先精确匹配
    const exact = this.cache.find((p) => p.model === model);
    // 否则最长前缀通配（以 * 结尾）
    const wildcard = this.cache
      .filter((p) => p.model.endsWith('*') && model.startsWith(p.model.slice(0, -1)))
      .sort((a, b) => b.model.length - a.model.length)[0];
    const base = exact || wildcard;
    const out: ModelPrice = {
      model,
      input_price: override?.input ?? base?.input_price ?? 0,
      output_price: override?.output ?? base?.output_price ?? 0,
      cache_read_price: override?.cache_read ?? base?.cache_read_price ?? 0,
      cache_write_price: override?.cache_write ?? base?.cache_write_price ?? 0,
      peak_input_price: base?.peak_input_price ?? null,
      peak_output_price: base?.peak_output_price ?? null,
      peak_cache_read_price: base?.peak_cache_read_price ?? null,
      peak_cache_write_price: base?.peak_cache_write_price ?? null,
    };
    // 若既无价格表项也无覆盖，返回 null，表示不计费（或模型被禁用/未知）
    return !exact && !wildcard && !override ? null : out;
  }
}

/** 跨连接共享的价格服务实例。 */
export const priceService = new PriceService();

/** 余额扣费，带余额保护。 */
export async function chargeUser(client: pg.PoolClient, userId: number, amount: number): Promise<{ newBalance: number }> {
  const res = await client.query<{ balance: string }>(
    `UPDATE users
       SET balance = balance - $2
       WHERE id = $1 AND balance >= $2
       RETURNING balance`,
    [userId, amount]
  );
  if (!res.rowCount || res.rowCount === 0) {
    throw new Error('INSUFFICIENT_BALANCE');
  }
  return { newBalance: Number(res.rows[0].balance) };
}
