#!/usr/bin/env node
/**
 * Checks every network file against schema.json.
 *
 *   node scripts/validate.mjs
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { validate } from "./lib/schema.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const schema = JSON.parse(readFileSync(join(ROOT, "schema.json"), "utf8"));
const files = readdirSync(join(ROOT, "networks")).filter((f) => f.endsWith(".json"));
let failed = 0;

for (const file of files.sort()) {
  const errors = validate(schema, JSON.parse(readFileSync(join(ROOT, "networks", file), "utf8")));

  if (errors.length) {
    failed += 1;
    console.log(`${file}:`);
    for (const error of errors) console.log(`  ${error}`);
  } else {
    console.log(`${file}: ok`);
  }
}

if (failed) process.exitCode = 1;
