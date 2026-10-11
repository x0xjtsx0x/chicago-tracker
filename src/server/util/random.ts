import { randomBytes } from 'node:crypto';

/** base64url token; 24 bytes = 192 bits. */
export const randomToken = (bytes = 24): string => randomBytes(bytes).toString('base64url');

const B32 = 'abcdefghijklmnopqrstuvwxyz234567';
/** Lowercase RFC 4648 base32 (no padding). */
export function base32(buf: Uint8Array): string {
  let out = '', bits = 0, value = 0;
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

/**
 * Default ntfy topic. On public ntfy.sh the topic name is the only credential,
 * so it carries 160 bits of randomness: 'ct-' + 32 base32 characters.
 */
export const randomTopic = (): string => `ct-${base32(randomBytes(20))}`;
