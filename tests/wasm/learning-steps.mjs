import assert from 'node:assert/strict';
import {createServer} from 'node:http';
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
async function checkHistoryContext(browser,engineName) {
 const page=await browser.newPage({viewport:{width:800,height:1000}});
 let sent;
 await page.route('**/api/brainfood/math/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  let data={};
  if(path.endsWith('/classes'))data={classes:['101','102'],classLabels:{101:'Precalculus',102:'Algebra 1'}};
  else if(path.endsWith('/models'))data={models:[]};
  else if(path.endsWith('/outputs'))data={outputs:[
   {outputId:'first',classId:'101',title:'Logarithm practice: explain each step and show how the domain changes',created:'2026-11-20T12:30:00Z'},
   {outputId:'second',classId:'102',title:'Writing linear equations',created:'2026-11-19T12:30:00Z'},
  ]};
  else if(path.endsWith('/explain')){sent=route.request().postDataJSON();data={steps:[],sources:[],model:'test'};}
  await route.fulfill({json:data});
 });
 const fragment=new URLSearchParams({lessonTitle:'Chapter 4 <img src=x onerror=alert(1)>',context:'Write a line through (-2,8) and (-6,0).',problem:'Find the slope.',classId:'102'});
 await page.goto(server.origin+'/#'+fragment);
 await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Ready')&&document.querySelector('#learning-class').value==='102');
 assert.equal(await page.locator('#expression').inputValue(),'Find the slope.','math startup preserves launch problem');
 assert.equal(await page.locator('#learning-context').inputValue(),'Write a line through (-2,8) and (-6,0).');
 assert.equal(await page.locator('#class-context').innerText(),'Working in Algebra 1');
 assert.equal(await page.locator('#lesson-context img').count(),0,'launch content is text, not markup');
 assert.match(await page.locator('#lesson-context').innerText(),/Chapter 4 <img/);
 await page.getByRole('button',{name:'Explain steps',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Source-guided'));
 assert.equal(sent.context,'Write a line through (-2,8) and (-6,0).');assert.equal(sent.classId,'102');
 await page.getByRole('button',{name:'Open saved work',exact:true}).click();
 await page.locator('.saved-work-card').first().waitFor();
 assert.equal(await page.getByRole('button',{name:'Open saved work',exact:true}).isVisible(),false);
 assert.equal(await page.locator('.saved-work-card').count(),2);
 assert.match(await page.locator('.saved-work-card').first().innerText(),/Precalculus/);
 assert.equal(await page.locator('.saved-work-card').first().locator('time').getAttribute('datetime'),'2026-11-20T12:30:00.000Z');
 assert.match(await page.locator('.saved-work-card').nth(1).innerText(),/Algebra 1/);
 const first=await page.locator('.saved-work-card').first().boundingBox(),second=await page.locator('.saved-work-card').nth(1).boundingBox();
 assert.ok(second.y>=first.y+first.height+10,'history cards have a visible gap');
 for(const width of [320,768,1024]){
  await page.setViewportSize({width,height:1000});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'context and history fit '+width);
 }
 await page.screenshot({path:'/tmp/silascalc-history-'+engineName+'.png',fullPage:true});
 await page.getByRole('button',{name:'Hide saved work',exact:true}).click();
 assert.equal(await page.locator('#saved-work-history').isVisible(),false);
 assert.equal(await page.getByRole('button',{name:'Open saved work',exact:true}).isVisible(),true);
 await page.locator('#learning-class').selectOption('101');
 assert.equal(await page.locator('#class-context').innerText(),'Working in Precalculus');
 await page.goto(server.origin+'/?second#'+new URLSearchParams({classId:'unlinked',context:'x'.repeat(4000),problem:'y'.repeat(7000)}));
 await page.waitForFunction(()=>document.querySelector('#learning-class').options.length===2);
 assert.equal(await page.locator('#learning-class').inputValue(),'101','unlinked launch class is never added to enrollment');
 assert.equal((await page.locator('#learning-context').inputValue()).length,3000);
 assert.equal((await page.locator('#expression').inputValue()).length,6000);
 await page.close();
}

async function checkRedirectBoundary(browser) {
 const targets=[];let status=307,target='';
 const collector=createServer((request,response)=>{targets.push(request.url);response.writeHead(200,{'Content-Type':'application/json','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'content-type'}).end('{}');});
 const redirector=createServer((request,response)=>{
  if(request.url==='/client.js'){response.writeHead(200,{'Content-Type':'text/javascript'}).end(transportSource);return;}
  if(request.url==='/test.html'){response.writeHead(200,{'Content-Type':'text/html'}).end('<script type="module">window.client=await import("./client.js");</script>');return;}
  if(request.url==='/collector'){targets.push(request.url);response.writeHead(200,{'Content-Type':'application/json'}).end('{}');return;}
  response.writeHead(status,{location:target}).end();
 });
 const listen=server=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve(`http://127.0.0.1:${server.address().port}`));});
 const collectorOrigin=await listen(collector),origin=await listen(redirector);
 const page=await browser.newPage();
 try {
  await page.goto(origin+'/test.html');await page.waitForFunction(()=>window.client);
  for(status of [307,308])for(target of [origin+'/collector',collectorOrigin+'/collector']) {
   for(const action of ['explain','feedback','models']) {
    const rejected=await page.evaluate(async action=>{
     try {
      if(action==='explain')await window.client.requestExplanation('private problem','lesson notes','test/model','algebra');
      else if(action==='feedback')await window.client.saveFeedback('test-output',{feedback:{work:'private learner work'},submit:true});
      else await window.client.loadModels();
      return false;
     }catch{return true;}
    },action);
    assert.equal(rejected,true,`${action} rejects ${status} redirect to ${target}`);
    assert.deepEqual(targets,[],'No learner payload or request reaches a redirect target');
   }
  }
 } finally {
  await page.close();
  await Promise.all([collector,redirector].map(server=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();})));
 }
}

try {
 for(const engine of [chromium,webkit]) {
  const browser=await engine.launch();
  try{
   await checkHistoryContext(browser,engine.name());
   await checkParentBoundary(browser);
   await checkRedirectBoundary(browser);
   const page=await browser.newPage();let saved=null,version=0,submitted=false,failSave=false,failList=false,problem;
   const outputReads=new Map();
   let releaseFirstRead,firstReadStartedResolve,holdFirstRead=true;
   const firstReadStarted=new Promise(resolve=>{firstReadStartedResolve=resolve;});
   const result={outputId:'12345678-1234-1234-1234-123456789abc',revision:'fixed-revision',classId:'algebra',title:'Your explanation',created:'2026-11-20T12:30:00Z',steps:[{explanation:'Find the slope',math:'m=2',citationIds:[]}],sources:[],answer:'y=2x+12',limitations:[],model:'test/provider'};
   const secondResult={...result,outputId:'12345678-1234-1234-1234-123456789def',revision:'second-revision',title:'A different explanation',steps:[{explanation:'Use the intercept',math:'b=5',citationIds:[]}],answer:'y=3x+5'};
   let secondSaved={work:'b=5'},secondVersion=0;
   await page.route('**/api/brainfood/math/**',async route=>{
    const request=route.request(),path=new URL(request.url()).pathname;
    let data={};
    if(path.endsWith('/models'))data={models:[{id:'test/provider',label:'Test model'}],default_model:'test/provider'};
    else if(path.endsWith('/classes'))data={classes:['algebra'],classLabels:{algebra:'Algebra 1'}};
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
   await panel.getByRole('button',{name:'Comment on step 1',exact:true}).click();
   await panel.getByLabel('Your comment',{exact:true}).fill('Why subtract?');
   await panel.getByRole('button',{name:'Add comment',exact:true}).click();
   await panel.getByLabel('Show your work or describe your approach').fill('m=-8/-4');
   failSave=true;await panel.getByRole('button',{name:'Save draft'}).click();
   await panel.getByRole('status').filter({hasText:'Not saved'}).waitFor();
   assert.equal(await panel.getByLabel('Show your work or describe your approach').inputValue(),'m=-8/-4');
   failSave=false;await panel.getByRole('button',{name:'Save draft'}).click();
   await panel.getByRole('status').filter({hasText:'Draft saved'}).waitFor();
   await page.reload();await page.getByRole('button',{name:'Open saved work'}).click();
   await page.getByRole('button',{name:'Your explanation'}).click();
   await firstReadStarted;
   await page.getByRole('button',{name:'Refresh saved work'}).click();
   await page.waitForFunction(()=>!document.getElementById('saved-work-index').hasAttribute('aria-busy'));
   await page.getByRole('button',{name:'Your explanation'}).click();
   releaseFirstRead();
   await page.getByRole('button',{name:'A different explanation'}).click();
   const firstContainer=page.locator(`[data-output-id="${result.outputId}"]`);
   const secondContainer=page.locator(`[data-output-id="${secondResult.outputId}"]`);
   const reopened=firstContainer.locator('.feedback');
   const secondReopened=secondContainer.locator('.feedback');
   assert.equal(await firstContainer.locator('h2').first().textContent(),result.title);
   assert.equal(await secondContainer.locator('h2').first().textContent(),secondResult.title);
   assert.equal(await reopened.count(),1);assert.equal(await secondReopened.count(),1);
   assert.equal(outputReads.get('/api/brainfood/math/outputs/'+result.outputId),1,'list refresh during a pending open must not create a second request/editor');
   assert.match(await reopened.locator('.annotation-list').innerText(),/Why subtract\?/);
   assert.equal(await secondReopened.getByLabel('Show your work or describe your approach').inputValue(),'b=5');
   await reopened.getByLabel('What should we explain differently?').fill('Keep my first unsaved note');
   await secondReopened.getByLabel('Show your work or describe your approach').fill('y=3x+5');
   const unloadIsGuarded=()=>page.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;});
   assert.equal(await unloadIsGuarded(),true);
   const readsBeforeRefresh=[...outputReads.entries()];
   await page.getByRole('button',{name:'Refresh saved work'}).click();
   await page.waitForFunction(()=>!document.getElementById('saved-work-index').hasAttribute('aria-busy'));
   await page.getByRole('button',{name:'Your explanation'}).click();
   await page.getByRole('button',{name:'A different explanation'}).click();
   assert.deepEqual([...outputReads.entries()],readsBeforeRefresh,'opening an existing draft must not refetch a stale snapshot');
   assert.equal(await firstContainer.count(),1);assert.equal(await secondContainer.count(),1);
   failList=true;await page.getByRole('button',{name:'Refresh saved work'}).click();
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
   await page.getByRole('button',{name:'Refresh saved work'}).click();
   await page.getByRole('button',{name:'Your explanation',exact:true}).click();
   assert.equal(await firstContainer.evaluate(element=>element.contains(document.activeElement)),true,'submitted work receives focus inside its own editor');
   assert.equal(await firstContainer.getAttribute('aria-labelledby'),'saved-output-title-'+result.outputId);
   assert.equal(await secondReopened.getByLabel('Show your work or describe your approach').isDisabled(),false);
   console.log(engine.name()+': API routing, failed-save preservation, refresh/reset draft preservation, editor deduplication, unload guards and submission passed');
  }finally{await browser.close();}
 }
}finally{await server.close();}
