import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizePairingCode,
  validPairingCode,
} from "../src/lib/pairing-code.ts";

test("typed and pasted pairing codes normalize before validation", () => {
  for (const text of [
    "ABCD2345",
    "abcd2345",
    " ABCD2345\n",
    "abcd-2345",
    "ABCD 2345",
  ]) {
    const code = normalizePairingCode(text);
    assert.equal(code, "ABCD2345");
    assert(validPairingCode(code));
  }
});

test("normalization does not silently truncate or accept invalid codes", () => {
  for (const text of ["", "ABCD234", "ABCD23456", "ABCD!345", "ＡBCD2345"]) {
    assert.equal(validPairingCode(normalizePairingCode(text)), false);
  }
});
