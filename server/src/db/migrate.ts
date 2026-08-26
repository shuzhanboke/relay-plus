import '../env.js'; // 加载项目根 .env（单一配置源）
import { query, closePool } from './pool.js';

/**
 * 数据库迁移：使用 SCHEMA_MIGRATIONS 表做版本管理。
 * 每个迁移在事务中执行，成功后记录版本。
 */
const MIGRATIONS: { version: number; name: string; sql: string }[] = [
  {
    version: 1,
    name: 'init-relay-plus-schema',
    sql: `
      -- ============ 用户/账号 ============
      CREATE TABLE IF NOT EXISTS users (
        id            BIGSERIAL PRIMARY KEY,
        email         TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        username      TEXT,
        role          TEXT NOT NULL DEFAULT 'user',        -- admin | user
        status        TEXT NOT NULL DEFAULT 'active',      -- active | disabled
        balance       NUMERIC(14,6) NOT NULL DEFAULT 0,    -- 美元余额
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      -- ============ 分组 ============
      CREATE TABLE IF NOT EXISTS groups (
        id          BIGSERIAL PRIMARY KEY,
        name        TEXT NOT NULL,
        platform    TEXT NOT NULL DEFAULT 'openai',        -- openai | anthropic | custom
        description TEXT,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (name, platform)
      );

      -- ============ 上游代理 ============
      CREATE TABLE IF NOT EXISTS proxies (
        id          BIGSERIAL PRIMARY KEY,
        name        TEXT NOT NULL UNIQUE,
        protocol    TEXT NOT NULL DEFAULT 'http',          -- http | https | socks5
        host        TEXT NOT NULL,
        port        INTEGER NOT NULL,
        username    TEXT,
        password    TEXT,
        status      TEXT NOT NULL DEFAULT 'active',
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      -- ============ 上游账号（渠道）============
      CREATE TABLE IF NOT EXISTS accounts (
        id            BIGSERIAL PRIMARY KEY,
        name          TEXT NOT NULL,
        platform      TEXT NOT NULL,                       -- openai | anthropic | custom
        type          TEXT NOT NULL DEFAULT 'api_key',     -- api_key | oauth | codex_pat
        base_url      TEXT,                                -- 自定义上游地址（api_key/custom 用）
        api_key       TEXT,                                -- 明文上游 key（不落盘时可为空）
        credentials   JSONB NOT NULL DEFAULT '{}',         -- oauth codex 凭据
        extra         JSONB NOT NULL DEFAULT '{}',
        proxy_id      BIGINT REFERENCES proxies(id) ON DELETE SET NULL,
        concurrency   INTEGER NOT NULL DEFAULT 4,
        priority      INTEGER NOT NULL DEFAULT 1,
        rate_multiplier NUMERIC(8,4) NOT NULL DEFAULT 1,
        status        TEXT NOT NULL DEFAULT 'active',      -- active | paused | disabled
        last_error    TEXT,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      -- 账号-分组 关联
      CREATE TABLE IF NOT EXISTS account_groups (
        account_id  BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        group_id    BIGINT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
        PRIMARY KEY (account_id, group_id)
      );

      -- ============ API Key（终端用户令牌）============
      CREATE TABLE IF NOT EXISTS api_keys (
        id              BIGSERIAL PRIMARY KEY,
        user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name            TEXT NOT NULL DEFAULT 'default',
        key_prefix      TEXT NOT NULL,                     -- 明文展示用前缀
        key_hash        TEXT NOT NULL UNIQUE,              -- 存储 sha256 哈希
        key_tail        TEXT NOT NULL,                     -- 末 4 位，便于识别
        model_whitelist TEXT[],                            -- 模型白名单，空 = 全部
        group_id        BIGINT REFERENCES groups(id) ON DELETE SET NULL,
        status          TEXT NOT NULL DEFAULT 'active',    -- active | disabled | expired
        rps_limit       INTEGER,                           -- 每秒请求上限（null=不限）
        rpm_limit       INTEGER,                           -- 每分钟请求上限
        tpm_limit       BIGINT,                            -- 每分钟 token 上限
        expires_at      TIMESTAMPTZ,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_used_at    TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);

      -- ============ 价格表 ============
      CREATE TABLE IF NOT EXISTS model_prices (
        id            BIGSERIAL PRIMARY KEY,
        model         TEXT NOT NULL UNIQUE,                -- 完整模型名或通配/前缀（以 * 结尾）
        input_price   NUMERIC(14,8) NOT NULL DEFAULT 0,    -- 美元/百万token(1M tokens)
        output_price  NUMERIC(14,8) NOT NULL DEFAULT 0,
        cache_read_price  NUMERIC(14,8) NOT NULL DEFAULT 0,
        cache_write_price NUMERIC(14,8) NOT NULL DEFAULT 0,
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      INSERT INTO model_prices (model, input_price, output_price) VALUES
        ('gpt-4o',               2.5,  10.0),
        ('gpt-4o-mini',          0.15, 0.6),
        ('gpt-4.1',              2.0,  8.0),
        ('gpt-4.1-mini',         0.4,  1.6),
        ('gpt-4.1-nano',         0.1,  0.4),
        ('o1',                   15.0, 60.0),
        ('o3',                   2.0,  8.0),
        ('o4-mini',              1.1,  4.4),
        ('gpt-3.5-turbo',        0.5,  1.5),
        ('chatgpt-4o-latest',    2.5,  10.0),
        ('codex-*',              2.0,  8.0),
        ('claude-opus-4*',       15.0, 75.0),
        ('claude-sonnet-4*',     3.0,  15.0),
        ('claude-3-7-sonnet*',   3.0,  15.0),
        ('claude-3-5-sonnet*',   3.0,  15.0),
        ('claude-3-5-haiku*',    0.8,  4.0),
        ('text-embedding-3-small', 0.02, 0),
        ('text-embedding-3-large', 0.13, 0)
      ON CONFLICT (model) DO NOTHING;

      -- ============ 请求日志 ============
      CREATE TABLE IF NOT EXISTS request_logs (
        id            BIGSERIAL PRIMARY KEY,
        user_id       BIGINT,
        api_key_id    BIGINT,
        account_id    BIGINT,
        model         TEXT,
        endpoint      TEXT,                                -- chat/completions | messages | responses
        platform      TEXT,
        stream        BOOLEAN NOT NULL DEFAULT false,
        prompt_tokens BIGINT NOT NULL DEFAULT 0,
        completion_tokens BIGINT NOT NULL DEFAULT 0,
        cached_tokens BIGINT NOT NULL DEFAULT 0,
        cost          NUMERIC(14,8) NOT NULL DEFAULT 0,    -- 本请求消耗（美元）
        success       BOOLEAN NOT NULL DEFAULT true,
        status_code   INTEGER,
        error_message TEXT,
        latency_ms    INTEGER,
        ip            TEXT,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_reqlog_created ON request_logs(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_reqlog_user ON request_logs(user_id);
      CREATE INDEX IF NOT EXISTS idx_reqlog_key ON request_logs(api_key_id);
      CREATE INDEX IF NOT EXISTS idx_reqlog_account ON request_logs(account_id);

      -- ============ 限额计数（滑动窗口）============
      CREATE TABLE IF NOT EXISTS rate_counters (
        scope     TEXT NOT NULL,                           -- key:{id}:minute | key:{id}:second
        bucket    TEXT NOT NULL,
        count     BIGINT NOT NULL DEFAULT 0,
        PRIMARY KEY (scope, bucket)
      );

      -- ============ OAuth 会话（对接 FlowPilot）============
      CREATE TABLE IF NOT EXISTS oauth_sessions (
        id             BIGSERIAL PRIMARY KEY,
        session_id     TEXT NOT NULL UNIQUE,
        state          TEXT NOT NULL,
        code_verifier  TEXT NOT NULL,
        redirect_uri   TEXT NOT NULL,
        proxy_id       BIGINT,
        client_id      TEXT NOT NULL,
        platform       TEXT NOT NULL DEFAULT 'openai',
        created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
        expires_at     TIMESTAMPTZ NOT NULL
      );

      -- ============ 系统设置 ============
      CREATE TABLE IF NOT EXISTS settings (
        key        TEXT PRIMARY KEY,
        value      JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      INSERT INTO settings (key, value) VALUES
        ('system_name', '"中转站 Plus"'),
        ('run_mode',   '"full"')
      ON CONFLICT (key) DO NOTHING;
    `,
  },
  {
    version: 2,
    name: 'billing-and-invite',
    sql: `
      -- ============ 充值套餐 ============
      CREATE TABLE IF NOT EXISTS plans (
        id           BIGSERIAL PRIMARY KEY,
        name         TEXT NOT NULL,
        description  TEXT,
        amount       NUMERIC(14,6) NOT NULL,          -- 售价（美元）
        credit       NUMERIC(14,6) NOT NULL,          -- 到账额度（美元）
        enabled      BOOLEAN NOT NULL DEFAULT true,
        sort         INTEGER NOT NULL DEFAULT 0,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      -- ============ 充值订单 ============
      CREATE TABLE IF NOT EXISTS orders (
        id            BIGSERIAL PRIMARY KEY,
        order_no      TEXT NOT NULL UNIQUE,           -- 商户单号（对外）
        user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        plan_id       BIGINT,                          -- 套餐订单；自定义充值为 NULL
        amount        NUMERIC(14,6) NOT NULL,
        credit        NUMERIC(14,6) NOT NULL,
        channel       TEXT NOT NULL DEFAULT 'manual',  -- manual/alipay/wechat/stripe/...
        provider_order_id TEXT,                        -- 支付渠道单号
        status        TEXT NOT NULL DEFAULT 'pending', -- pending/paid/cancelled/expired/refunded
        remark        TEXT,
        paid_at       TIMESTAMPTZ,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        expires_at    TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

      -- ============ 邀请 / 推广码 ============
      CREATE TABLE IF NOT EXISTS invite_codes (
        id           BIGSERIAL PRIMARY KEY,
        code         TEXT NOT NULL UNIQUE,
        owner_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,  -- 归属用户（分销）
        max_uses     INTEGER NOT NULL DEFAULT 1,       -- 0=不限
        used_count   INTEGER NOT NULL DEFAULT 0,
        enabled      BOOLEAN NOT NULL DEFAULT true,
        reward_credit NUMERIC(14,6) NOT NULL DEFAULT 0, -- 被邀请人获赠额度
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      -- ============ 邀请使用记录 ============
      CREATE TABLE IF NOT EXISTS invite_uses (
        id           BIGSERIAL PRIMARY KEY,
        invite_id    BIGINT NOT NULL REFERENCES invite_codes(id) ON DELETE CASCADE,
        user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      -- ============ 免费体验（防滥用）============
      CREATE TABLE IF NOT EXISTS free_grants (
        user_id      BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        amount       NUMERIC(14,6) NOT NULL,
        granted_at   TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `,
  },
  {
    version: 3,
    name: 'gift-cards',
    sql: `
      -- ============ 卡密 / 兑换码 ============
      CREATE TABLE IF NOT EXISTS gift_cards (
        id           BIGSERIAL PRIMARY KEY,
        code         TEXT NOT NULL UNIQUE,
        credit       NUMERIC(14,6) NOT NULL,          -- 兑换得的额度（美元）
        status       TEXT NOT NULL DEFAULT 'unused',   -- unused | used | disabled
        batch        TEXT,                              -- 批次名（发卡管理）
        used_by      BIGINT,                            -- 使用人 user_id
        used_at      TIMESTAMPTZ,
        created_by   BIGINT,                            -- 生成人（管理员）
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_gift_cards_code ON gift_cards(code);

      -- ============ 卡密兑换记录 ============
      CREATE TABLE IF NOT EXISTS gift_card_uses (
        id           BIGSERIAL PRIMARY KEY,
        card_id      BIGINT NOT NULL REFERENCES gift_cards(id) ON DELETE CASCADE,
        user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        credit       NUMERIC(14,6) NOT NULL,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `,
  },
  {
    version: 4,
    name: 'totp',
    sql: `
      ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT false;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_last_code TEXT;
    `,
  },
  {
    version: 5,
    name: 'subscriptions',
    sql: `
      -- plans 增加订阅类型相关字段
      ALTER TABLE plans ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'prepaid';   -- prepaid 按量 / subscription 订阅
      ALTER TABLE plans ADD COLUMN IF NOT EXISTS period_days INTEGER;                    -- 订阅周期天数(如月30)
      ALTER TABLE plans ADD COLUMN IF NOT EXISTS monthly_credit NUMERIC(14,6);           -- 每期可用额度($)

      -- 用户订阅
      CREATE TABLE IF NOT EXISTS user_subscriptions (
        id             BIGSERIAL PRIMARY KEY,
        user_id        BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        plan_id        BIGINT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
        status         TEXT NOT NULL DEFAULT 'active',     -- active / expired / cancelled
        monthly_credit NUMERIC(14,6) NOT NULL,
        used_credit    NUMERIC(14,6) NOT NULL DEFAULT 0,
        renewed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),  -- 本期开始
        expires_at     TIMESTAMPTZ NOT NULL,                -- 本期到期
        prev_credit    NUMERIC(14,6) NOT NULL DEFAULT 0,    -- 上一期剩余(购买时转移)
        created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_user_subs_user ON user_subscriptions(user_id, status);
      CREATE INDEX IF NOT EXISTS idx_user_subs_expires ON user_subscriptions(expires_at);
    `,
  },
  {
    version: 6,
    name: 'audit-logs',
    sql: `
      -- ============ 操作审计日志（管理员行为留痕）============
      CREATE TABLE IF NOT EXISTS audit_logs (
        id          BIGSERIAL PRIMARY KEY,
        actor_id    BIGINT,                                -- 操作人（管理员/用户）
        actor_email TEXT,
        action      TEXT NOT NULL,                          -- create_user / update_balance / delete_account / ...
        target_type TEXT,                                   -- user / account / group / plan / gift_card / order ...
        target_id   BIGINT,
        detail      JSONB NOT NULL DEFAULT '{}',
        ip          TEXT,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs(actor_id);
      CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);
    `,
  },
  {
    version: 7,
    name: 'roles',
    sql: `
      -- ============ 角色（自定义权限矩阵）============
      CREATE TABLE IF NOT EXISTS roles (
        id          BIGSERIAL PRIMARY KEY,
        name        TEXT NOT NULL UNIQUE,
        description TEXT,
        permissions TEXT[] NOT NULL DEFAULT '{}',     -- 权限点 key 数组
        is_system   BOOLEAN NOT NULL DEFAULT false,   -- 系统内置（admin 不可删）
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      -- 内置角色：超级管理员（拥有全部权限，requirePerm 特判 admin 全过）
      INSERT INTO roles (name, description, permissions, is_system)
        VALUES ('sales', '销售/运营：用户、订单、卡密、日志', ARRAY['dashboard.view','order.view','order.confirm','card.manage','invite.manage','user.manage','log.view','channel.health'], false)
      ON CONFLICT (name) DO NOTHING;
      -- 财务：仅订单/流水/看用户
      INSERT INTO roles (name, description, permissions, is_system)
        VALUES ('finance', '财务：订单与流水', ARRAY['dashboard.view','order.view','order.confirm'], false)
      ON CONFLICT (name) DO NOTHING;
      -- 客服/只读：查看
      INSERT INTO roles (name, description, permissions, is_system)
        VALUES ('support', '客服/运维：只读查看', ARRAY['dashboard.view','user.manage','log.view','channel.health','order.view','card.manage'], false)
      ON CONFLICT (name) DO NOTHING;

      ALTER TABLE users ADD COLUMN IF NOT EXISTS role_id BIGINT REFERENCES roles(id) ON DELETE SET NULL;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions TEXT[] ;   -- 直接覆盖权限（可选，覆盖角色）
    `,
  },
  {
    version: 8,
    name: 'password-reset',
    sql: `
      CREATE TABLE IF NOT EXISTS password_reset_codes (
        id          BIGSERIAL PRIMARY KEY,
        user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        code        TEXT NOT NULL,
        expires_at  TIMESTAMPTZ NOT NULL,
        consumed    BOOLEAN NOT NULL DEFAULT false,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_prc_user ON password_reset_codes(user_id);
      CREATE INDEX IF NOT EXISTS idx_prc_code ON password_reset_codes(code);
    `,
  },
  {
    version: 9,
    name: 'group-rate-and-peak-pricing',
    sql: `
      -- 分组级售价倍率：用户实付 = 官方价 × 分组倍率（默认 1 = 不改变现有计费）
      ALTER TABLE groups ADD COLUMN IF NOT EXISTS rate_multiplier NUMERIC(8,4) NOT NULL DEFAULT 1;

      -- 谷峰定价字段（高峰时段价）。null = 该模型未启用谷峰（用普通价）。
      -- 高峰时段规则由前端/后端共享常量定义（默认工作日 9-12、14-18 为高峰）。
      ALTER TABLE model_prices ADD COLUMN IF NOT EXISTS peak_input_price      NUMERIC(14,8);
      ALTER TABLE model_prices ADD COLUMN IF NOT EXISTS peak_output_price     NUMERIC(14,8);
      ALTER TABLE model_prices ADD COLUMN IF NOT EXISTS peak_cache_read_price NUMERIC(14,8);
      ALTER TABLE model_prices ADD COLUMN IF NOT EXISTS peak_cache_write_price NUMERIC(14,8);
    `,
  },
  {
    version: 10,
    name: 'charge-rebate',
    sql: `
      -- 多充多送：每个套餐可配置赠送返利额度（充值到账 = amount + rebate）
      ALTER TABLE plans ADD COLUMN IF NOT EXISTS rebate NUMERIC(14,6) NOT NULL DEFAULT 0;

      -- 订单记录本次到账的返利与计价单位（¥）
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS rebate NUMERIC(14,6) NOT NULL DEFAULT 0;
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'CNY';
    `,
  },
  {
    version: 11,
    name: 'api-key-encrypted-plaintext',
    sql: `
      -- 加密存储 API Key 明文（用于用户自选 Key 时自动填充/复制），用 JWT_SECRET 派生密钥加密。
      ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS key_enc TEXT;
    `,
  },
  {
    version: 12,
    name: 'model-price-provider',
    sql: `
      -- 模型价格按供应商分组（截图模式：Claude / GPT / Gemini / DeepSeek / Grok / Mistral ...）
      ALTER TABLE model_prices ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'openai';
      ALTER TABLE model_prices ADD COLUMN IF NOT EXISTS context_window BIGINT;

      -- 官方渠道标价（用于「官方价/渠道价」对比展示）
      ALTER TABLE model_prices ADD COLUMN IF NOT EXISTS official_input_price  NUMERIC(14,8);
      ALTER TABLE model_prices ADD COLUMN IF NOT EXISTS official_output_price NUMERIC(14,8);

      -- 为已有 seed 模型标注供应商
      UPDATE model_prices SET provider = 'openai' WHERE model LIKE 'gpt-%' OR model LIKE 'o1%' OR model LIKE 'o3%' OR model LIKE 'o4%' OR model LIKE 'chatgpt-%' OR model LIKE 'codex-%' OR model LIKE 'text-embedding-%';
      UPDATE model_prices SET provider = 'anthropic' WHERE model LIKE 'claude-%';
      UPDATE model_prices SET provider = 'deepseek' WHERE model LIKE 'deepseek-%';

      -- 补常见主流供应商模型价格种子（input/output $/1M，官方标价）
      INSERT INTO model_prices (model, provider, input_price, output_price, official_input_price, official_output_price, cache_read_price, cache_write_price, context_window) VALUES
        ('claude-opus-4-5',        'anthropic',  15,  75,     15,  75, 1.5, 18.75, 200000),
        ('claude-sonnet-4-5',      'anthropic',   3,  15,      3,  15, 0.3,  3.75, 200000),
        ('claude-haiku-4-5',       'anthropic',   1,   5,      1,   5, 0.1,  1.25, 200000),
        ('claude-3-7-sonnet',      'anthropic',   3,  15,      3,  15, 0.3,  3.75, 200000),
        ('gemini-2.5-pro',         'google',      1.25, 10,   1.25, 10, 0.31, 2.5, 1000000),
        ('gemini-2.5-flash',       'google',      0.3,  2.5,  0.3,  2.5, 0.075, 0.625, 1000000),
        ('gemini-1.5-pro',         'google',      1.25, 5,    1.25, 5,   0.31, 1.25, 2000000),
        ('grok-4',                 'xai',         3,    15,    3,    15, 0.75, 3.75, 256000),
        ('grok-3',                 'xai',         3,    15,    3,    15, 0.75, 3.75, 131072),
        ('grok-3-mini',            'xai',         0.3,  0.5,  0.3,  0.5, 0.075, 0.125, 131072),
        ('deepseek-v3',            'deepseek',    0.27, 1.1,  0.27, 1.1, 0.07, 0,   64000),
        ('deepseek-r1',            'deepseek',    0.55, 2.19, 0.55, 2.19, 0.14, 0,  64000),
        ('mistral-large',          'mistral',     2,    6,    2,    6,   0.5,  1.5, 128000),
        ('mistral-small',          'mistral',     0.5,  1.5,  0.5,  1.5, 0.125, 0.375, 32000),
        ('llama-3.3-70b',          'meta',        0.9,  0.9,  0.9,  0.9, 0.225, 0.225, 128000),
        ('qwen-2.5-72b',           'qwen',        1.2,  3.6,  1.2,  3.6, 0.3,  0.9, 131072)
      ON CONFLICT (model) DO NOTHING;
    `,
  },
];

export async function runMigrations(): Promise<void> {
  await query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);

  for (const mig of MIGRATIONS) {
    const existing = await query<{ version: number }>(
      'SELECT version FROM schema_migrations WHERE version = $1',
      [mig.version]
    );
    if (existing.rowCount && existing.rowCount > 0) continue;

    const client = await (await import('./pool.js')).pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(mig.sql);
      await client.query('INSERT INTO schema_migrations (version, name) VALUES ($1, $2)', [mig.version, mig.name]);
      await client.query('COMMIT');
      // eslint-disable-next-line no-console
      console.log(`[migrate] applied v${mig.version} (${mig.name})`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}

// 直接以脚本运行：npm run migrate
const isMain = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('/db/migrate.ts');
if (isMain) {
  runMigrations()
    .then(async () => { await closePool(); })
    .catch(async (err) => { console.error(err); await closePool(); process.exit(1); });
}
