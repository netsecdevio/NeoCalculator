// Product controls, SDL text and pointer only. Diagnostics are read-only.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium,firefox,webkit} from 'playwright';
import {startStaticServer} from './test-server.mjs';
import {calculationDriver} from './calculation-driver.mjs';
const out=resolve(process.env.NUMOS_QUANTITY_OUT||'out/calc-units-01/web/quantities-focused');
const server=await startStaticServer(resolve(process.env.NUMOS_WEB_ROOT),8902);
const records=[],trace=[];
try {for(const [name,type] of Object.entries({chromium,firefox,webkit})) {
 if(process.env.NUMOS_BROWSER&&process.env.NUMOS_BROWSER!==name)continue;
 const browser=await type.launch({headless:true});
 try {for(const surface of ['shell','component']) {
  const context=await browser.newContext({viewport:{width:1100,height:1100}}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(String(e)));
  const folder=resolve(out,name,surface);await mkdir(folder,{recursive:true});
  const boot=async()=>{
   await page.goto(server.origin+(surface==='shell'?'/index.html?start=launcher':'/fixture.html'));
   if(surface==='component') {
    await page.waitForFunction(()=>customElements.get('numos-emulator'));
    await page.evaluate(()=>{const e=document.createElement('numos-emulator');e.setAttribute('controls','');document.body.append(e);});
    await page.locator('numos-emulator').locator('[data-action=overlay-start]').click();
   }
   await page.waitForFunction(()=>document.querySelector('numos-emulator')?.diagnosticState()?.ready,null,{timeout:60000});
   const el=page.locator('numos-emulator');
   if(!await el.locator('[data-physical-id=r9c4]').isVisible())await el.locator('[data-action=controls]').click();
   return el;
  };
  let el=await boot(),driver=calculationDriver(page,el,trace),keys=driver.keys;
  const shot=async id=>{const data=await el.locator('canvas').evaluate(c=>c.toDataURL().split(',')[1]);await writeFile(resolve(folder,id+'.png'),Buffer.from(data,'base64'));};
  const expect=async expected=>{
   try {await page.waitForFunction(expected=>{const s=document.querySelector('numos-emulator').diagnosticState().toolbox;return Object.entries(expected).every(([k,v])=>s[k]===v);},expected,{timeout:10000});}
   catch(error){await shot('failure');const state=await driver.state();records.push({browser:name,surface,expected,state,errors});console.error(JSON.stringify({expected,toolbox:state.toolbox}));throw error;}
  };
  await keys('ENTER');await driver.settled('launcher-transition');
  // Same modal in target mode: coefficient and display unit publish together.
  const quantityPick=async(query,id,variant=0)=>{
   await keys('TOOLBOX');await el.locator('canvas').focus();await page.keyboard.type(query);
   await expect({queryBytes:new TextEncoder().encode(query).length});await keys('DOWN');
   await expect({id,variant});await keys('ENTER');await expect({open:false});
  };
  const output=async()=>{await keys('SHIFT ALPHA FORMAT ENTER');};
  const allUnits=async()=>keys('DOWN '.repeat(10)+'UP UP ENTER');
  const target=async(query,id,variant=0,component=-1)=>{
   await output();
   if(component<0)await allUnits();
   else {await keys('DOWN '.repeat(10)+'UP ENTER');await keys('DOWN '.repeat(component)+'ENTER');}
   await expect({open:true,group:200});await el.locator('canvas').focus();await page.keyboard.type(query);
   await expect({queryBytes:new TextEncoder().encode(query).length});await keys('DOWN');await expect({id,variant});
   await keys('ENTER');await expect({open:false});
  };
  const answer=async()=>{const before=(await driver.state()).render.published;await el.locator('canvas').focus();await page.keyboard.press('a');await page.waitForFunction(n=>document.querySelector('numos-emulator').diagnosticState().render.published>n,before);await driver.settled('SDL-Ans');};
  const exact=async(value)=>{const c=(await driver.state()).calculation;assert.equal(c.status,'ok');assert.equal(c.exact,value);};
  await keys('AC 2');await quantityPick('metre',32769);await keys('+ 3 0');await quantityPick('cm',32769,14);
  await keys('ENTER');await exact('23/10');await shot('quantity-sum');
  await target('cm',32769,14);await exact('230');await shot('quantity-sum-cm');
  await keys('FORMAT FORMAT');await exact('230');
  await output();await allUnits();await el.locator('canvas').focus();await page.keyboard.type('km');
  await keys('DOWN RIGHT DOWN BACK BACK BACK');await expect({open:false});await exact('230');
  await keys('AC');await answer();await keys('/ 2');await quantityPick('Second',32771);await keys('ENTER');await exact('23/20');await shot('quantity-ans');
  await keys('AC 6');await quantityPick('km',32769,10);await keys('/ 3 0 0');await quantityPick('Second',32771);
  await keys('RIGHT ENTER');await exact('20');
  const beforeQuick=(await driver.state()).giac;
  await output();await shot('quick-speed');
  assert.deepEqual((await driver.state()).giac,beforeQuick,'quick choices evaluated mathematics');
  await driver.clickCanvas(152,142,'quick-kmh');await exact('72');await shot('quick-speed-kmh');
  await output();await keys('DOWN ENTER');await exact('20');
  await target('km',32769,10,0);await exact('1/50');
  await target('hour',32816,0,1);await exact('72');await shot('quantity-components-kmh');
  await keys('AC 2');await quantityPick('metre',32769);await keys('+ 3');await quantityPick('Second',32771);
  await keys('ENTER');assert.equal((await driver.state()).calculation.status,'quantity_error');await shot('quantity-error');
  await keys('AC');await answer();await keys('ENTER');await exact('20');await shot('quantity-recovery');
  await keys('AC TOOLBOX');await el.locator('canvas').focus();await page.keyboard.type('Mach number');await keys('DOWN');await expect({id:16497});
  await keys('ENTER ENTER');assert.equal((await driver.state()).calculation.status,'units_unavailable');await shot('quantity-context');
  await keys('AC TOOLBOX');await el.locator('canvas').focus();await page.keyboard.type('Speed of light in vacuum');await keys('DOWN');await expect({id:16385});await keys('ENTER ENTER');assert.equal((await driver.state()).calculation.status,'units_unavailable');await shot('physical-reference-pending');
  await keys('AC 2 + 2 ENTER');await exact('4');
  // Replace a durable scalar with a session quantity through the real STO key.
  // A real IDBFS reload must not resurrect that scalar or lose units in-session.
  await keys('AC 7 ENTER STO 1');
  await keys('AC 2');await quantityPick('metre',32769);await keys('ENTER STO 1');
  await keys('AC ALPHA 1 / 2');await quantityPick('Second',32771);await keys('ENTER');await exact('1');
  await shot('quantity-memory-session');
  const flushed=await el.evaluate(e=>e.flushPersistence());assert.ok(flushed);
  el=await boot();driver=calculationDriver(page,el,trace);keys=driver.keys;
  await keys('ENTER');await driver.settled('memory-reload');
  await keys('AC ALPHA 1 ENTER');await exact('0');await shot('quantity-memory-reload');
  await keys('AC 2 + 2 ENTER');await exact('4');
  assert.deepEqual(errors,[]);records.push({browser:name,surface,passed:true});
  await context.close();
 }}finally{await browser.close();}
}}finally{
 await mkdir(out,{recursive:true});await writeFile(resolve(out,'results.json'),JSON.stringify(records,null,2));await writeFile(resolve(out,'events.json'),JSON.stringify(trace,null,2));await server.close();
}
console.log('PASS quantities, FORMAT, session STO and real IDBFS reload on all requested surfaces');
