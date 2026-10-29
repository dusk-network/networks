import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEPOSIT_GAS, SOZU_GAS, TRANSFER_GAS, WITHDRAWAL_GAS, WITHDRAWAL_RELAY_GAS, withdrawalGasLimit } from "../src/gas.js";
import { SOZU_GAS as SOZU_GAS_OF_SOZU } from "../src/sozu.js";

describe("gas", () => {
  it("gives the apps' limits and floors: the web wallet's, the extension's and the bridge's", () => {
    // Both wallets' "public-transfer" and the bridge's TRANSFER_GAS_LIMIT.
    assert.deepEqual(TRANSFER_GAS, { limit: 2_500_000n, minimum: 2_000_000n, typical: 1_850_000n });
    // The web wallet's "bridge" and the bridge's DEPOSIT_GAS_LIMIT.
    assert.deepEqual(DEPOSIT_GAS, { limit: 5_000_000n, minimum: 2_500_000n, typical: 2_000_000n });
    assert.deepEqual(WITHDRAWAL_GAS, { limit: 50_000_000n, typical: 2_300_000n });
    assert.equal(WITHDRAWAL_RELAY_GAS, 1_000_000n);
    // Sozu's, the same object /sozu gives.
    assert.equal(SOZU_GAS, SOZU_GAS_OF_SOZU);

    for (const gas of [TRANSFER_GAS, DEPOSIT_GAS, WITHDRAWAL_GAS]) assert.ok(Object.isFrozen(gas));

    for (const { limit, minimum, typical } of [TRANSFER_GAS, DEPOSIT_GAS]) {
      assert.ok(typical < minimum && minimum < limit);
    }
  });

  it("gives a withdrawal's proof and its claim one limit: 50M and the withdrawal's own gas, at least 1M", () => {
    // A 10 DUSK testnet withdrawal's own call, raised by DuskEVM's messenger.
    assert.equal(withdrawalGasLimit(519_542n), 51_000_000n);
    assert.equal(withdrawalGasLimit(), 51_000_000n);
    assert.equal(withdrawalGasLimit(9_000_000n), 59_000_000n);
    assert.equal(withdrawalGasLimit("2000000"), 52_000_000n);
    assert.equal(withdrawalGasLimit(1_000_001), 51_000_001n);
    assert.throws(() => withdrawalGasLimit(-1n), RangeError);
  });
});
