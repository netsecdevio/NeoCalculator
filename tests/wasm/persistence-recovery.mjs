import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
// Import the standalone browser module without changing the repository's Node mode.
const source = await readFile(new URL("../../wasm/numos-persistence.js", import.meta.url), "utf8");
const { createPersistenceController } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const originalIndexedDB = globalThis.indexedDB;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const metadata = JSON.stringify({ schemaVersion: 1,
  numosStorageFormatVersion: "settings:ST01;variables:VR01;neo:source-v1", buildIdentity: "test" });
function fixture(options = {}) {
  let writeSyncs = 0;
  let fail = true;
  let held = null;
  let hold = false;
  let metadataFails = false;
  const module = { IDBFS: { dbs: {} }, FS: {
    mkdir() {}, mount() {}, unmount() {},
    writeFile() { if (metadataFails) throw new Error("metadata write unavailable"); }, readdir: () => [],
    readFile: () => metadata,
    syncfs(populate, done) {
      if (populate) return done();
      writeSyncs++;
      if (hold) held = done;
      else done(fail ? new Error("storage temporarily unavailable") : null);
    },
  } };
  const controller = createPersistenceController("test", options);
  return { controller, module, get writes() { return writeSyncs; },
    failMetadata() { metadataFails = true; },
    recover() { fail = false; metadataFails = false; }, hold() { hold = true; },
    finish() { hold = false; held(new Error("storage temporarily unavailable")); } };
}
try {
  let deletedDatabases = 0;
  globalThis.indexedDB = { deleteDatabase() {
    deletedDatabases++;
    const request = {}; queueMicrotask(() => request.onsuccess()); return request;
  } };
  for (const options of [{ disabled: true }, { testMode: "indexeddb-denied" }]) {
    const ephemeral = fixture(options);
    await ephemeral.controller.initialize(ephemeral.module);
    const before = deletedDatabases;
    await assert.rejects(ephemeral.controller.resetPersistentStorage(), /not active/);
    assert.equal(deletedDatabases, before, "ephemeral sessions cannot delete a shared database");
    assert.equal(ephemeral.writes, 0);
    await ephemeral.controller.dispose();
  }
  const first = fixture();
  await first.controller.initialize(first.module);
  first.controller.markDirty();
  await assert.rejects(first.controller.flushPersistence(), /temporarily unavailable/);
  await delay(360);
  assert.equal(first.writes, 1, "a persistent failure must not spin on a timer");
  first.recover();
  first.controller.markDirty();
  await delay(360);
  assert.equal(first.writes, 2, "a subsequent edit retries automatically");
  assert.equal(first.controller.snapshot().state, "persistent_ready");
  assert.equal(first.controller.snapshot().dirty, false);
  await first.controller.dispose();

  const metadataFailure = fixture();
  await metadataFailure.controller.initialize(metadataFailure.module);
  metadataFailure.recover(); metadataFailure.failMetadata();
  metadataFailure.controller.markDirty();
  let metadataFlush;
  assert.doesNotThrow(() => { metadataFlush = metadataFailure.controller.flushPersistence(); });
  await assert.rejects(metadataFlush, /metadata write unavailable/);
  assert.equal(metadataFailure.controller.snapshot().state, "persistent_error");
  assert.equal(metadataFailure.controller.snapshot().flushInProgress, false);
  metadataFailure.recover(); metadataFailure.controller.markDirty();
  await delay(360);
  assert.equal(metadataFailure.controller.snapshot().state, "persistent_ready");
  assert.equal(metadataFailure.controller.snapshot().dirty, false);
  await metadataFailure.controller.dispose();

  for (const action of ["dispose", "resetPersistentStorage"]) {
    const current = fixture();
    await current.controller.initialize(current.module);
    current.hold(); current.controller.markDirty();
    const flush = current.controller.flushPersistence().catch(() => {});
    current.controller.markDirty(); // New work while this sync is pending.
    const stopping = current.controller[action]();
    await Promise.resolve(); // Metadata and sync run within the returned promise.
    current.finish();
    await Promise.all([flush, stopping]);
    assert.equal(current.controller.snapshot().pendingTimer, false,
      `${action} must prevent the in-flight completion from scheduling work`);
    await current.controller.dispose();
  }
  const concurrent = fixture();
  await concurrent.controller.initialize(concurrent.module);
  concurrent.hold(); concurrent.controller.markDirty();
  const pending = concurrent.controller.flushPersistence().catch(() => {});
  concurrent.controller.markDirty(); await Promise.resolve(); concurrent.finish();
  await pending;
  assert.equal(concurrent.controller.snapshot().pendingTimer, true,
    "an edit made during a failed sync must not be stranded");
  concurrent.recover(); await delay(360);
  assert.equal(concurrent.controller.snapshot().state, "persistent_ready");
  await concurrent.controller.dispose();
  console.log("Persistence recovery: subsequent edits, in-flight edits, no retry loop, dispose/reset passed");
} finally {
  if (originalIndexedDB === undefined) delete globalThis.indexedDB;
  else globalThis.indexedDB = originalIndexedDB;
}
