// Real keypad events in the C++/Wasm shell and component; no LaTeX/AST injection.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium,firefox,webkit} from 'playwright';
import {startStaticServer} from './test-server.mjs';
const root=resolve(process.env.NUMOS_WEB_ROOT),out=resolve(process.env.NUMOS_SPACING_WEB_OUT);
const prior=process.env.NUMOS_SPACING_WEB_BASELINE;
const fixtures=JSON.parse(await readFile(new URL('../fixtures/math-spacing.json',import.meta.url),'utf8'));
const ids={'^':'r2c4',exp:'r9c2',neg:'r9c3','-':'r8c4','+':'r8c3','*':'r7c3','/':'r2c1','.':'r9c1','(':'r4c3',')':'r4c4',LEFT:'r1c1',RIGHT:'r1c3',DEL:'r6c3',AC:'r6c4',ENTER:'r9c4',sin:'r3c2'};
for(const [digit,id] of Object.entries({'0':'r9c0','1':'r8c0','2':'r8c1','3':'r8c2','4':'r7c0','5':'r7c1','6':'r7c2','7':'r6c0','8':'r6c1','9':'r6c2'}))ids[digit]=id;
const cases=fixtures.filter(f=>f.keys.split(' ').every(k=>ids[k]));
const server=await startStaticServer(root,8896);
try {
 for(const [name,type] of Object.entries({chromium,firefox,webkit})) {
  const browser=await type.launch({headless:true});const folder=resolve(out,name);await mkdir(folder,{recursive:true});
  const expected=prior?JSON.parse(await readFile(resolve(prior,name,'results.json'),'utf8')):null;
  const records=[];
  try {
   for(const surface of ['shell','component']) {
    const context=await browser.newContext({viewport:{width:1100,height:1100},deviceScaleFactor:1});
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
    await page.goto(server.origin+(surface==='shell'?'/index.html?start=launcher':'/fixture.html'));
    if(surface==='component') {
     await page.waitForFunction(()=>customElements.get('numos-emulator'));
     await page.evaluate(()=>{const e=document.createElement('numos-emulator');e.setAttribute('controls','');document.body.append(e);});
     await page.locator('numos-emulator').locator('[data-action=overlay-start]').click();
    }
    const el=page.locator('numos-emulator');
    await page.waitForFunction(()=>document.querySelector('numos-emulator')?.diagnosticState()?.ready,null,{timeout:60000});
    if(!await el.locator('[data-physical-id=r9c4]').isVisible())await el.locator('[data-action=controls]').click();
    const key=async k=>{await el.locator(`[data-physical-id=${ids[k]}]`).click();await page.waitForTimeout(45);};
    const shot=async label=>{
     const v=await el.locator('canvas').evaluate(c=>({w:c.width,h:c.height,png:c.toDataURL().split(',')[1]}));
     assert.deepEqual([v.w,v.h],[320,240]);await writeFile(resolve(folder,surface+'-'+label+'.png'),Buffer.from(v.png,'base64'));
    };
    await key('ENTER');await page.waitForTimeout(350);
    for(const f of cases) {
     await key('AC');for(const k of f.keys.split(' '))await key(k);
     await shot(f.id+'-editable');await key('ENTER');
     const state=await el.evaluate(e=>e.diagnosticState());
     assert.equal(state.app,'Calculation');
     const r={surface,id:f.id,keys:f.keys,result:state.calculation};records.push(r);
     if(expected)assert.deepEqual(r,expected.find(e=>e.surface===surface&&e.id===f.id));
     if('expected' in f)assert.equal(r.result.status,'ok',f.id);
     if(['pending-sign','pending-exponent','pending-base','pending-final-operator','nested-incomplete'].includes(f.id))assert.equal(r.result.status,'parse_error',f.id);
     await shot(f.id+'-evaluated');
    }
    assert.deepEqual(errors,[]);await context.close();
   }
   await writeFile(resolve(folder,'results.json'),JSON.stringify(records,null,2));
   console.log('PASS',name,records.length,'spacing cases / shell + component',prior?'baseline invariant':'baseline captured');
  } finally {await browser.close();}
 }
} finally {await server.close();}
