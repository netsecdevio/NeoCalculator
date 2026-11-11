import assert from 'node:assert/strict';
import {mkdtemp, mkdir, cp, readFile, appendFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
const root=resolve('.'), temp=await mkdtemp(join(tmpdir(),'numos-package-'));
try {
  execFileSync('git',['clone','--shared','--no-checkout',root,temp],{stdio:'pipe'});
  execFileSync('git',['checkout','HEAD','--','wasm/math','wasm/emscripten.version','.gitignore'],{cwd:temp,stdio:'pipe'});
  // Test the current candidate packager, including local edits, in an isolated checkout.
  await cp(join(root,'wasm/math/package.mjs'),join(temp,'wasm/math/package.mjs'));
  await mkdir(join(temp,'out/wasm-math'),{recursive:true});
  await cp(join(root,'out/wasm-math/release'),join(temp,'out/wasm-math/release'),{recursive:true});
  const build=async()=>{
    execFileSync(process.execPath,['wasm/math/package.mjs','Release'],{cwd:temp,stdio:'pipe'});
    const dist=join(temp,'out/wasm-math/dist/release');
    const manifest=JSON.parse(await readFile(join(dist,'numos-math-assets.json'),'utf8'));
    const workspace=await readFile(join(dist,manifest.assets.workspace.url),'utf8');
    const token=workspace.match(/numos-math-assets\.json\?v=([a-f0-9]+)/)[1];
    return {manifest,token};
  };
  await appendFile(join(temp,'wasm/math/numos-math-client.js'),'\n// first dirty build\n');
  const first=await build();
  await appendFile(join(temp,'wasm/math/numos-math-client.js'),'\n// second dirty build\n');
  const second=await build();
  assert.equal(first.manifest.build.gitRevision,second.manifest.build.gitRevision);
  assert.match(first.manifest.build.identity,/-dirty$/);
  assert.match(second.manifest.build.identity,/-dirty$/);
  assert.notEqual(first.manifest.assets.client.sha256,second.manifest.assets.client.sha256);
  assert.notEqual(first.token,second.token);
  console.log('PASS: same-HEAD dirty builds receive distinct manifest tokens');
} finally {await rm(temp,{recursive:true,force:true});}
