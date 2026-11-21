// Reproduce the old time-only capture boundary without altering app state.
// The browser scheduler is held at an explicit action boundary, then resumed.
import assert from 'node:assert/strict';
import {webkit} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {startStaticServer} from './test-server.mjs';

const out=resolve(process.env.NUMOS_FORMAT_OUT);
await mkdir(out,{recursive:true});
const server=await startStaticServer(resolve(process.env.NUMOS_WEB_ROOT),8898);
const browser=await webkit.launch({headless:true}),records=[];
try {
 for(const surface of ['shell','component']) {
  const context=await browser.newContext({viewport:{width:1100,height:1100}});
  await context.addInitScript(()=>{
   const raf=window.requestAnimationFrame.bind(window),queue=[];
   let held=false;
   window.requestAnimationFrame=callback=>raf(time=>{
    if(held)queue.push(callback);else callback(time);
   });
   window.testFrameGate={hold(){held=true;},resume(){
    held=false;for(const callback of queue.splice(0))raf(callback);
   }};
  });
  const page=await context.newPage();
  await page.goto(server.origin+(surface==='shell'?'/index.html?start=launcher':'/fixture.html'));
  if(surface==='component') {
   await page.waitForFunction(()=>customElements.get('numos-emulator'));
   await page.evaluate(()=>{const e=document.createElement('numos-emulator');e.setAttribute('controls','');document.body.append(e);});
   await page.locator('numos-emulator').locator('[data-action=overlay-start]').click();
  }
  const el=page.locator('numos-emulator');
  await page.waitForFunction(()=>document.querySelector('numos-emulator')?.diagnosticState()?.ready,null,{timeout:60000});
  if(!await el.locator('[data-physical-id=r9c4]').isVisible())await el.locator('[data-action=controls]').click();
  const sample=async label=>{
   const data=await el.evaluate(e=>({at:performance.now(),state:e.diagnosticState(),png:e.shadowRoot.querySelector('canvas').toDataURL().split(',')[1]}));
   await writeFile(resolve(out,`${surface}-${label}.png`),Buffer.from(data.png,'base64'));
   const png=data.png;delete data.png;records.push({surface,label,...data});return {png,...data};
  };
  const frames=async()=>{
   const n=await el.evaluate(e=>e.diagnosticState().frameCount);
   await page.waitForFunction(n=>document.querySelector('numos-emulator').diagnosticState().frameCount>=n+8,n,{timeout:10000});
  };
  const key=async id=>el.locator(`[data-physical-id=${id}]`).click({force:true});
  await key('r9c4');await frames();
  for(const id of ['r9c0','r9c1','r8c0','r9c4'])await key(id);
  await frames();const exact=await sample('decimal-exact');
  await page.evaluate(()=>testFrameGate.hold());
  await key('r5c0');await page.waitForTimeout(40);
  const early=await sample('format-at-40ms');
  assert.equal(early.png,exact.png,'held frame must remain the previously published image');
  if(early.state.render) {
   assert.equal(early.state.presentation.format,1);
   assert.ok(early.state.render.pending,'processed FORMAT still awaits publication');
  }
  await page.evaluate(()=>testFrameGate.resume());await frames();
  assert.notEqual((await sample('format-published')).png,exact.png);
  for(const id of ['r6c4','r2c2','r9c3','r8c0','r1c3','r8c3','r8c0','r9c4'])await key(id);
  await frames();
  for(const id of ['r0c0','r0c1','r5c0'])await key(id);
  await frames();const menu=await sample('menu');
  const canvas=el.locator('canvas'),bounds=await canvas.boundingBox();
  await canvas.evaluate(c=>{window.testPointerEdges=[];for(const type of ['pointerdown','pointerup'])c.addEventListener(type,e=>testPointerEdges.push({type:e.type,at:performance.now()}));});
  await page.evaluate(()=>testFrameGate.hold());
  await canvas.click({force:true,position:{x:bounds.width/2,y:bounds.height*155/240}});
  await page.waitForTimeout(80);const delivered=await sample('pointer-at-80ms');
  assert.equal(delivered.png,menu.png);
  const edges=await page.evaluate(()=>testPointerEdges);
  records.push({surface,label:'browser-pointer-delivery',edges});
  assert.deepEqual(edges.map(e=>e.type),['pointerdown','pointerup']);
  // Native counters advance when SDL polls its queue, not on DOM delivery.
  assert.equal(delivered.state.pointer.downEvents,menu.state.pointer.downEvents);
  assert.equal(delivered.state.pointer.pressReads,menu.state.pointer.pressReads);
  await page.evaluate(()=>testFrameGate.resume());await frames();
  const published=await sample('pointer-published');assert.notEqual(published.png,menu.png);
  assert.equal(published.state.pointer.downEvents,menu.state.pointer.downEvents+1);
  if(published.state.presentation)assert.equal(published.state.presentation.formatMenu,false);
  const result=await el.evaluate(e=>{try{return {accepted:e.pressLogicalKey(82)};}catch(error){return {accepted:false,error:String(error)};}});
  records.push({surface,label:'catalog-format-menu-82',...result});
  assert.equal(result.accepted,process.env.NUMOS_BASELINE!=='1');
  await context.close();console.log('PASS scheduler boundary',surface,result);
 }
}finally{
 await writeFile(resolve(out,'trace.json'),JSON.stringify({browser:browser.version(),records},null,2));
 await browser.close();await server.close();
}
