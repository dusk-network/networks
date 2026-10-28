/**
 * Multicall for Dusk's `aggregate`, encoded and decoded by hand as the rkyv
 * 0.7 archives (32-bit sizes) its contract reads and writes, so the scripts
 * need no data driver. One query carries every call and answers each one.
 */

const encoder = new TextEncoder();

/** A name of up to 7 bytes sits inline in rkyv 0.7's 8-byte string slot. */
const INLINE = 7;

/** An archived call: callee, function name, argument, gas limit. */
const CALL = 56;

/** An archived result: a tag, then the bytes or the error. */
const SLOT = 16;

/** The archived reply's root: the height, then the results. */
const ROOT = 16;

const align = (n, to) => Math.ceil(n / to) * to;

/** @param {string} hex */
export const fromHex = (hex) =>
  Uint8Array.from(hex.match(/../g) ?? [], (b) => parseInt(b, 16));

/** @param {Uint8Array} bytes */
export const toHex = (bytes) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/**
 * The `aggregate` argument: a `Vec<Call>`. Each call's name (when longer
 * than 7 bytes) and argument come first, in call order, then the calls,
 * then the vector's offset and length.
 *
 * @param {{ contractId: string, fnName: string, args: Uint8Array, gasLimit?: bigint }[]} calls
 * @returns {Uint8Array}
 */
export function encodeAggregate(calls) {
  const names = calls.map((call) => encoder.encode(call.fnName));
  const data = calls.reduce(
    (n, call, i) => n + (names[i].length > INLINE ? names[i].length : 0) + call.args.length,
    0
  );
  const array = align(data, 8);
  const out = new Uint8Array(array + CALL * calls.length + 8);
  const view = new DataView(out.buffer);
  const at = [];
  let pos = 0;

  calls.forEach((call, i) => {
    const name = pos;

    if (names[i].length > INLINE) {
      out.set(names[i], pos);
      pos += names[i].length;
    }

    at.push({ args: pos, name });
    out.set(call.args, pos);
    pos += call.args.length;
  });

  calls.forEach((call, i) => {
    const slot = array + i * CALL;
    const name = names[i];

    out.set(fromHex(call.contractId), slot);

    if (name.length > INLINE) {
      view.setUint32(slot + 32, name.length, true);
      view.setInt32(slot + 36, at[i].name - (slot + 32), true);
    } else {
      out.set(name, slot + 32);
      out[slot + 39] = name.length;
    }

    view.setInt32(slot + 40, at[i].args - (slot + 40), true);
    view.setUint32(slot + 44, call.args.length, true);
    view.setBigUint64(slot + 48, call.gasLimit ?? 0n, true);
  });

  const root = array + CALL * calls.length;

  view.setInt32(root, array - root, true);
  view.setUint32(root + 4, calls.length, true);

  return out;
}

/**
 * The `aggregate` reply: the height the query read at, and each call's
 * result, `{ ok: bytes }` or `{ error: "OutOfGas" | "DoesNotExist" |
 * "Unknown" | "Panic: …" }`.
 *
 * @param {Uint8Array} bytes
 * @param {number} expected The number of calls sent
 */
export function decodeAggregate(bytes, expected) {
  if (bytes.length < ROOT || bytes.length % 8 !== 0) {
    throw new Error("Not a Multicall reply");
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const root = bytes.length - ROOT;
  const height = view.getBigUint64(root, true);
  const count = view.getUint32(root + 12, true);

  if (count !== expected) {
    throw new Error(`Multicall answered ${count} calls, not ${expected}`);
  }

  const slots = root + 8 + view.getInt32(root + 8, true);
  const results = [];

  for (let i = 0; i < count; i++) {
    const slot = slots + i * SLOT;

    if (bytes[slot] === 0) {
      const start = slot + 4 + view.getInt32(slot + 4, true);

      results.push({
        ok: bytes.slice(start, start + view.getUint32(slot + 8, true)),
      });
      continue;
    }

    const kind = bytes[slot + 4];

    if (kind === 1) results.push({ error: "OutOfGas" });
    else if (kind === 2) results.push({ error: "DoesNotExist" });
    else if (kind === 3) results.push({ error: "Unknown" });
    else {
      // The message, an rkyv 0.7 string: inline with its length last, or its
      // length, then its offset from the slot's start.
      const repr = slot + 8;
      const last = bytes[repr + 7];
      const start = repr + view.getInt32(repr + 4, true);
      const text =
        (last & 0x80) === 0
          ? bytes.subarray(repr, repr + last)
          : bytes.subarray(start, start + view.getUint32(repr, true));

      results.push({ error: `Panic: ${new TextDecoder().decode(text)}` });
    }
  }

  return { height, results };
}
