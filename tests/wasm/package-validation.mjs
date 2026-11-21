import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

// Exercise the actual --validate command against isolated copies, never the
// running preview or a release candidate. No compiler or browser is needed.
const source = fileURLToPath(new URL("../../", import.meta.url));
const root = await mkdtemp(join(tmpdir(), "silascalc-package-validation-"));
try {
  await mkdir(join(root, "wasm"));
  await cp(join(source, "wasm/package.mjs"), join(root, "wasm/package.mjs"));
  const dist = join(root, "out/wasm/dist/release");
  await cp(join(source, "out/wasm/dist/release"), dist, { recursive: true });
  const manifestFile = join(dist, "numos-assets.json");
  const original = await readFile(manifestFile);
  const manifest = JSON.parse(original);
  const validate = () => spawnSync(process.execPath,
    [join(root, "wasm/package.mjs"), "Release", "--validate"], { encoding: "utf8" });
  const valid = () => {
    const result = validate();
    assert.equal(result.status, 0, result.stderr);
  };
  const invalid = expected => {
    const result = validate();
    assert.notEqual(result.status, 0, "incomplete or altered package must fail");
    assert.match(result.stderr, expected);
  };
  valid();
  for (const name of ["brand", "phone", "phoneQrsilas", "phoneQrgraphing", "phoneQrscientific"]) {
    const file = join(dist, manifest.assets[name].url);
    const bytes = await readFile(file);
    await rm(file);
    invalid(/ENOENT/);
    await writeFile(file, bytes);
    const tampered = Buffer.from(bytes);
    tampered[0] ^= 1; // Keep length intact so this must fail the digest check.
    await writeFile(file, tampered);
    invalid(/sha256 mismatch/);
    await writeFile(file, bytes);
    const incomplete = structuredClone(manifest);
    delete incomplete.assets[name];
    await writeFile(manifestFile, JSON.stringify(incomplete));
    invalid(/missing manifest asset/);
    await writeFile(manifestFile, original);
    valid();
  }
  const extra = structuredClone(manifest);
  extra.assets.futureAsset = { ...manifest.assets.brand, url: "./missing-future.png" };
  await writeFile(manifestFile, JSON.stringify(extra));
  invalid(/ENOENT/); // Unknown future entries are validated too.
  await writeFile(manifestFile, original);
  valid();
  console.log("Package validation: missing, altered and omitted brand/phone/QR assets rejected; every declared asset checked; intact controls pass.");
} finally {
  await rm(root, { recursive: true, force: true });
}
