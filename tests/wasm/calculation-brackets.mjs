// Real physical keypad + desktop input, same C++/Wasm renderer.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium,firefox,webkit} from 'playwright';
import {startStaticServer} from './test-server.mjs';
const out=resolve(process.env.NUMOS_BRACKET_OUT),root=resolve(process.env.NUMOS_WEB_ROOT);
const fixtures=JSON.parse(await readFile(new URL('../fixtures/math-brackets.json',import.meta.url),'utf8'));
const ids={'^':'r2c4',neg:'r9c3','-':'r8c4','+':'r8c3','*':'r7c3','/':'r2c1','(':'r4c3',')':'r4c4',SQRT:'r2c2',DEL:'r6c3',AC:'r6c4',ENTER:'r9c4',UP:'r0c2',RIGHT:'r1c3',SHIFT:'r0c0'};
Object.assign(ids,{'0':'r9c0','1':'r8c0','2':'r8c1','3':'r8c2','4':'r7c0','5':'r7c1','6':'r7c2','7':'r6c0','8':'r6c1','9':'r6c2'});
const server=await startStaticServer(root,8897);
const scalar=text=>{
 if(/^-?\d+(?:\/\d+)?$/.test(text))return text.split('/').map(Number).reduce((a,b)=>a/b);
 const root=text.match(/^sqrt\((\d+)\)(?:\+(\d+))?$/);if(root)return Math.sqrt(Number(root[1]))+Number(root[2]||0);
 const sum=text.match(/^(\d+)\+sqrt\((\d+)\)$/);if(sum)return Number(sum[1])+Math.sqrt(Number(sum[2]));
 assert.fail('Unsupported scalar oracle shape: '+text);
};
try {for(const [name,type] of Object.entries({chromium,firefox,webkit})){
 const browser=await type.launch({headless:true});const folder=resolve(out,name);await mkdir(folder,{recursive:true});const records=[];
 try {for(const surface of ['shell','component']){
  const context=await browser.newContext({viewport:{width:1100,height:1100},deviceScaleFactor:1});const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.goto(server.origin+(surface==='shell'?'/index.html?start=launcher':'/fixture.html'));
  if(surface==='component'){await page.waitForFunction(()=>customElements.get('numos-emulator'));await page.evaluate(()=>{const e=document.createElement('numos-emulator');e.setAttribute('controls','');document.body.append(e);});await page.locator('numos-emulator').locator('[data-action=overlay-start]').click();}
  const el=page.locator('numos-emulator');await page.waitForFunction(()=>document.querySelector('numos-emulator')?.diagnosticState()?.ready,null,{timeout:60000});
  if(!await el.locator('[data-physical-id=r9c4]').isVisible())await el.locator('[data-action=controls]').click();
  const key=async k=>{
   if(k==='['||k===']'){await key('SHIFT');await key(k==='['?'(':')');return;}
   assert.ok(ids[k],k);await el.locator(`[data-physical-id=${ids[k]}]`).click();await page.waitForTimeout(45);
  };
  const shot=async id=>{const v=await el.locator('canvas').evaluate(c=>({w:c.width,h:c.height,png:c.toDataURL().split(',')[1]}));assert.deepEqual([v.w,v.h],[320,240]);await writeFile(resolve(folder,surface+'-'+id+'.png'),Buffer.from(v.png,'base64'));};
  await key('ENTER');await page.waitForTimeout(350);
  for(const f of fixtures){
   await key('AC');for(const k of f.keys.split(' '))await key(k);await shot(f.id+'-editable');
   if(f.evaluate===false)continue;
   await key('ENTER');const state=await el.evaluate(e=>e.diagnosticState());records.push({surface,id:f.id,result:state.calculation});
   assert.equal(state.calculation.status,f.complete===false?'parse_error':'ok',f.id);
   if(f.expected!==undefined){const value=scalar(state.calculation.exact);assert.ok(Math.abs(value-f.expected)<1e-10,f.id+': '+value);}
   await shot(f.id+'-evaluated');
  }
  await key('AC');await el.locator('canvas').focus();for(const k of ['[','2','+','3',']','*','4','Enter']){await page.keyboard.press(k);await page.waitForTimeout(50);}
  assert.equal((await el.evaluate(e=>e.diagnosticState())).calculation.exact,'20','desktop brackets retain group');await shot('desktop');
  await key('AC');for(const k of ['[','2','+','3',']','ENTER','AC','7','ENTER','UP','UP'])await key(k);await shot('history');
  assert.deepEqual(errors,[]);await context.close();
 }await writeFile(resolve(folder,'results.json'),JSON.stringify(records,null,2));console.log('PASS',name,records.length,'bracket cases + desktop/history');}finally{await browser.close();}
}}finally{await server.close();}
