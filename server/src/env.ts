/**
 * 统一环境变量加载层。
 * 单一配置源：项目根目录下的 `.env`（所有个人密钥/账户/数据库等凭据只放这一处）。
 * server 各入口不要再用 `import 'dotenv/config'`（cwd 依赖），统一从这里加载。
 */
import { config as dotenvConfig } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// 项目根 = server/src 的上级上级（server/src/env.ts -> server -> 项目根）
const __dirname_local = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname_local, '../..');
const rootEnvPath = resolve(projectRoot, '.env');

// 显式加载项目根 .env，作为最优先来源（不覆盖已存在的进程环境变量）
dotenvConfig({ path: rootEnvPath, override: false });

export { projectRoot, rootEnvPath };
