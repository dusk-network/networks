/**
 * Keccak-256, as Ethereum uses it (the original padding, not SHA3-256's),
 * for EIP-55 checksums. Each 64-bit lane is kept as two 32-bit halves.
 *
 * @module
 */

/** The round constants, as the Keccak reference gives them. */
const ROUND_CONSTANTS = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an,
  0x8000000080008000n, 0x000000000000808bn, 0x0000000080000001n,
  0x8000000080008081n, 0x8000000000008009n, 0x000000000000008an,
  0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n,
  0x8000000000008003n, 0x8000000000008002n, 0x8000000000000080n,
  0x000000000000800an, 0x800000008000000an, 0x8000000080008081n,
  0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];

const RC_LO = ROUND_CONSTANTS.map((c) => Number(c & 0xffffffffn));
const RC_HI = ROUND_CONSTANTS.map((c) => Number(c >> 32n));

/** Each lane's rotation, by its index x + 5y. */
const ROTATIONS = [
  0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8,
  18, 2, 61, 56, 14,
];

/** Where pi moves each lane: (x, y) goes to (y, 2x + 3y). */
const PI = Array.from({ length: 25 }, (_, i) => {
  const x = i % 5;
  const y = Math.floor(i / 5);

  return y + 5 * ((2 * x + 3 * y) % 5);
});

/** Bytes absorbed per block: 1600 bits less twice the 256-bit output. */
const RATE = 136;

/**
 * Keccak-f[1600] on a state of 25 lanes, each lane's low half at 2i and its
 * high half at 2i + 1.
 *
 * @param {Uint32Array} s
 */
function permute(s) {
  const c = new Uint32Array(10);
  const b = new Uint32Array(50);

  for (let round = 0; round < 24; round++) {
    // Theta: each column's parity, folded into its neighbours.
    for (let x = 0; x < 5; x++) {
      c[2 * x] = s[2 * x] ^ s[2 * x + 10] ^ s[2 * x + 20] ^ s[2 * x + 30] ^ s[2 * x + 40];
      c[2 * x + 1] =
        s[2 * x + 1] ^ s[2 * x + 11] ^ s[2 * x + 21] ^ s[2 * x + 31] ^ s[2 * x + 41];
    }

    for (let x = 0; x < 5; x++) {
      const prev = (x + 4) % 5;
      const next = (x + 1) % 5;
      const lo = c[2 * prev] ^ ((c[2 * next] << 1) | (c[2 * next + 1] >>> 31));
      const hi = c[2 * prev + 1] ^ ((c[2 * next + 1] << 1) | (c[2 * next] >>> 31));

      for (let y = 0; y < 25; y += 5) {
        s[2 * (x + y)] ^= lo;
        s[2 * (x + y) + 1] ^= hi;
      }
    }

    // Rho and pi: rotate each lane, and move it.
    for (let i = 0; i < 25; i++) {
      const lo = s[2 * i];
      const hi = s[2 * i + 1];
      const n = ROTATIONS[i];
      const to = 2 * PI[i];

      if (n === 0) {
        b[to] = lo;
        b[to + 1] = hi;
      } else if (n < 32) {
        b[to] = (lo << n) | (hi >>> (32 - n));
        b[to + 1] = (hi << n) | (lo >>> (32 - n));
      } else if (n === 32) {
        b[to] = hi;
        b[to + 1] = lo;
      } else {
        const m = n - 32;

        b[to] = (hi << m) | (lo >>> (32 - m));
        b[to + 1] = (lo << m) | (hi >>> (32 - m));
      }
    }

    // Chi: each lane with the two after it in its row.
    for (let y = 0; y < 25; y += 5) {
      for (let x = 0; x < 5; x++) {
        const i = 2 * (y + x);
        const j = 2 * (y + ((x + 1) % 5));
        const k = 2 * (y + ((x + 2) % 5));

        s[i] = b[i] ^ (~b[j] & b[k]);
        s[i + 1] = b[i + 1] ^ (~b[j + 1] & b[k + 1]);
      }
    }

    // Iota.
    s[0] ^= RC_LO[round];
    s[1] ^= RC_HI[round];
  }
}

/**
 * The Keccak-256 hash of `bytes`.
 *
 * @param {Uint8Array} bytes
 * @returns {Uint8Array} 32 bytes
 */
export function keccak256(bytes) {
  const state = new Uint32Array(50);
  // The message, then the padding: 0x01, zeros, and 0x80 in the last byte of
  // the last block (both in one byte when there's room for only one).
  const blocks = Math.floor(bytes.length / RATE) + 1;
  const padded = new Uint8Array(blocks * RATE);

  padded.set(bytes);
  padded[bytes.length] ^= 0x01;
  padded[padded.length - 1] ^= 0x80;

  const view = new DataView(padded.buffer);

  for (let at = 0; at < padded.length; at += RATE) {
    for (let lane = 0; lane < RATE / 8; lane++) {
      state[2 * lane] ^= view.getUint32(at + 8 * lane, true);
      state[2 * lane + 1] ^= view.getUint32(at + 8 * lane + 4, true);
    }

    permute(state);
  }

  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);

  for (let lane = 0; lane < 4; lane++) {
    outView.setUint32(8 * lane, state[2 * lane], true);
    outView.setUint32(8 * lane + 4, state[2 * lane + 1], true);
  }

  return out;
}
