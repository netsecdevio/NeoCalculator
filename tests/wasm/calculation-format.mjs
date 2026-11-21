import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium,firefox,webkit} from 'playwright';
import {startStaticServer} from './test-server.mjs';
import {calculationDriver} from './calculation-driver.mjs';
const out=resolve(process.env.NUMOS_FORMAT_OUT),server=await startStaticServer(resolve(process.env.NUMOS_WEB_ROOT),8897);
const results=[],trace=[];
try {for(const [name,type] of Object.entries({chromium,firefox,webkit})) {
 if(process.env.NUMOS_BROWSER&&process.env.NUMOS_BROWSER!==name)continue;
 const browser=await type.launch({headless:true});
 try {for(const surface of ['shell','component']) {
  const context=await browser.newContext({viewport:{width:1100,height:1100},deviceScaleFactor:1});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.goto(server.origin+(surface==='shell'?'/index.html?start=launcher':'/fixture.html'));
  if(surface==='component') {
   await page.waitForFunction(()=>customElements.get('numos-emulator'));
   await page.evaluate(()=>{const e=document.createElement('numos-emulator');e.setAttribute('controls','');document.body.append(e);});
   await page.locator('numos-emulator').locator('[data-action=overlay-start]').click();
  }
  await page.waitForFunction(()=>document.querySelector('numos-emulator')?.diagnosticState()?.ready,null,{timeout:60000});
  const el=page.locator('numos-emulator'),folder=resolve(out,name,surface);await mkdir(folder,{recursive:true});
  if(!await el.locator('[data-physical-id=r9c4]').isVisible())await el.locator('[data-action=controls]').click();
  const driver=calculationDriver(page,el,trace),keys=driver.keys;
  const shot=async id=>{
   const data=await el.locator('canvas').evaluate(c=>{
    if(c.width!==320||c.height!==240)throw Error('unexpected framebuffer size');
    const s=document.createElement('canvas');s.width=320;s.height=240;const ctx=s.getContext('2d');ctx.drawImage(c,0,0);
    const p=ctx.getImageData(0,0,320,240).data;let hash=2166136261,blue=0;
    for(let y=25;y<234;y++)for(let x=0;x<320;x++) {
     const i=(y*320+x)*4;
     if(p[i+2]>p[i]+60&&p[i+2]>p[i+1]+25)blue++;
     for(let j=0;j<3;j++)hash=Math.imul(hash^p[i+j],16777619);
    }return {png:c.toDataURL().split(',')[1],hash,blue};
   });
   await writeFile(resolve(folder,id+'.png'),Buffer.from(data.png,'base64'));delete data.png;return data;
  };
  await keys('ENTER');
  // Wait for the existing launcher-to-app transition before taking a golden
  // candidate; otherwise the first formula is blended with launcher icons.
  await driver.settled('launcher-transition');
  for(const [id,input] of [['decimal','0 . 1'],['pi','2 pi'],['root','SQRT '.repeat(24)+'2']]) {
   await keys('AC '+input+' ENTER');const exact=await shot(id+'-exact');
   const semantic=await el.evaluate(e=>e.diagnosticState().calculation);
   await keys('FORMAT');const decimal=await shot(id+'-decimal');assert.notEqual(decimal.hash,exact.hash,id);
   await keys('FORMAT');const back=await shot(id+'-back');assert.equal(back.hash,exact.hash,id);
   assert.deepEqual(await el.evaluate(e=>e.diagnosticState().calculation),semantic);
   results.push({browser:name,version:browser.version(),surface,id,exact,decimal,back});
  }
  await keys('AC 7 / 3 ENTER');const exact=await shot('menu-exact');
  await keys('SHIFT ALPHA FORMAT');const menu=await shot('menu');assert.ok(menu.blue>4000);
  await keys('DOWN DOWN DOWN DOWN DOWN DOWN');const menuEnd=await shot('menu-end');assert.notEqual(menu.hash,menuEnd.hash);
  await keys('ENTER');const mixed=await shot('mixed');assert.notEqual(mixed.hash,exact.hash);
  await keys('FORMAT');assert.equal((await shot('mixed-back')).hash,exact.hash);
  await keys('AC 1 2 3 4 ENTER SHIFT EXP');const eng=await shot('eng');
  await keys('SHIFT EXP');const shifted=await shot('eng-shifted');assert.notEqual(shifted.hash,eng.hash);
  await keys('LEFT');assert.equal((await shot('eng-left')).hash,eng.hash);
  for (const [id,input,select] of [
   ['polar','SQRT NEGATE 1 RIGHT + 1','DOWN DOWN ENTER'],
   ['exponential','SQRT NEGATE 1 RIGHT + 1','DOWN DOWN DOWN ENTER'],
   ['fixed','9 . 9 9 5','DOWN '.repeat(8)+'ENTER ENTER'],
   ['degrees','SHIFT SIN 0 . 5','DOWN '.repeat(6)+'ENTER'],
  ]) {
   await keys('AC '+input+' ENTER');const exact=await shot(id+'-exact');
   const semantic=await el.evaluate(e=>e.diagnosticState().calculation);
   await keys('SHIFT ALPHA FORMAT '+select);const formatted=await shot(id);
   assert.notEqual(formatted.hash,exact.hash,id);
   await keys('FORMAT');assert.equal((await shot(id+'-back')).hash,exact.hash,id);
   assert.deepEqual(await el.evaluate(e=>e.diagnosticState().calculation),semantic);
   results.push({browser:name,version:browser.version(),surface,id,exact,formatted});
  }
  await keys('AC SQRT NEGATE 1 RIGHT + 1 ENTER');
  const clickExact=await shot('click-exact');
  await keys('SHIFT ALPHA FORMAT');
  // Third row of the four-row complex menu in the 320x240 framebuffer.
  await driver.clickCanvas(160,155,'select-polar');
  const selected=await driver.state();assert.equal(selected.presentation.formatMenu,false);assert.equal(selected.presentation.format,8);
  const clicked=await shot('click-polar');
  const keyboardPolar=results.find(r=>r.browser===name&&r.surface===surface&&r.id==='polar').formatted;
  assert.equal(clicked.hash,keyboardPolar.hash,'pointer and keyboard selected different results');
  assert.notEqual(clicked.hash,clickExact.hash,'row click did not apply polar');
  await keys('FORMAT');assert.equal((await shot('click-back')).hash,clickExact.hash);
  // Deliberately omit per-key barriers: detect loss, duplication and order in
  // a real-keypad burst, independently of the synchronized functional path.
  for(let round=0;round<5;++round) {
   await keys('AC 1 2 3 4 DEL 5 + 6 ENTER SHIFT ALPHA FORMAT DOWN BACK FORMAT FORMAT',{rapid:true});
   const s=await driver.state();assert.equal(s.calculation.exact,'1241');
   assert.equal(s.presentation.formatMenu,false);assert.equal(s.presentation.format,0);
   assert.equal(s.modifier,'');
  }
  // The declared public logical catalog also exposes FORMAT_MENU (82).
  // This is an additional bridge-boundary detector, never a substitute for
  // the physical SHIFT/ALPHA/FORMAT and pointer journeys above.
  assert.equal(await el.evaluate(e=>e.pressLogicalKey(82)),true);
  await driver.settled('public-format-menu');
  assert.equal((await driver.state()).presentation.formatMenu,true);
  await keys('BACK');
  assert.deepEqual(errors,[]);await context.close();console.log('PASS',name,surface,'formats, S+A, ENG');
 }} finally {await browser.close();}
}}finally{await server.close();await mkdir(out,{recursive:true});await writeFile(resolve(out,'results.json'),JSON.stringify(results,null,2));await writeFile(resolve(out,'events.json'),JSON.stringify(trace,null,2));}
