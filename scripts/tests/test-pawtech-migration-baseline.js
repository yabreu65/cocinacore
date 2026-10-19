#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const { validateShoppingListBaseline } = require("../../frontend/scripts/migration-baseline");

for (const item_count of [0, 1, 12]) {
  assert.doesNotThrow(() =>
    validateShoppingListBaseline({ item_count, bytes: "81920" }),
  );
}

assert.throws(
  () => validateShoppingListBaseline({ item_count: 0, bytes: "81921" }),
  /size ceiling/,
);

for (const item_count of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, "1.5"]) {
  assert.throws(() =>
    validateShoppingListBaseline({ item_count, bytes: "0" }),
  );
}
for (const bytes of [-1, 1.5, "not-a-number"]) {
  assert.throws(() => validateShoppingListBaseline({ item_count: 0, bytes }));
}

console.log("pawtech migration baseline passed");
