// Isolated browser-profile storage tests; never touches a physical calculator.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from '../tests/wasm/node_modules/playwright/index.mjs';
const source=process.argv[2],out=resolve(process.argv[3]);assert.ok(source&&out);
await mkdir(out,{recursive:true});
const port=8821,origin=`http://127.0.0.1:${port}`;
const server=spawn('python',['-m','http.server',String(port),'--bind','127.0.0.1','--directory',resolve(source,'out/wasm/dist/release')],{stdio:'ignore'});
const delay=ms=>new Promise(r=>setTimeout(r,ms));let browser;
try {
 for(let i=0;i<100;++i){try{if((await fetch(origin+'/index.html?start=launcher')).ok)break;}catch{}await delay(50);}
 browser=await chromium.launch({headless:true});const page=await browser.newPage();
 const ready=async()=>page.waitForFunction(()=>window.numos?.isReady(),null,{timeout:30000});
 await page.goto(origin+'/index.html?start=launcher');await ready();
 const canvas=page.locator('numos-emulator').locator('canvas');
 const key=async n=>{await page.evaluate(n=>window.numos.pressLogicalKey(n),n);await delay(100);};
 const languageRow=async()=>{
  for(let i=0;i<24;++i){const d=await page.evaluate(()=>window.numos.diagnosticState());if(d.menuFocus===10)break;await key(d.menuFocus<10?16:13);}
  await delay(400);const d=await page.evaluate(()=>window.numos.diagnosticState()),box=await canvas.boundingBox();
  await canvas.click({position:{x:d.menuFocusPoint.x*box.width/320,y:d.menuFocusPoint.y*box.height/240}});
  await page.waitForFunction(()=>window.numos.diagnosticState().app==='Settings');await delay(300);
  for(let i=0;i<4;++i)await key(15);
 };
 const pixels=async()=>canvas.evaluate(c=>{const o=document.createElement('canvas');o.width=320;o.height=240;const ctx=o.getContext('2d');ctx.drawImage(c,0,0,320,240);return Array.from(ctx.getImageData(0,178,320,40).data);});
 const capture=async name=>writeFile(resolve(out,name+'.png'),Buffer.from((await canvas.evaluate(c=>c.toDataURL())).split(',')[1],'base64'));
 await languageRow();await delay(350);const english=await pixels();await capture('english-default');await page.keyboard.press('Enter');await delay(350);const spanish=await pixels();await capture('spanish-selected');assert.notDeepEqual(spanish,english);
 const saved=await page.evaluate(()=>window.numos.flushPersistence());assert.equal(saved.dirty,false);
 await page.reload();await ready();await languageRow();assert.deepEqual(await pixels(),spanish);await capture('spanish-restored');
 // Change only the reserved locale byte of this ephemeral profile's settings.
 const change=async value=>page.evaluate(async value=>{
  const names=await indexedDB.databases();const name=names.find(d=>d.name==='/numos')?.name; if(!name)throw Error(JSON.stringify(names));
  return new Promise((resolve,reject)=>{const open=indexedDB.open(name);open.onerror=()=>reject(open.error);open.onsuccess=()=>{const db=open.result,tx=db.transaction('FILE_DATA','readwrite'),store=tx.objectStore('FILE_DATA');let changed=false;const cursor=store.openCursor();cursor.onsuccess=()=>{const c=cursor.result;if(!c)return;if(String(c.key).endsWith('/settings.dat')){const record=c.value;const bytes=new Uint8Array(record.contents);if(bytes.length!==10)throw Error('unexpected record size');bytes[9]=value;record.contents=bytes;c.update(record);changed=true;}c.continue();};tx.oncomplete=()=>{db.close();changed?resolve(true):reject(Error('settings record absent'));};tx.onerror=()=>reject(tx.error);};});
 },value);
 // Shut down first so its final flush cannot overwrite the injected test bytes.
 for(const [name,value] of [['legacy-zero',0],['unknown',255]]){
  await page.evaluate(()=>window.numos.requestShutdown());await change(value);
  await page.reload();await ready();await languageRow();assert.deepEqual(await pixels(),english);await capture(name);
 }
 await writeFile(resolve(out,'results.json'),JSON.stringify({pass:true,defaultEnglish:true,spanishReload:true,oldRecord:true,unknownRecord:true,scope:'fresh browser profile; reserved byte only; no physical storage'},null,2));
 console.log('Browser locale persistence/default/unknown PASS');
}finally{await browser?.close();server.kill();}
