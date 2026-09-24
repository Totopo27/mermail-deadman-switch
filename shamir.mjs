import crypto from "node:crypto";

// Galois Field GF(2^8) using primitive polynomial 0x11d with generator 2
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
const POLY = 0x11d;

let x = 1;
for (let i = 0; i < 255; i++) {
  EXP[i] = x;
  EXP[i + 255] = x;
  LOG[x] = i;
  x = (x << 1) ^ ((x & 0x80) ? POLY : 0);
}
LOG[0] = 0;

function gmul(a, b) {
  if (a === 0 || b === 0) return 0;
  return EXP[(LOG[a] + LOG[b]) % 255];
}

function gdiv(a, b) {
  if (b === 0) throw new Error("GF(256) division by zero");
  if (a === 0) return 0;
  return EXP[(LOG[a] - LOG[b] + 255) % 255];
}

/**
 * Splits a secret string or Buffer into n shares with threshold k (k-of-n).
 * @param {string|Buffer} secret 
 * @param {number} n Total shares to generate (default: 3)
 * @param {number} k Threshold required to reconstruct (default: 2)
 * @returns {Array<{ id: number, data: string }>}
 */
export function splitSecret(secret, n = 3, k = 2) {
  if (k < 2 || k > n) throw new Error("Invalid threshold: must satisfy 2 <= k <= n");
  if (n > 255) throw new Error("Maximum shares exceeded (max 255 in GF256)");

  const secretBytes = typeof secret === "string" ? Buffer.from(secret, "utf-8") : secret;
  const len = secretBytes.length;

  const shares = [];
  for (let i = 1; i <= n; i++) {
    shares.push({ id: i, data: new Uint8Array(len) });
  }

  for (let b = 0; b < len; b++) {
    const a0 = secretBytes[b];
    const coeffs = new Uint8Array(k);
    coeffs[0] = a0;
    const randomBytes = crypto.randomBytes(k - 1);
    for (let c = 1; c < k; c++) {
      coeffs[c] = randomBytes[c - 1];
    }

    for (let s = 0; s < n; s++) {
      const xVal = shares[s].id;
      let yVal = 0;
      let xPow = 1;
      for (let c = 0; c < k; c++) {
        yVal ^= gmul(coeffs[c], xPow);
        xPow = gmul(xPow, xVal);
      }
      shares[s].data[b] = yVal;
    }
  }

  return shares.map(s => ({
    id: s.id,
    data: Buffer.from(s.data).toString("hex")
  }));
}

/**
 * Reconstructs the secret using Lagrange interpolation from any k shares.
 * @param {Array<{ id: number, data: string }>} shares
 * @returns {string} The reconstructed secret
 */
export function combineShares(shares) {
  if (!Array.isArray(shares) || shares.length < 2) {
    throw new Error("At least 2 shares are required to reconstruct");
  }

  const k = shares.length;
  const byteShares = shares.map(s => ({
    id: s.id,
    bytes: Buffer.from(s.data, "hex")
  }));

  const len = byteShares[0].bytes.length;
  for (const s of byteShares) {
    if (s.bytes.length !== len) throw new Error("Mismatched share lengths");
  }

  const result = new Uint8Array(len);

  for (let b = 0; b < len; b++) {
    let secretByte = 0;

    for (let i = 0; i < k; i++) {
      const xi = byteShares[i].id;
      const yi = byteShares[i].bytes[b];

      let li = 1;
      for (let j = 0; j < k; j++) {
        if (i === j) continue;
        const xj = byteShares[j].id;
        const numerator = xj;
        const denominator = xi ^ xj;
        li = gmul(li, gdiv(numerator, denominator));
      }

      secretByte ^= gmul(yi, li);
    }

    result[b] = secretByte;
  }

  return Buffer.from(result).toString("utf-8");
}
