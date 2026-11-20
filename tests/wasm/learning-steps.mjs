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
   const page=await browser.newPage();let saved=null,version=0,submitted=false,failSave=false,failList=false,problem;
   const outputReads=new Map();
   let releaseFirstRead,firstReadStartedResolve,holdFirstRead=true;
   const firstReadStarted=new Promise(resolve=>{firstReadStartedResolve=resolve;});
   const result={outputId:'12345678-1234-1234-1234-123456789abc',revision:'fixed-revision',classId:'algebra',title:'Your explanation',steps:[{explanation:'Find the slope',math:'m=2',citationIds:[]}],sources:[],answer:'y=2x+12',limitations:[],model:'test/provider'};
   const secondResult={...result,outputId:'12345678-1234-1234-1234-123456789def',revision:'second-revision',title:'A different explanation',steps:[{explanation:'Use the intercept',math:'b=5',citationIds:[]}],answer:'y=3x+5'};
   let secondSaved={work:'b=5'},secondVersion=0;
   await page.route('**/api/brainfood/math/**',async route=>{
    const request=route.request(),path=new URL(request.url()).pathname;
    let data={};
    if(path.endsWith('/models'))data={models:[{id:'test/provider',label:'Test model'}],default_model:'test/provider'};
    else if(path.endsWith('/classes'))data={classes:['algebra']};
    else if(path.endsWith('/explain')){problem=request.postDataJSON();data=result;}
    else if(path.endsWith('/feedback')){
     if(failSave){await route.fulfill({status:503,json:{}});return;}
     const body=request.postDataJSON();
     if(path.includes(secondResult.outputId)) {
      assert.equal(body.revision,secondResult.revision);assert.equal(body.version,secondVersion);
      secondSaved=body.feedback;data={version:++secondVersion,submitted:body.submit};
     }else{
      assert.equal(body.revision,result.revision);assert.equal(body.version,version);saved=body.feedback;submitted=body.submit;data={version:++version,submitted};
     }
    }else if(path.endsWith('/outputs')){
     if(failList){await route.fulfill({status:503,json:{}});return;}
     data={outputs:[result,secondResult]};
    }else {
     outputReads.set(path,(outputReads.get(path)||0)+1);
     if(path.endsWith(result.outputId)&&holdFirstRead){holdFirstRead=false;firstReadStartedResolve();await new Promise(resolve=>{releaseFirstRead=resolve;});}
     data=path.endsWith(secondResult.outputId)?{...secondResult,output:secondResult,feedback:secondSaved,version:secondVersion,submitted:false}:{...result,output:result,feedback:saved,version,submitted};
    }
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
   await firstReadStarted;
   await page.getByRole('button',{name:'Open saved work'}).click();
   await page.waitForFunction(()=>!document.getElementById('saved-work-index').hasAttribute('aria-busy'));
   await page.getByRole('button',{name:'Your explanation — algebra'}).click();
   releaseFirstRead();
   await page.getByRole('button',{name:'A different explanation — algebra'}).click();
   const firstContainer=page.locator(`[data-output-id="${result.outputId}"]`);
   const secondContainer=page.locator(`[data-output-id="${secondResult.outputId}"]`);
   const reopened=firstContainer.locator('.feedback');
   const secondReopened=secondContainer.locator('.feedback');
   assert.equal(await firstContainer.locator('h2').first().textContent(),result.title);
   assert.equal(await secondContainer.locator('h2').first().textContent(),secondResult.title);
   assert.equal(await reopened.count(),1);assert.equal(await secondReopened.count(),1);
   assert.equal(outputReads.get('/api/brainfood/math/outputs/'+result.outputId),1,'list refresh during a pending open must not create a second request/editor');
   assert.equal(await reopened.getByLabel('Step 1 — what helped or confused you?').inputValue(),'Why subtract?');
   assert.equal(await secondReopened.getByLabel('Show your work or describe your approach').inputValue(),'b=5');
   await reopened.getByLabel('What should we explain differently?').fill('Keep my first unsaved note');
   await secondReopened.getByLabel('Show your work or describe your approach').fill('y=3x+5');
   const unloadIsGuarded=()=>page.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;});
   assert.equal(await unloadIsGuarded(),true);
   const readsBeforeRefresh=[...outputReads.entries()];
   await page.getByRole('button',{name:'Open saved work'}).click();
   await page.waitForFunction(()=>!document.getElementById('saved-work-index').hasAttribute('aria-busy'));
   await page.getByRole('button',{name:'Your explanation — algebra'}).click();
   await page.getByRole('button',{name:'A different explanation — algebra'}).click();
   assert.deepEqual([...outputReads.entries()],readsBeforeRefresh,'opening an existing draft must not refetch a stale snapshot');
   assert.equal(await firstContainer.count(),1);assert.equal(await secondContainer.count(),1);
   failList=true;await page.getByRole('button',{name:'Open saved work'}).click();
   await page.waitForFunction(()=>!document.getElementById('saved-work-index').hasAttribute('aria-busy'));
   failList=false;
   await page.getByRole('button',{name:'Clear session'}).click();
   await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Ready'));
   await page.locator('#expression').fill('a new problem');
   await page.locator('#learning-context').fill('a different context');
   assert.equal(await reopened.getByLabel('What should we explain differently?').inputValue(),'Keep my first unsaved note');
   assert.equal(await secondReopened.getByLabel('Show your work or describe your approach').inputValue(),'y=3x+5');
   assert.equal(await unloadIsGuarded(),true,'resetting calculator inputs must retain the draft unload guard');
   await secondReopened.getByRole('button',{name:'Save draft'}).click();
   await secondReopened.getByRole('status').filter({hasText:'Draft saved'}).waitFor();
   assert.equal(secondSaved.work,'y=3x+5');assert.equal(secondVersion,1);
   assert.equal(saved.work,'m=-8/-4');assert.equal(version,1);
   assert.equal(await unloadIsGuarded(),true,'saving one output must not clear another output dirty state');
   await reopened.getByRole('button',{name:'Save draft'}).click();
   await reopened.getByRole('status').filter({hasText:'Draft saved'}).waitFor();
   assert.equal(saved.comment,'Keep my first unsaved note');assert.equal(version,2);
   assert.equal(await unloadIsGuarded(),false,'all saved drafts should allow navigation without a warning');
   await reopened.getByRole('button',{name:'Submit for review'}).click();
   await reopened.getByRole('status').filter({hasText:'Submitted for review'}).waitFor();
   assert.equal(submitted,true);assert.equal(version,3);
   assert.equal(await reopened.getByLabel('Show your work or describe your approach').isDisabled(),true);
   assert.equal(await secondReopened.getByLabel('Show your work or describe your approach').isDisabled(),false);
   console.log(engine.name()+': API routing, failed-save preservation, refresh/reset draft preservation, editor deduplication, unload guards and submission passed');
  }finally{await browser.close();}
 }
}finally{await server.close();}
