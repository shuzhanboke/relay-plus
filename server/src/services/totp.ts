import crypto from 'crypto';

/**
 * 极简 TOTP 实现（RFC 6238，HMAC-SHA1，6 位，30s 步进），
 * 与 Google Authenticator / Authy 兼容。纯 crypto 实现，无需第三方依赖。
 */

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** 生成随机 BASE32 secret（160bit → 32 字符）。 */
export function generateSecret(): string {
  const bytes = crypto.randomBytes(20);
  let bits = '';
  for (const b of bytes) bits += b.toString(2).padStart(8, '0');
  let secret = '';
  for (let i = 0; i < bits.length; i += 5) {
    secret += BASE32[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
  }
  return secret;
}

function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/g, '').toUpperCase();
  let bits = '';
  for (const ch of clean) {
    const idx = BASE32.indexOf(ch);
    if (idx < 0) continue;
    bits += idx.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

/** 生成用于扫码的 otpauth:// URL。issuer 需做 config 校验。 */
export function otpauthUrl(secret: string, account: string, issuer: string): string {
  return 'otpauth://totp/' + encodeURIComponent(`${issuer}:${account}`) +
    '?secret=' + secret + '&issuer=' + encodeURIComponent(issuer) + '&algorithm=SHA1&digits=6&period=30';
}

function hotp(secret: Buffer, counter: number): number {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', secret).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  return ((hmac[offset] & 0x7f) << 24 | (hmac[offset + 1] & 0xff) << 16 |
    (hmac[offset + 2] & 0xff) << 8 | (hmac[offset + 3] & 0xff)) % 1_000_000;
}

/** 校验 TOTP code（±1 个时间窗口容差）。 */
export function validateTotp(secret: string, code: string, window = 1): boolean {
  if (!/^\d{6}$/.test(String(code).trim())) return false;
  const key = base32Decode(secret);
  const counter = Math.floor(Date.now() / 1000 / 30);
  for (let i = -window; i <= window; i++) {
    if (String(hotp(key, counter + i)).padStart(6, '0') === String(code).trim()) return true;
  }
  return false;
}
