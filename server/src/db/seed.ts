import '../env.js'; // 加载项目根 .env（单一配置源）
import bcrypt from 'bcryptjs';
import { query, closePool } from './pool.js';

/** 创建管理员账号（若不存在）。邮箱/密码来自 .env。 */
export async function seed(): Promise<void> {
  const email = (process.env.ADMIN_EMAIL || 'admin@relay.local').toLowerCase();
  const password = process.env.ADMIN_PASSWORD || '';

  const existing = await query<{ id: string }>('SELECT id FROM users WHERE email = $1', [email]);
  if (existing.rowCount && existing.rowCount > 0) {
    console.log('[seed] admin already exists, skip');
    return;
  }

  if (!password || password.length < 8) {
    throw new Error('[security] 首次初始化需要设置 ADMIN_PASSWORD（≥8 字符），否则无法创建管理员。请先配置环境变量后重试。');
  }

  const hash = await bcrypt.hash(password, 10);
  await query(
    `INSERT INTO users (email, password_hash, username, role, status, balance)
     VALUES ($1, $2, $3, 'admin', 'active', 100000)
     ON CONFLICT (email) DO NOTHING`,
    [email, hash, 'admin']
  );
  console.log('[seed] admin created. 首次登录后请立即修改密码。');
}

// 直接以脚本运行：npm run seed
const isMain = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('/db/seed.ts');
if (isMain) {
  seed()
    .then(async () => { await closePool(); })
    .catch(async (err) => { console.error(err); await closePool(); process.exit(1); });
}
