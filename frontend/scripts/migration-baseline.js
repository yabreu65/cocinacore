"use strict";

const MAX_SHOPPING_LIST_RELATION_BYTES = 81920;

function parseNonnegativeInteger(value, name, safe) {
  let parsed;
  if (typeof value === "number") {
    if (!Number.isInteger(value) || (safe && !Number.isSafeInteger(value))) {
      throw new TypeError(`${name} must be a nonnegative integer`);
    }
    parsed = BigInt(value);
  } else if (typeof value === "string" && /^\d+$/.test(value)) {
    parsed = BigInt(value);
  } else {
    throw new TypeError(`${name} must be a nonnegative integer`);
  }

  if (parsed < 0n || (safe && parsed > BigInt(Number.MAX_SAFE_INTEGER))) {
    throw new RangeError(`${name} is out of range`);
  }
  return parsed;
}

function validateShoppingListBaseline(row) {
  if (!row || typeof row !== "object") {
    throw new TypeError("shopping-list relation baseline is missing");
  }

  parseNonnegativeInteger(row.item_count, "shopping-list row count", true);
  const bytes = parseNonnegativeInteger(row.bytes, "shopping-list relation size", false);
  if (bytes > BigInt(MAX_SHOPPING_LIST_RELATION_BYTES)) {
    throw new RangeError("shopping-list relation exceeds the size ceiling");
  }
}

module.exports = { validateShoppingListBaseline };
