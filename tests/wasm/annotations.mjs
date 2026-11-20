import assert from 'node:assert/strict';
import {chromium,webkit} from 'playwright';
import {resolve} from 'node:path';
import {startStaticServer} from './test-server.mjs';
const server=await startStaticServer(resolve('out/wasm-math/dist/release'),8799);
try {for(const engine of [chromium,webkit]){
  const browser=await engine.launch();
  try {
    const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
    let feedback=null,version=0,submitted=false;
    const result={outputId:'12345678-1234-1234-1234-123456789abc',revision:'immutable-v1',classId:'algebra',title:'Find the line',steps:[{explanation:'📈 Find the slope. Keep the point order.',math:'m = 2',citationIds:[]}],sources:[],answer:'y = 2x + 12',limitations:[],model:'test/model'};
    await page.route('**/api/brainfood/math/**',async route=>{
      const path=new URL(route.request().url()).pathname;let data;
      if(path.endsWith('/models'))data={models:[{id:'test/model',label:'Test'}],default_model:'test/model'};
      else if(path.endsWith('/classes'))data={classes:['algebra'],classLabels:{algebra:'Algebra 1'}};
      else if(path.endsWith('/explain'))data=result;
      else if(path.endsWith('/outputs'))data={outputs:[result]};
      else if(path.endsWith('/feedback')){const payload=route.request().postDataJSON();assert.equal(payload.revision,result.revision);assert.equal(payload.version,version);assert.equal(submitted,false);feedback=payload.feedback;submitted=payload.submit;data={version:++version,submitted};}
      else data={...result,output:result,feedback,version,submitted};
      await route.fulfill({json:data});
    });
    await page.goto(server.origin);
    await page.waitForFunction(()=>document.querySelector('#learning-class')?.value==='algebra'&&document.querySelector('#status').textContent.startsWith('Ready'));
    await page.locator('#expression').fill('Find the line through (-2,8) and (-6,0)');
    await page.getByRole('button',{name:'Explain steps',exact:true}).click();
    const panel=page.locator('.feedback');await panel.waitFor();
    assert.equal(await panel.locator('textarea').count(),3,'one hidden composer plus work/comment, not a box for every step');
    await panel.getByRole('button',{name:'Annotate',exact:true}).click();
    // Select actual text after an emoji: persisted offsets must be UTF-16.
    await panel.locator('.annotation-text').evaluate(node=>{const range=document.createRange();range.setStart(node.firstChild,3);range.setEnd(node.firstChild,17);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);node.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));});
    await panel.getByLabel('Your comment',{exact:true}).fill('Why this slope? <img src=x onerror=alert(1)>');
    await panel.getByRole('button',{name:'Save draft',exact:true}).click();
    assert.equal(version,0,'open comment must not silently disappear on save');
    await panel.getByRole('button',{name:'Add comment',exact:true}).click();
    assert.equal(await panel.locator('mark').innerText(),'Find the slope');
    assert.equal(await panel.locator('.annotation-list img').count(),0,'comments are text, never executable markup');
    await panel.locator('.annotation-graph-tools summary').click();
    await panel.getByLabel('Graph expression',{exact:true}).fill('2*x+12');
    await panel.getByRole('button',{name:'Draw graph',exact:true}).click();
    await panel.locator('.annotation-graph').waitFor({state:'visible'});
    await panel.locator('.annotation-graph canvas').click({position:{x:80,y:40}});
    await panel.getByLabel('Your comment',{exact:true}).fill('Is this where the line crosses?');
    await panel.getByRole('button',{name:'Add comment',exact:true}).click();
    assert.equal(await panel.locator('.graph-pin').count(),1);
    await panel.getByRole('button',{name:'Save draft',exact:true}).click();
    await page.waitForFunction(()=>[...document.querySelectorAll('.feedback [role=status]')].some(n=>n.textContent==='Draft saved.'));
    assert.equal(feedback.annotationFormat,2);assert.equal(feedback.annotations.length,2);assert.deepEqual(feedback.annotations[0].anchor,{kind:'text',start:3,end:17,quote:'Find the slope'});
    assert.equal(feedback.graph.expression,'2*x+12');assert.equal(feedback.annotations[1].anchor.kind,'graph');assert.ok(feedback.annotations[1].anchor.x>0&&feedback.annotations[1].anchor.x<1);
    const anchor=feedback.annotations[1].anchor;
    let releaseStartup;const startupGate=new Promise(resolve=>{releaseStartup=resolve;});
    await page.route('**/numos-math-assets.json?*',async route=>{await startupGate;await route.continue();});
    await page.reload();await page.getByRole('button',{name:'Open saved work',exact:true}).click();await page.getByRole('button',{name:'Find the line — algebra',exact:true}).click();
    await panel.getByRole('status').filter({hasText:'Drawing graph…'}).waitFor();
    releaseStartup();
    await panel.locator('.annotation-graph').waitFor({state:'visible'});
    await panel.locator('.graph-pin').waitFor();assert.equal(await panel.locator('mark').innerText(),'Find the slope');
    assert.equal(await panel.locator('.annotation-list li').count(),2);
    for(const width of [320,768,1024,1440]){
      await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no page overflow at '+width);
      const pin=await panel.locator('.graph-pin').evaluate(node=>({left:parseFloat(node.style.left),top:parseFloat(node.style.top)}));
      assert.ok(Math.abs(pin.left-anchor.x*100)<0.001,JSON.stringify({pin,anchor}));assert.ok(Math.abs(pin.top-anchor.y*100)<0.001,JSON.stringify({pin,anchor}));
    }
    await panel.getByRole('button',{name:'Submit for review',exact:true}).click();
    await page.waitForFunction(()=>[...document.querySelectorAll('.feedback [role=status]')].some(n=>n.textContent==='Submitted for review.'));
    assert.equal(submitted,true);assert.equal(await panel.getByRole('button',{name:'Annotate',exact:true}).isDisabled(),true);
    assert.equal(await panel.getByRole('button',{name:'Edit comment 1',exact:true}).count(),0);
    assert.deepEqual(errors,[]);console.log(engine.name()+': text anchors, graph pins, safe text, pending comment guard, reopen, submission and responsive layout passed');
  }finally{await browser.close();}
}}finally{await server.close();}
