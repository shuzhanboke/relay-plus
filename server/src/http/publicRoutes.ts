import type { Router } from 'express';
import express from 'express';
import { query } from '../db/pool.js';
import { success } from './respond.js';
import { getBillingMultiplier } from '../services/pricing.js';

/**
 * 免登录公开接口：供登录前的落地页 / 定价页 / 接入文档展示。
 * 只暴露运营方愿意对外展示的信息（站点名、注册开关、客服、模型单价、套餐），
 * 不包含任何余额、订单、Key 或内部账号数据。
 */
export const publicRouter: Router = express.Router();

// ==================== 站点公开信息 ====================
// 只暴露明确对外字段，避免 `LIKE 'support_%'` 前缀过宽误泄敏感配置
const PUBLIC_SETTING_KEYS = ['system_name', 'registration_enabled', 'announcement', 'support_qq', 'support_email', 'support_telegram', 'support_wechat'];
const isScalar = (v: unknown) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';

publicRouter.get('/public/site', async (_req, res) => {
  try {
    const rows = await query(
      `SELECT key, value FROM settings WHERE key = ANY($1)`,
      [PUBLIC_SETTING_KEYS]
    );
    const out: Record<string, unknown> = {
      system_name: '中转站 Plus',
      registration_enabled: process.env.ALLOW_REGISTER !== 'false' && process.env.ALLOW_REGISTER !== '0',
      announcement: '',
    };
    for (const r of rows.rows) {
      const v = r.value;
      if (typeof v === 'string') out[r.key] = v;
      else if (v && typeof v === 'object' && (v as any).value !== undefined && isScalar((v as any).value)) out[r.key] = (v as any).value;
      else if (isScalar(v)) out[r.key] = v;
    }
    success(res, out);
  } catch (err) {
    success(res, { system_name: '中转站 Plus', registration_enabled: true, announcement: '' });
    void err;
  }
});

// ==================== 公开模型单价（供定价页/模型矩阵） ====================
publicRouter.get('/public/models', async (_req, res) => {
  try {
    const [mult, prices] = await Promise.all([
      getBillingMultiplier(),
      query<{ model: string; input_price: number; output_price: number; cache_read_price: number; cache_write_price: number }>(
        `SELECT model, input_price::float8 AS input_price, output_price::float8 AS output_price,
                cache_read_price::float8 AS cache_read_price, cache_write_price::float8 AS cache_write_price
           FROM model_prices ORDER BY model LIMIT 300`
      ),
    ]);
    success(res, { multiplier: mult, currency: 'CNY', prices: prices.rows });
  } catch (err) {
    success(res, { multiplier: 1, currency: 'CNY', prices: [] });
    void err;
  }
});

// ==================== 公开套餐（供定价页展示） ====================
publicRouter.get('/public/plans', async (_req, res) => {
  try {
    const rows = await query(
      `SELECT id, name, description, amount::float8 AS amount, credit::float8 AS credit, sort,
              type, period_days, monthly_credit::float8 AS monthly_credit
         FROM plans WHERE enabled = true ORDER BY type ASC, sort ASC, amount ASC`
    );
    const free = Number(process.env.FREE_GRANT_AMOUNT || 0);
    success(res, { plans: rows.rows, free_grant: { enabled: free > 0, amount: free } });
  } catch (err) {
    success(res, { plans: [], free_grant: { enabled: false, amount: 0 } });
    void err;
  }
});

// ==================== 公开模型价格（供模型价格页，¥/1M tokens） ====================
// 返回全部价目（含谷峰字段）、各分组倍率、谷峰时段规则，前端按模型名前缀归为厂商 Tab。
publicRouter.get('/public/pricing', async (_req, res) => {
  try {
    const [models, groups, mult] = await Promise.all([
      query<{
        id: number; model: string; input_price: number; output_price: number;
        cache_read_price: number; cache_write_price: number;
        peak_input_price: number | null; peak_output_price: number | null;
        peak_cache_read_price: number | null; peak_cache_write_price: number | null;
      }>(
        `SELECT id, model, input_price::float8 AS input_price, output_price::float8 AS output_price,
                cache_read_price::float8 AS cache_read_price, cache_write_price::float8 AS cache_write_price,
                peak_input_price::float8 AS peak_input_price, peak_output_price::float8 AS peak_output_price,
                peak_cache_read_price::float8 AS peak_cache_read_price, peak_cache_write_price::float8 AS peak_cache_write_price
           FROM model_prices ORDER BY model`
      ),
      query<{ id: number; name: string; platform: string; rate_multiplier: number }>(
        `SELECT id, name, platform, rate_multiplier::float8 AS rate_multiplier FROM groups ORDER BY id`
      ),
      getBillingMultiplier(),
    ]);
    success(res, {
      currency: 'CNY',
      multiplier: mult,
      groups: groups.rows,
      models: models.rows,
      peak_rule: '工作日(周一至周五)北京时间 9:00-12:00、14:00-18:00 为高峰时段，其余为谷时；高峰价未配置时按普通价。',
    });
  } catch (err) {
    success(res, { currency: 'CNY', multiplier: 1, groups: [], models: [], peak_rule: '' });
    void err;
  }
});
