import assert from 'node:assert/strict';
import {chromium,webkit} from 'playwright';
import {resolve} from 'node:path';
import {readFile} from 'node:fs/promises';
import {startStaticServer} from './test-server.mjs';
const server=await startStaticServer(resolve('out/wasm-math/dist/release'),8797);
const transportSource=await readFile('wasm/math/learning-steps.js','utf8');
async function checkParentBoundary(browser) {
 const page=await browser.newPage();
 await page.route(server.origin+'/transport-client.js',route=>route.fulfill({contentType:'text/javascript',body:transportSource}));
 await page.route(server.origin+'/transport-test.html*',route=>route.fulfill({contentType:'text/html',body:'<script type="module">window.client=await import("./transport-client.js");</script>'}));
 const approved='http://127.0.0.1:1420', rejected='http://untrusted.example';
 for(const origin of [rejected,approved]) {
  await page.route(origin+'/transport-parent',route=>route.fulfill({contentType:'text/html',body:`<iframe src="${server.origin}/transport-test.html?transport=parent&parentOrigin=${encodeURIComponent(origin)}"></iframe><script>window.requests=[];addEventListener('message',e=>{if(e.data?.type==='brainfood-math-request')requests.push(e.data)});</script>`}));
  await page.goto(origin+'/transport-parent');
  const child=await (await page.locator('iframe').elementHandle()).contentFrame();
  await child.waitForURL(server.origin+'/transport-test.html*');
  await child.waitForFunction(()=>window.client);
  await child.evaluate(()=>{window.outcome=null;Promise.all([window.client.loadModels(),window.client.loadClasses()]).then(data=>window.outcome={data},error=>window.outcome={error:error.message});});
  if(origin===rejected) {
   await child.waitForFunction(()=>window.outcome);
   assert.match((await child.evaluate(()=>window.outcome)).error,/not trusted/);
   assert.equal(await page.evaluate(()=>window.requests.length),0,'untrusted parent receives no request');
  } else {
   await page.waitForFunction(()=>window.requests.length===2);
   const request=await page.evaluate(()=>window.requests[0]);
   assert.equal(request.action,'models');
   assert.equal(await page.evaluate(()=>window.requests[1].action),'classes');
   await child.evaluate(({id,origin})=>{
    const data={type:'brainfood-math-response',id,data:{models:['forged']}};
    dispatchEvent(new MessageEvent('message',{origin:'https://untrusted.example',source:parent,data}));
    dispatchEvent(new MessageEvent('message',{origin,source:window,data}));
   },{id:request.id,origin});
   assert.equal(await child.evaluate(()=>window.outcome),null,'wrong origin or source must not resolve a request');
   await page.evaluate(({id,target})=>document.querySelector('iframe').contentWindow.postMessage({type:'brainfood-math-response',id,data:{models:['approved']}},target),{id:request.id,target:server.origin});
   await page.evaluate(target=>document.querySelector('iframe').contentWindow.postMessage({type:'brainfood-math-response',id:window.requests[1].id,data:{classes:['algebra']}},target),server.origin);
   await child.waitForFunction(()=>window.outcome);
   assert.deepEqual(await child.evaluate(()=>window.outcome),{data:[{models:['approved']},{classes:['algebra']}]});
  }
 }
 await page.close();
}
try {
 for(const engine of [chromium,webkit]) {
  const browser=await engine.launch();
  try{
   await checkParentBoundary(browser);
   const page=await browser.newPage();let saved=null,version=0,submitted=false,failSave=false,problem;
   const result={outputId:'12345678-1234-1234-1234-123456789abc',revision:'fixed-revision',classId:'algebra',title:'Your explanation',steps:[{explanation:'Find the slope',math:'m=2',citationIds:[]}],sources:[],answer:'y=2x+12',limitations:[],model:'test/provider'};
   await page.route('**/api/brainfood/math/**',async route=>{
    const request=route.request(),path=new URL(request.url()).pathname;
    let data={};
    if(path.endsWith('/models'))data={models:[{id:'test/provider',label:'Test model'}],default_model:'test/provider'};
    else if(path.endsWith('/classes'))data={classes:['algebra']};
    else if(path.endsWith('/explain')){problem=request.postDataJSON();data=result;}
    else if(path.endsWith('/feedback')){
     if(failSave){await route.fulfill({status:503,json:{}});return;}
     const body=request.postDataJSON();assert.equal(body.version,version);saved=body.feedback;submitted=body.submit;data={version:++version,submitted};
    }else if(path.endsWith('/outputs'))data={outputs:[result]};
    else data={...result,output:result,feedback:saved,version,submitted};
    await route.fulfill({json:data});
   });
   await page.goto(server.origin);
   await page.waitForFunction(()=>document.querySelector('#learning-class')?.value==='algebra'&&!document.querySelector('[data-action="explain"]').disabled);
   // Arbitrary and invalid math go to the service; there is no template allowlist.
   for(const input of ['Find a line through two points','ln(x^2/sqrt(4x+1))','log(-3)']){
    await page.locator('#expression').fill(input);await page.getByRole('button',{name:'Explain steps',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Source-guided'));
    assert.equal(problem.problem,input);assert.equal(problem.classId,'algebra');
   }
   const panel=page.locator('.feedback').last();
   await panel.getByLabel('Step 1 — what helped or confused you?').fill('Why subtract?');
   await panel.getByLabel('Show your work or describe your approach').fill('m=-8/-4');
   failSave=true;await panel.getByRole('button',{name:'Save draft'}).click();
   await panel.getByRole('status').filter({hasText:'Not saved'}).waitFor();
   assert.equal(await panel.getByLabel('Show your work or describe your approach').inputValue(),'m=-8/-4');
   failSave=false;await panel.getByRole('button',{name:'Save draft'}).click();
   await panel.getByRole('status').filter({hasText:'Draft saved'}).waitFor();
   await page.reload();await page.getByRole('button',{name:'Open saved work'}).click();
   await page.getByRole('button',{name:'Your explanation — algebra'}).click();
   const reopened=page.locator('.feedback');
   assert.equal(await reopened.getByLabel('Step 1 — what helped or confused you?').inputValue(),'Why subtract?');
   await reopened.getByRole('button',{name:'Submit for review'}).click();
   await reopened.getByRole('status').filter({hasText:'Submitted for review'}).waitFor();
   assert.equal(submitted,true);assert.equal(version,2);
   assert.equal(await reopened.getByLabel('Show your work or describe your approach').isDisabled(),true);
   console.log(engine.name()+': API routing, failed-save preservation, draft reopening and submission passed');
  }finally{await browser.close();}
 }
}finally{await server.close();}
