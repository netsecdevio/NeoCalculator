// Real virtual-key clicks. Diagnostics only observe the existing public state.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium,firefox,webkit} from 'playwright';
import {startStaticServer} from './test-server.mjs';
const source=resolve(process.env.NUMOS_SOURCE||'.');
const browserName=process.env.NUMOS_BROWSER||'chromium';
const root=resolve(source,'out/wasm/dist/release');
const out=resolve(process.env.NUMOS_CALC_OUT||'out/calc-core-input-01/web',browserName);
await mkdir(out,{recursive:true});
const server=await startStaticServer(root,8890+['chromium','firefox','webkit'].indexOf(browserName));
const browser=await {chromium,firefox,webkit}[browserName].launch({headless:true});
const fixtures=JSON.parse(await readFile(new URL('../emulator/calculation-input.json',import.meta.url),'utf8'));
const ids={'^':'r2c4',exp:'r9c2',neg:'r9c3','-':'r8c4','+':'r8c3','*':'r7c3','/':'r2c1','.':'r9c1','(':'r4c3',')':'r4c4',log:'r3c0',SHIFT:'r0c0',LEFT:'r1c1',RIGHT:'r1c3',DEL:'r6c3',AC:'r6c4',ENTER:'r9c4'};
for(const [digit,id] of Object.entries({'0':'r9c0','1':'r8c0','2':'r8c1','3':'r8c2','4':'r7c0','5':'r7c1','6':'r7c2','7':'r6c0','8':'r6c1','9':'r6c2'}))ids[digit]=id;
ids.sin='r3c2';
const records=[];
const numeric=text=>{
  // Test-only reading of scalar outputs, never a product/runtime parser.
  // The pinned WASM Giac may preserve sqrt(4) or its reciprocal exactly.
  // Accept only these constant-root shapes, with an independent perfect-square
  // check; do not require the product to change valid exact answers to decimals.
  const root=text.match(/^\(?sqrt\((\d+)\)\)?(?:\^(-1))?$/);
  if(root) {
    const n=Number(root[1]),r=Math.sqrt(n);
    assert.ok(Number.isSafeInteger(n) && Number.isInteger(r) && r*r===n);
    return root[2] ? 1/r : r;
  }
  assert.match(text,/^-?\d+(?:\.\d*)?(?:e[+-]?\d+)?(?:\/-?\d+)?$/i);
  const [a,b='1']=text.split('/');return Number(a)/Number(b);
};
try{
 for(const surface of ['shell','component']) {
  // Isolated profile; keep its persistence enabled throughout all fixtures.
  const context=await browser.newContext({viewport:{width:1100,height:1100},deviceScaleFactor:1});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.goto(server.origin+(surface==='shell'?'/index.html?start=launcher':'/fixture.html'));
  if(surface==='component') {
   await page.waitForFunction(()=>customElements.get('numos-emulator'));
   await page.evaluate(()=>{const el=document.createElement('numos-emulator');el.setAttribute('controls','');document.body.append(el);});
   await page.locator('numos-emulator').locator('[data-action=overlay-start]').click();
  }
  const el=page.locator('numos-emulator');
  await page.waitForFunction(()=>document.querySelector('numos-emulator')?.diagnosticState()?.ready,null,{timeout:60000});
  if(!await el.locator('[data-physical-id=r9c4]').isVisible())await el.locator('[data-action=controls]').click();
  const state=()=>el.evaluate(e=>e.diagnosticState());
  const key=async token=>{assert.ok(ids[token],token);await el.locator(`[data-physical-id="${ids[token]}"]`).click();await page.waitForTimeout(45);};
  const sequence=async text=>{for(const k of text.split(' '))await key(k);};
  const capture=async name=>{const canvas=el.locator('canvas');const data=await canvas.evaluate(c=>({width:c.width,height:c.height,png:c.toDataURL().split(',')[1]}));assert.equal(data.width,320);assert.equal(data.height,240);await writeFile(resolve(out,`${surface}-${name}.png`),Buffer.from(data.png,'base64'));};
  await key('ENTER');await page.waitForTimeout(350);assert.equal((await state()).app,'Calculation');
  assert.equal(await el.locator('[data-physical-id=r9c2]').getAttribute('data-key-id'),'EXP');
  for(const f of fixtures.filter(f=>!f.keys.includes('divide'))) {
   await key('AC');await sequence(f.keys);await capture(f.id+'-before');
   await key('ENTER');const s=await state();
   records.push({surface,id:f.id,keys:f.keys,state:s});
   assert.equal(s.calculation.status,'ok',surface+' '+f.id);
   const expected=Number(f.expected),actual=numeric(s.calculation.exact);
   assert.ok(Math.abs(actual-expected)<=Math.max(1e-14,Math.abs(expected)*2e-13),`${f.id}: ${actual} != ${expected}`);
   await capture(f.id+'-after');
  }
  await sequence('AC 2 exp neg ENTER');assert.equal((await state()).calculation.status,'parse_error');
  await sequence('3 ENTER');assert.equal(numeric((await state()).calculation.exact),0.002);
  await sequence('DEL 5 ENTER');assert.equal(numeric((await state()).calculation.exact),0.00002);
  // The PC keyboard is a different route from the virtual keypad above.
  await key('AC');await el.locator('canvas').focus();
  for(const k of ['1','0','^','n','3','Enter']) {await page.keyboard.press(k);await page.waitForTimeout(50);}
  records.push({surface,id:'desktop-negative',state:await state()});
  assert.equal(numeric((await state()).calculation.exact),0.001);
  await key('AC');await el.locator('canvas').focus();
  // Reproduce the repeated-caret/edit path, through desktop DOM keyboard input.
  for(const k of ['2','^','^','2','Backspace','Backspace','-','2','Enter']) {
   await page.keyboard.press(k);await page.waitForTimeout(50);
  }
  assert.equal((await state()).calculation.status,'ok');
  assert.equal(numeric((await state()).calculation.exact),0.25);
  await capture('desktop-negative-recovery');
  assert.deepEqual(errors,[]);
  await context.close();
 }
 console.log(`PASS ${browserName}: virtual keypad, shell/component, desktop keyboard, incomplete recovery`);
}finally{
 await writeFile(resolve(out,'results.json'),JSON.stringify(records,null,2));
 await browser.close();await server.close();
}
