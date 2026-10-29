import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
/** The JS entry points, each with its declarations. */
const ENTRIES = [".", "./sozu", "./rates", "./format", "./duskevm", "./gas", "./account"];
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
      "./duskevm",
      "./gas",
      "./account",
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

    for (const entry of ENTRIES) {
      assert.match(pkg.exports[entry].types, /\.d\.ts$/);
    }

    // The package resolves itself by its own name, as an app would.
    const { networkFor } = await import("@dusk-network/networks");
    const { formatDusk } = await import("@dusk-network/networks/format");
    const { SOZU_GAS } = await import("@dusk-network/networks/sozu");
    const { nativeRateEstimate } = await import("@dusk-network/networks/rates");
    const { claimFrom, decodeBridgeCall } = await import("@dusk-network/networks/duskevm");
    const { TRANSFER_GAS, SOZU_GAS: GAS_SOZU } = await import("@dusk-network/networks/gas");
    const { isAccount } = await import("@dusk-network/networks/account");
    const { default: testnet } = await import("@dusk-network/networks/networks/testnet.json", { with: { type: "json" } });

    assert.equal(networkFor(2)?.duskEvm?.chainId, testnet.duskEvm.chainId);
    assert.equal(typeof formatDusk, "function");
    assert.equal(typeof nativeRateEstimate, "function");
    assert.equal(typeof claimFrom, "function");
    assert.equal(typeof decodeBridgeCall, "function");
    assert.equal(typeof isAccount, "function");
    assert.equal(SOZU_GAS.sozu_stake.limit, 5_000_000n);
    assert.equal(GAS_SOZU, SOZU_GAS);
    assert.equal(TRANSFER_GAS.limit, 2_500_000n);
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
    for (const entry of ENTRIES) {
      const { default: file, types } = pkg.exports[entry];
      const first = readFileSync(new URL(`../${file}`, import.meta.url), "utf8").split("\n")[0];

      assert.equal(first, `/* @ts-self-types="./${types.split("/").pop()}" */`, entry);
    }
  });

  it("packs only the code, the data, the types and the docs", () => {
    // npm 11 prints an array of packages, newer npm an object keyed by name.
    const report = JSON.parse(
      execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: root, encoding: "utf8" })
    );
    const packed = Array.isArray(report) ? report[0] : report[pkg.name];

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
      "src/account.d.ts",
      "src/account.js",
      "src/bls.js",
      "src/duskevm.d.ts",
      "src/duskevm.js",
      "src/format.d.ts",
      "src/format.js",
      "src/gas.d.ts",
      "src/gas.js",
      "src/hex.js",
      "src/index.d.ts",
      "src/index.js",
      "src/keccak.js",
      "src/network-file.d.ts",
      "src/networks.js",
      "src/rates.d.ts",
      "src/rates.js",
      "src/sozu.d.ts",
      "src/sozu.js",
    ]);
  });
});
