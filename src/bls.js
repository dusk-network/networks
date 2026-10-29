/**
 * The BLS12-381 G2 points Dusk's public keys are: read from an account's 96
 * bytes, written back, and in the raw form contracts take a key in, each
 * checked to be a key: on the curve, in its prime-order subgroup, and not
 * the identity, as Dusk's `G2Affine::from_compressed` checks one. Keys are
 * public, so plain BigInt arithmetic does.
 *
 * @module
 */

/** @typedef {[bigint, bigint]} Fp2 An element c0 + c1·u, where u² = −1. */
/** @typedef {{ x: Fp2, y: Fp2 }} Point An affine point of G2. */
/** @typedef {{ x: Fp2, y: Fp2, z: Fp2 }} Jacobian (x / z², y / z³); z = 0 is the identity. */

/** The base field's modulus. */
const P = BigInt(
  "0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaab"
);

/** The Montgomery radix, 2^384 mod P, in which a raw key keeps its coordinates. */
const R = (1n << 384n) % P;

/** R's inverse mod P. */
const R_INVERSE = BigInt(
  "0x14fec701e8fb0ce9ed5e64273c4f538b1797ab1458a88de9343ea97914956dc87fe11274d898fafbf4d38259380b4820"
);

const HALF = (P - 1n) / 2n;

/** |x|, for BLS12-381's parameter x = −0xd201000000010000. */
const X = 0xd201000000010000n;

const FP_BYTES = 48;

/** A compressed key's bytes: x as c1 then c0, big-endian, with three flags on top. */
export const COMPRESSED_BYTES = 2 * FP_BYTES;

/** A raw key's bytes: x.c0, x.c1, y.c0, y.c1, little-endian in Montgomery form, then the identity flag. */
export const RAW_KEY_BYTES = 4 * FP_BYTES + 1;

/** @param {bigint} a */
const mod = (a) => {
  const r = a % P;

  return r < 0n ? r + P : r;
};

/** @type {(a: Fp2, b: Fp2) => Fp2} */
const add = ([a0, a1], [b0, b1]) => [mod(a0 + b0), mod(a1 + b1)];

/** @type {(a: Fp2, b: Fp2) => Fp2} */
const sub = ([a0, a1], [b0, b1]) => [mod(a0 - b0), mod(a1 - b1)];

/** @type {(a: Fp2, b: Fp2) => Fp2} */
const mul = ([a0, a1], [b0, b1]) => [mod(a0 * b0 - a1 * b1), mod(a0 * b1 + a1 * b0)];

/** @type {(a: Fp2) => Fp2} */
const square = ([a0, a1]) => [mod((a0 + a1) * (a0 - a1)), mod(2n * a0 * a1)];

/** @type {(a: Fp2, k: bigint) => Fp2} */
const times = ([a0, a1], k) => [mod(a0 * k), mod(a1 * k)];

/** @type {(a: Fp2) => Fp2} */
const negate = ([a0, a1]) => [mod(-a0), mod(-a1)];

/** The Frobenius map on Fp2: u to −u. @type {(a: Fp2) => Fp2} */
const conjugate = ([a0, a1]) => [a0, mod(-a1)];

/** @type {(a: Fp2, b: Fp2) => boolean} */
const equal = ([a0, a1], [b0, b1]) => a0 === b0 && a1 === b1;

/** @type {(a: Fp2) => boolean} */
const isZero = ([a0, a1]) => a0 === 0n && a1 === 0n;

/**
 * @param {Fp2} base
 * @param {bigint} exponent
 * @returns {Fp2}
 */
function pow(base, exponent) {
  /** @type {Fp2} */
  let result = [1n, 0n];

  for (let bit = exponent, power = base; bit > 0n; bit >>= 1n) {
    if (bit & 1n) result = mul(result, power);
    power = square(power);
  }

  return result;
}

/**
 * 1 / a, for a that isn't 0: (c0 − c1·u) / (c0² + c1²).
 *
 * @param {Fp2} a
 * @returns {Fp2}
 */
function invert([a0, a1]) {
  const [norm] = pow([mod(a0 * a0 + a1 * a1), 0n], P - 2n);

  return [mod(a0 * norm), mod(-a1 * norm)];
}

/**
 * A square root, or null when there is none: Algorithm 9 of
 * https://eprint.iacr.org/2012/685.pdf, as bls12_381's `Fp2::sqrt`.
 *
 * @param {Fp2} a
 * @returns {Fp2 | null}
 */
function sqrt(a) {
  const a1 = pow(a, (P - 3n) / 4n);
  const alpha = mul(square(a1), a);
  const x0 = mul(a1, a);
  const root = equal(alpha, [P - 1n, 0n]) ? mul(x0, [0n, 1n]) : mul(pow(add(alpha, [1n, 0n]), HALF), x0);

  return equal(square(root), a) ? root : null;
}

/** The curve G2 is on: y² = x³ + 4(u + 1). @type {Fp2} */
const B = [4n, 4n];

/**
 * Whether y is the larger of its two roots, as the compressed form's sort
 * flag says: c1 past (P − 1) / 2, or c1 zero and c0 past it.
 *
 * @param {Fp2} y
 */
const largest = ([y0, y1]) => y1 > HALF || (y1 === 0n && y0 > HALF);

/** @param {Point} point */
const onCurve = ({ x, y }) => equal(square(y), add(mul(square(x), x), B));

/** @type {{ x: Fp2, y: Fp2 } | null} */
let psiCoefficients = null;

/**
 * ψ, untwist-Frobenius-twist: (x̄ / ξ^((P−1)/3), ȳ / ξ^((P−1)/2)), with
 * ξ = u + 1, as bls12_381's `G2Projective::psi`.
 *
 * @param {Point} point
 * @returns {Point}
 */
function psi({ x, y }) {
  if (!psiCoefficients) {
    /** @type {Fp2} */
    const xi = [1n, 1n];

    psiCoefficients = { x: invert(pow(xi, (P - 1n) / 3n)), y: invert(pow(xi, (P - 1n) / 2n)) };
  }

  return { x: mul(conjugate(x), psiCoefficients.x), y: mul(conjugate(y), psiCoefficients.y) };
}

/** @type {Jacobian} */
const IDENTITY = Object.freeze({ x: [0n, 0n], y: [1n, 0n], z: [0n, 0n] });

/**
 * 2·p ("dbl-2009-l", for a = 0).
 *
 * @param {Jacobian} p
 * @returns {Jacobian}
 */
function double(p) {
  if (isZero(p.z)) return IDENTITY;

  const a = square(p.x);
  const b = square(p.y);
  const c = square(b);
  const d = times(sub(sub(square(add(p.x, b)), a), c), 2n);
  const e = times(a, 3n);
  const x = sub(square(e), times(d, 2n));

  return { x, y: sub(mul(e, sub(d, x)), times(c, 8n)), z: times(mul(p.y, p.z), 2n) };
}

/**
 * p + q, for an affine q ("madd-2007-bl"), the cases it leaves out apart.
 *
 * @param {Jacobian} p
 * @param {Point} q
 * @returns {Jacobian}
 */
function addPoint(p, q) {
  if (isZero(p.z)) return { x: q.x, y: q.y, z: [1n, 0n] };

  const z1z1 = square(p.z);
  const h = sub(mul(q.x, z1z1), p.x);
  const r = times(sub(mul(mul(q.y, p.z), z1z1), p.y), 2n);

  if (isZero(h)) return isZero(r) ? double(p) : IDENTITY;

  const hh = square(h);
  const i = times(hh, 4n);
  const j = mul(h, i);
  const v = mul(p.x, i);
  const x = sub(sub(square(r), j), times(v, 2n));

  return {
    x,
    y: sub(mul(r, sub(v, x)), times(mul(p.y, j), 2n)),
    z: sub(sub(square(add(p.z, h)), z1z1), hh),
  };
}

/**
 * Whether a point of the curve is in G2, the subgroup of prime order:
 * ψ(p) = [x]p, Scott's test (https://eprint.iacr.org/2021/1130), as
 * bls12_381's `is_torsion_free`. [x]p is −[|x|]p.
 *
 * @param {Point} point
 */
function inSubgroup(point) {
  let q = IDENTITY;

  for (let bit = 63n; bit >= 0n; bit--) {
    q = double(q);
    if ((X >> bit) & 1n) q = addPoint(q, point);
  }

  if (isZero(q.z)) return false;

  const image = psi(point);
  const z2 = square(q.z);

  return equal(q.x, mul(image.x, z2)) && equal(negate(q.y), mul(image.y, mul(z2, q.z)));
}

/** @param {Uint8Array} bytes */
const bigEndian = (bytes) => bytes.reduce((value, byte) => (value << 8n) | BigInt(byte), 0n);

/**
 * @param {Uint8Array} bytes
 * @param {number} at
 */
function littleEndian(bytes, at) {
  let value = 0n;

  for (let i = FP_BYTES - 1; i >= 0; i--) value = (value << 8n) | BigInt(bytes[at + i]);

  return value;
}

/**
 * @param {Uint8Array} out
 * @param {number} at
 * @param {bigint} value
 * @param {boolean} little
 */
function write(out, at, value, little) {
  let rest = value;

  for (let i = 0; i < FP_BYTES; i++) {
    out[at + (little ? i : FP_BYTES - 1 - i)] = Number(rest & 0xffn);
    rest >>= 8n;
  }
}

/**
 * The key a compressed key's bytes are, or null when they're no key: not
 * marked compressed, the identity, a coordinate past the modulus, an x no
 * point has, or a point outside G2.
 *
 * @param {Uint8Array} bytes
 * @returns {Point | null}
 */
export function decompress(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length !== COMPRESSED_BYTES) return null;

  const flags = bytes[0];

  if (!(flags & 0x80) || flags & 0x40) return null;

  const high = Uint8Array.from(bytes.subarray(0, FP_BYTES));

  high[0] &= 0x1f;

  /** @type {Fp2} */
  const x = [bigEndian(bytes.subarray(FP_BYTES)), bigEndian(high)];

  if (x[0] >= P || x[1] >= P) return null;

  const root = sqrt(add(mul(square(x), x), B));

  if (!root) return null;

  const point = { x, y: largest(root) === Boolean(flags & 0x20) ? root : negate(root) };

  return inSubgroup(point) ? point : null;
}

/**
 * A key's 96 bytes, as an account carries them.
 *
 * @param {Point} point
 * @returns {Uint8Array}
 */
export function compress({ x, y }) {
  const out = new Uint8Array(COMPRESSED_BYTES);

  write(out, 0, x[1], false);
  write(out, FP_BYTES, x[0], false);
  out[0] |= 0x80 | (largest(y) ? 0x20 : 0);

  return out;
}

/**
 * The key a raw key's bytes are, or null when they're no key: another
 * length, the identity flag set, a coordinate past the modulus, or a point
 * off the curve or outside G2.
 *
 * @param {Uint8Array} raw
 * @returns {Point | null}
 */
export function fromRaw(raw) {
  if (!(raw instanceof Uint8Array) || raw.length !== RAW_KEY_BYTES || raw[RAW_KEY_BYTES - 1] !== 0) return null;

  const montgomery = [0, 1, 2, 3].map((i) => littleEndian(raw, i * FP_BYTES));

  if (montgomery.some((value) => value >= P)) return null;

  const [x0, x1, y0, y1] = montgomery.map((value) => (value * R_INVERSE) % P);
  /** @type {Point} */
  const point = { x: [x0, x1], y: [y0, y1] };

  return onCurve(point) && inSubgroup(point) ? point : null;
}

/**
 * A key's raw form, as `PublicKey::to_raw_bytes` gives it.
 *
 * @param {Point} point
 * @returns {Uint8Array}
 */
export function toRaw({ x, y }) {
  const out = new Uint8Array(RAW_KEY_BYTES);

  [x[0], x[1], y[0], y[1]].forEach((value, i) => write(out, i * FP_BYTES, (value * R) % P, true));

  return out;
}
