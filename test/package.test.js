import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

describe("the package", () => {
  it("is an ES module with no runtime dependencies, under MPL-2.0", () => {
    assert.equal(pkg.name, "@dusk-network/networks");
    assert.equal(pkg.type, "module");
    assert.equal(pkg.license, "MPL-2.0");
    assert.equal(pkg.dependencies, undefined);
    assert.equal(pkg.devDependencies, undefined);
  });

  it("exports each entry point with its types, and the data", async () => {
    assert.deepEqual(Object.keys(pkg.exports), [
      ".",
      "./sozu",
      "./rates",
      "./format",
      "./networks/*.json",
      "./schema.json",
      "./fixtures/sozu-vectors.json",
      "./package.json",
    ]);

    for (const [entry, target] of Object.entries(pkg.exports)) {
      const paths = typeof target === "string" ? [target] : Object.values(target);

      for (const path of paths) {
        for (const file of path.includes("*") ? ["mainnet", "testnet", "devnet"].map((n) => path.replace("*", n)) : [path]) {
          assert.ok(existsSync(new URL(`../${file}`, import.meta.url)), `${entry}: ${file}`);
        }
      }
    }

    for (const entry of [".", "./sozu", "./rates", "./format"]) {
      assert.match(pkg.exports[entry].types, /\.d\.ts$/);
    }

    // The package resolves itself by its own name, as an app would.
    const { networkFor } = await import("@dusk-network/networks");
    const { formatDusk } = await import("@dusk-network/networks/format");
    const { SOZU_GAS } = await import("@dusk-network/networks/sozu");
    const { nativeRateEstimate } = await import("@dusk-network/networks/rates");
    const { default: testnet } = await import("@dusk-network/networks/networks/testnet.json", { with: { type: "json" } });

    assert.equal(networkFor(2)?.duskEvm?.chainId, testnet.duskEvm.chainId);
    assert.equal(typeof formatDusk, "function");
    assert.equal(typeof nativeRateEstimate, "function");
    assert.equal(SOZU_GAS.sozu_stake.limit, 5_000_000n);
  });

  it("is the same package on JSR, as @dusk/networks, with the same entry points", () => {
    const jsr = JSON.parse(readFileSync(new URL("../jsr.json", import.meta.url), "utf8"));
    /** @type {Record<string, string>} */
    const npmExports = {};

    for (const [entry, target] of Object.entries(pkg.exports)) {
      if (entry === "./package.json") continue;

      const file = typeof target === "string" ? target : target.default;

      if (entry.includes("*")) {
        for (const name of ["mainnet", "testnet", "devnet"]) {
          npmExports[entry.replace("*", name)] = file.replace("*", name);
        }
      } else {
        npmExports[entry] = file;
      }
    }

    assert.equal(jsr.name, "@dusk/networks");
    assert.equal(jsr.version, pkg.version);
    assert.equal(jsr.license, pkg.license);
    assert.deepEqual(jsr.exports, npmExports);
    assert.deepEqual(
      [...jsr.publish.include].sort(),
      [...pkg.files.map((/** @type {string} */ f) => f.replace(/\/$/, "")), "LICENSE", "README.md"].sort()
    );
  });

  it("gives JSR the declarations npm uses, for each JS entry point", () => {
    for (const entry of [".", "./sozu", "./rates", "./format"]) {
      const { default: file, types } = pkg.exports[entry];
      const first = readFileSync(new URL(`../${file}`, import.meta.url), "utf8").split("\n")[0];

      assert.equal(first, `/* @ts-self-types="./${types.split("/").pop()}" */`, entry);
    }
  });

  it("packs only the code, the data, the types and the docs", () => {
    const [packed] = JSON.parse(
      execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: root, encoding: "utf8" })
    );

    assert.deepEqual(packed.files.map((/** @type {{ path: string }} */ f) => f.path).sort(), [
      "CHANGELOG.md",
      "LICENSE",
      "README.md",
      "fixtures/sozu-vectors.json",
      "networks/devnet.json",
      "networks/mainnet.json",
      "networks/testnet.json",
      "package.json",
      "schema.json",
      "src/format.d.ts",
      "src/format.js",
      "src/hex.js",
      "src/index.d.ts",
      "src/index.js",
      "src/keccak.js",
      "src/network-file.d.ts",
      "src/rates.d.ts",
      "src/rates.js",
      "src/sozu.d.ts",
      "src/sozu.js",
    ]);
  });
});
