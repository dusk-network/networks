/**
 * A JSON Schema (2020-12) check for the keywords schema.json uses, so the
 * repo needs no validator package. A keyword it doesn't know throws, so a
 * rule can't be skipped without notice.
 */

/** The keywords checked here, after three annotations with nothing to check. */
const KEYWORDS = new Set([
  "$schema",
  "description",
  "title",
  "$defs",
  "$ref",
  "additionalProperties",
  "anyOf",
  "enum",
  "items",
  "maximum",
  "minLength",
  "minimum",
  "pattern",
  "properties",
  "propertyNames",
  "required",
  "type",
  "uniqueItems",
]);

/**
 * A value as JSON with every object's keys sorted, so values JSON Schema
 * calls equal give the same text whatever order their keys are in.
 *
 * @param {unknown} value
 */
const canonical = (value) =>
  JSON.stringify(value, (_, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : item
  );

/** @param {unknown} value */
function typeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return typeof value;
}

/**
 * Every place `data` breaks `schema`, as "path: what's wrong".
 *
 * @param {any} root The whole schema, for `$ref`s
 * @param {unknown} data
 * @returns {string[]}
 */
export function validate(root, data) {
  /**
   * @param {any} schema
   * @param {unknown} value
   * @param {string} path
   * @param {string[]} errors
   */
  function check(schema, value, path, errors) {
    if (schema === true) return;
    if (schema === false) {
      errors.push(`${path}: not allowed`);
      return;
    }

    for (const keyword of Object.keys(schema)) {
      if (!KEYWORDS.has(keyword)) {
        throw new Error(`schema keyword "${keyword}" isn't checked here`);
      }
    }

    if (schema.$ref) {
      const match = /^#\/\$defs\/([^/]+)$/.exec(schema.$ref);
      const target = match ? root.$defs?.[match[1]] : undefined;

      if (!target) throw new Error(`can't follow $ref ${schema.$ref}`);
      check(target, value, path, errors);
    }

    if (schema.type !== undefined) {
      const types = Array.isArray(schema.type) ? schema.type : [schema.type];
      const actual = typeOf(value);

      if (!types.some((/** @type {string} */ t) => t === actual || (t === "number" && actual === "integer"))) {
        errors.push(`${path}: should be ${types.join(" or ")}, is ${actual}`);
        return;
      }
    }

    if (schema.enum && !schema.enum.some((/** @type {unknown} */ e) => canonical(e) === canonical(value))) {
      errors.push(`${path}: should be one of ${JSON.stringify(schema.enum)}`);
    }

    if (schema.anyOf) {
      const outcomes = schema.anyOf.map((/** @type {any} */ option) => {
        /** @type {string[]} */
        const found = [];

        check(option, value, path, found);

        return found;
      });

      if (!outcomes.some((found) => found.length === 0)) {
        errors.push(`${path}: matches no option (${outcomes.map((f) => f[0]).join("; ")})`);
      }
    }

    if (typeof value === "string") {
      if (schema.pattern && !new RegExp(schema.pattern, "u").test(value)) {
        errors.push(`${path}: "${value}" doesn't match ${schema.pattern}`);
      }
      if (schema.minLength !== undefined && value.length < schema.minLength) {
        errors.push(`${path}: shorter than ${schema.minLength}`);
      }
    }

    if (typeof value === "number") {
      if (schema.minimum !== undefined && value < schema.minimum) {
        errors.push(`${path}: under ${schema.minimum}`);
      }
      if (schema.maximum !== undefined && value > schema.maximum) {
        errors.push(`${path}: over ${schema.maximum}`);
      }
    }

    if (Array.isArray(value)) {
      if (schema.uniqueItems) {
        const seen = value.map(canonical);

        if (new Set(seen).size !== seen.length) errors.push(`${path}: items repeat`);
      }
      if (schema.items !== undefined) {
        value.forEach((item, i) => check(schema.items, item, `${path}[${i}]`, errors));
      }
    }

    if (value && typeof value === "object" && !Array.isArray(value)) {
      const record = /** @type {Record<string, unknown>} */ (value);

      for (const key of schema.required ?? []) {
        if (!(key in record)) errors.push(`${path}: missing ${key}`);
      }

      for (const [key, item] of Object.entries(record)) {
        const at = `${path}.${key}`;

        if (schema.propertyNames) check(schema.propertyNames, key, `${at} (name)`, errors);

        if (schema.properties && Object.hasOwn(schema.properties, key)) {
          check(schema.properties[key], item, at, errors);
        } else if (schema.additionalProperties !== undefined) {
          check(schema.additionalProperties, item, at, errors);
        }
      }
    }
  }

  /** @type {string[]} */
  const errors = [];

  check(root, data, "$", errors);

  return errors;
}
