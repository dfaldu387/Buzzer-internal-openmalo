// SHA-256 PIN hashing with per-user salt and key stretching.
// Pure JS implementation — no native module dependencies.

const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
  0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function utf8Encode(str: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i);
    if (c < 0x80) {
      bytes.push(c);
    } else if (c < 0x800) {
      bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else if (c >= 0xd800 && c < 0xdc00 && i + 1 < str.length) {
      const next = str.charCodeAt(++i);
      c = 0x10000 + ((c - 0xd800) << 10) + (next - 0xdc00);
      bytes.push(
        0xf0 | (c >> 18),
        0x80 | ((c >> 12) & 0x3f),
        0x80 | ((c >> 6) & 0x3f),
        0x80 | (c & 0x3f),
      );
    } else {
      bytes.push(
        0xe0 | (c >> 12),
        0x80 | ((c >> 6) & 0x3f),
        0x80 | (c & 0x3f),
      );
    }
  }
  return bytes;
}

function sha256(message: string): string {
  const bytes = utf8Encode(message);
  const bitLen = bytes.length * 8;

  bytes.push(0x80);
  while (bytes.length % 64 !== 56) {
    bytes.push(0);
  }
  bytes.push(0, 0, 0, 0);
  bytes.push(
    (bitLen >>> 24) & 0xff,
    (bitLen >>> 16) & 0xff,
    (bitLen >>> 8) & 0xff,
    bitLen & 0xff,
  );

  let h0 = 0x6a09e667,
    h1 = 0xbb67ae85,
    h2 = 0x3c6ef372,
    h3 = 0xa54ff53a;
  let h4 = 0x510e527f,
    h5 = 0x9b05688c,
    h6 = 0x1f83d9ab,
    h7 = 0x5be0cd19;

  const rotr = (n: number, x: number) => ((x >>> n) | (x << (32 - n))) >>> 0;

  for (let offset = 0; offset < bytes.length; offset += 64) {
    const w: number[] = new Array(64);

    for (let i = 0; i < 16; i++) {
      w[i] =
        ((bytes[offset + i * 4] << 24) |
          (bytes[offset + i * 4 + 1] << 16) |
          (bytes[offset + i * 4 + 2] << 8) |
          bytes[offset + i * 4 + 3]) >>>
        0;
    }

    for (let i = 16; i < 64; i++) {
      const s0 =
        (rotr(7, w[i - 15]) ^ rotr(18, w[i - 15]) ^ (w[i - 15] >>> 3)) >>> 0;
      const s1 =
        (rotr(17, w[i - 2]) ^ rotr(19, w[i - 2]) ^ (w[i - 2] >>> 10)) >>> 0;
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = h0,
      b = h1,
      c = h2,
      d = h3,
      e = h4,
      f = h5,
      g = h6,
      h = h7;

    for (let i = 0; i < 64; i++) {
      const S1 = (rotr(6, e) ^ rotr(11, e) ^ rotr(25, e)) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = (rotr(2, a) ^ rotr(13, a) ^ rotr(22, a)) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, '0');
  return (
    hex(h0) + hex(h1) + hex(h2) + hex(h3) + hex(h4) + hex(h5) + hex(h6) + hex(h7)
  );
}

let saltCounter = 0;
function generateSalt(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let salt = '';
  const randomBytes = new Uint8Array(16);
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.getRandomValues) {
    globalThis.crypto.getRandomValues(randomBytes);
  } else {
    // Fallback: use Date.now() + performance counter + counter for entropy.
    // Still not cryptographic, but better than bare Math.random().
    const seed = Date.now() ^ (typeof performance !== 'undefined' ? performance.now() * 1000 : 0) ^ (++saltCounter);
    for (let i = 0; i < 16; i++) {
      // xorshift32-style mixing
      let s = (seed + i * 2654435761) >>> 0;
      s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
      randomBytes[i] = s & 0xff;
    }
  }
  for (let i = 0; i < 16; i++) {
    salt += chars[randomBytes[i] % chars.length];
  }
  return salt;
}

/** Hash a PIN with a random salt and 1000 rounds of SHA-256. */
export function hashPin(pin: string): string {
  const salt = generateSalt();
  let hash = sha256(`${salt}:${pin}:openmalo_buzzer_v2`);
  for (let i = 0; i < 1000; i++) {
    hash = sha256(`${salt}:${hash}`);
  }
  return `v2:${salt}:${hash}`;
}

/** Verify a PIN against a stored hash (supports legacy DJB2 format). */
export function verifyPin(pin: string, storedHash: string): boolean {
  if (storedHash.startsWith('v2:')) {
    const parts = storedHash.split(':');
    if (parts.length !== 3) return false;
    const salt = parts[1];
    let hash = sha256(`${salt}:${pin}:openmalo_buzzer_v2`);
    for (let i = 0; i < 1000; i++) {
      hash = sha256(`${salt}:${hash}`);
    }
    return parts[2] === hash;
  }
  // Legacy DJB2 format — kept for migration
  return storedHash === legacyHashPin(pin);
}

function legacyHashPin(pin: string): string {
  let hash = 0;
  const str = `openmalo_${pin}_salt`;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return hash.toString(36);
}
