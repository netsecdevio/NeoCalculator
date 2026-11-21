import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { NUMOS_LOGICAL_KEYS, NUMOS_WEB_KEYPAD_LAYOUT, NUMOS_LOGICAL_KEY_MAX, SILAS_CALCULATOR_LAYOUTS } from "../../wasm/numos-keypad.js";

const source = await readFile(
  new URL("../../src/input/KeyCodes.h", import.meta.url), "utf8");
const body = source.match(/enum class KeyCode\s*:[^{]+\{([\s\S]*?)\};/)?.[1];
assert.ok(body, "KeyCode enum must be present");
const tokens = body
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/.*$/gm, "")
  .split(",")
  .map((token) => token.trim())
  .filter(Boolean);

const expected = [];
let value = -1;
for (const token of tokens) {
  const match = token.match(/^([A-Z][A-Z0-9_]*)(?:\s*=\s*(\d+))?$/);
  assert.ok(match, `unsupported KeyCode declaration: ${token}`);
  value = match[2] ? Number(match[2]) : value + 1;
  if (match[1] !== "NONE") expected.push([match[1], value]);
}

const actual = NUMOS_LOGICAL_KEYS.map(({ id, code }) => [id, code]);
assert.equal(NUMOS_LOGICAL_KEY_MAX, Math.max(...expected.map(([,code])=>code)),
  "the public bridge must accept the whole audited catalog");
assert.deepEqual(actual, expected,
  "web logical-key catalog must exactly match the C++ enum");
assert.equal(new Set(actual.map(([, code]) => code)).size, actual.length,
  "web logical-key codes must be unique");
console.log(`NumOS web logical-key catalog: ${actual.length}/${expected.length}`);
const scientific = NUMOS_WEB_KEYPAD_LAYOUT.flatMap(group=>group.keys).find(key=>key.physicalId==='r9c2');
assert.equal(scientific?.logicalId,'EXP','the visible ×10^ key must not dispatch generic POW');

for (const [name, groups] of Object.entries(SILAS_CALCULATOR_LAYOUTS)) {
  for (const key of groups.flatMap(group => group.keys)) {
    assert.ok(actual.some(([id, code]) => id === key.logicalId && code === key.code),
      `${name}: every key must use its real engine code`);
  }
}
