// Product controls, SDL text and pointer only. Diagnostics are read-only.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium,firefox,webkit} from 'playwright';
import {startStaticServer} from './test-server.mjs';
import {calculationDriver} from './calculation-driver.mjs';
const out=resolve(process.env.NUMOS_QUANTITY_OUT||'out/calc-units-02/web/temperatures');
const server=await startStaticServer(resolve(process.env.NUMOS_WEB_ROOT),8904);
const records=[],trace=[];
try {for(const [name,type] of Object.entries({chromium,firefox,webkit})) {
 if(process.env.NUMOS_BROWSER&&process.env.NUMOS_BROWSER!==name)continue;
 const browser=await type.launch({headless:true});
 try {for(const surface of ['shell','component']) {
  const context=await browser.newContext({viewport:{width:1100,height:1100}}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(String(e)));
  const folder=resolve(out,name,surface);await mkdir(folder,{recursive:true});
  const boot=async()=>{
   await page.goto(server.origin+(surface==='shell'?'/index.html':'/fixture.html'));
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
  const amount=async(value,query,id)=>{await keys(value.split('').join(' '));await quantityPick(query,id);};
  await keys('AC');await amount('0','Degree Celsius',32791);await keys('ENTER');await exact('5463/20');await shot('zero-celsius');
  await target('Degree Fahrenheit',32828);await exact('32');await shot('zero-fahrenheit');
  await target('Degree Celsius',32791);await exact('0');
  await keys('AC NEGATE');await amount('40','Degree Fahrenheit',32828);await keys('ENTER');await target('Degree Celsius',32791);await exact('-40');await shot('negative-forty');
  await keys('AC');await amount('20','Degree Celsius',32791);await keys('-');await amount('10','Degree Celsius',32791);await keys('ENTER');await exact('10');await shot('difference');
  await output();await shot('format-difference');await keys('BACK');await target('delta f',32831);await exact('18');
  await keys('AC');await amount('20','Degree Celsius',32791);await keys('+');await amount('10','delta c',32830);await keys('ENTER');await target('Degree Celsius',32791);await exact('30');await shot('point-plus-difference');
  await keys('AC');await amount('20','Degree Celsius',32791);await keys('ENTER');await target('Degree Fahrenheit',32828);await exact('68');await target('Kelvin',32773);await exact('5863/20');
  await output();await shot('format-point');await keys('BACK');
  await keys('AC');await answer();await keys('-');await amount('32','Degree Fahrenheit',32828);await keys('ENTER');await exact('20');
  await keys('AC');await amount('20','Degree Celsius',32791);await keys('+');await amount('10','Degree Celsius',32791);await keys('ENTER');assert.equal((await driver.state()).calculation.status,'quantity_error');await shot('affine-error');
  await keys('AC 2 + 2 ENTER');await exact('4');
  // Store a point as a session quantity, then recover it as a point by subtraction.
  await keys('AC');await amount('20','Degree Celsius',32791);await keys('ENTER STO 1');
  await keys('AC ALPHA 1 -');await amount('32','Degree Fahrenheit',32828);await keys('ENTER');await exact('20');
  // Distinct favorites must retain the selected role after real IDBFS reload.
  for(const [query,id] of [['Degree Celsius',32791],['delta c',32830]]) {
   await keys('AC TOOLBOX');await el.locator('canvas').focus();await page.keyboard.type(query);await keys('DOWN');await expect({id});await keys('FORMAT ENTER BACK BACK');
  }
  assert.ok(await el.evaluate(e=>e.flushPersistence()));
  el=await boot();driver=calculationDriver(page,el,trace);keys=driver.keys;await keys('ENTER');await driver.settled('reload');
  await keys('TOOLBOX UP RIGHT ENTER');await expect({id:32791});await shot('favorites');await keys('ENTER ENTER');await exact('5483/20');
  await keys('AC TOOLBOX UP RIGHT ENTER DOWN');await expect({id:32830});await keys('ENTER ENTER');await exact('1');await shot('favorite-difference');
  await keys('AC ALPHA 1 ENTER');await exact('0');
  assert.deepEqual(errors,[]);records.push({browser:name,surface,passed:true});
  await context.close();
 }}finally{await browser.close();}
}}finally{
 await mkdir(out,{recursive:true});await writeFile(resolve(out,'results.json'),JSON.stringify(records,null,2));await writeFile(resolve(out,'events.json'),JSON.stringify(trace,null,2));await server.close();
}
console.log('PASS affine temperatures on all requested browsers and surfaces');
