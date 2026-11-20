import assert from 'node:assert/strict';
import {chromium,webkit} from 'playwright';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {startStaticServer} from './test-server.mjs';
const root=resolve('out/wasm-math/dist/release');
const manifest=JSON.parse(await readFile(root+'/numos-math-assets.json','utf8'));
const server=await startStaticServer(root,8809);
try {for(const engine of [chromium,webkit]){
  const browser=await engine.launch();
  try{
    const page=await browser.newPage();const errors=[],outside=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('request',request=>{if(!request.url().startsWith(server.origin))outside.push(request.url());});
    await page.route('**/display-test.html',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'self\'; style-src \'self\'; font-src \'self\'"><link rel="stylesheet" href="'+manifest.assets.styles.url+'"><main id="test"></main>'}));
    await page.goto(server.origin+'/display-test.html');
    const mathModule=new URL(manifest.assets['math-text'].url,server.origin).href;
    const annotationModule=new URL(manifest.assets.annotations.url,server.origin).href;
    await page.evaluate(async({mathModule,annotationModule})=>{
      window.renderer=await import(mathModule);
      window.annotation=await import(annotationModule);
      window.formula=String.raw`\text{Domain: } -\tfrac{1}{4} < x < 0 \text{ or } x > 0`;
      window.result={steps:[{explanation:'Check where the logarithm is defined.',math:formula,citationIds:['domain']},{explanation:'Find the slope through (−2, 8) and (−6, 0).',math:String.raw`m=\frac{0-8}{-6-(-2)}=2`,citationIds:[]}],answer:String.raw`\(2\ln|x|-\frac{1}{2}\ln(4x+1)\)`,sources:[{id:'domain',title:'Logarithm rules',locator:'Domain, passage 1',url:'https://example.org/lesson#domain',excerpt:'The argument of a real logarithm must be positive. <img src=x onerror=alert(1)>',contentDigest:'test'}]};
      window.editor=annotation.mountAnnotations(document.querySelector('#test'),result,null,{onChange(){},renderGraph:async()=>{}});
    },{mathModule,annotationModule});
    assert.equal(await page.locator('.annotation-text math').count(),2,'both actual problem types render as math');
    assert.equal(await page.locator('.annotation-text math').first().locator('mfrac').count(),1,'domain fraction renders structurally');
    assert.equal(await page.locator('.step-math math').count(),1,'answer inline delimiters render');
    assert.equal(await page.locator('.annotation-step:visible').count(),1,'start with just one readable step');
    assert.equal(await page.locator('.lesson-answer').isVisible(),false,'answer follows the steps');
    await page.getByRole('button',{name:'Next step',exact:true}).click();
    assert.equal(await page.locator('.annotation-step:visible h3').innerText(),'Step 2');
    assert.equal(await page.locator('.lesson-answer').isVisible(),true);
    await page.getByRole('button',{name:'Show all steps',exact:true}).click();
    assert.equal(await page.locator('.annotation-step:visible').count(),2);
    await page.getByRole('button',{name:'One step at a time',exact:true}).click();
    await page.getByRole('button',{name:'Back',exact:true}).click();
    await page.getByRole('button',{name:'Lesson note: Logarithm rules'}).click();
    assert.equal(await page.getByRole('dialog').locator('h4').evaluate(node=>document.activeElement===node),true,'open at the beginning of the passage, not its bottom close button');
    assert.match(await page.getByRole('dialog').innerText(),/argument of a real logarithm must be positive/);
    assert.equal(await page.getByRole('dialog').locator('img,a,iframe,script').count(),0,'reference excerpt is inert text');
    assert.equal(page.context().pages().length,1,'reference stays inside lesson');
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('button',{name:'Lesson note: Logarithm rules'}).evaluate(node=>node===document.activeElement),true,'Escape returns focus');
    assert.equal(await page.getByRole('dialog').count(),0);
    await page.getByRole('button',{name:'Annotate',exact:true}).click();
    await page.locator('.annotation-text').first().evaluate(node=>{
      const range=document.createRange();range.selectNodeContents(node.querySelector('mfrac'));
      const selection=getSelection();selection.removeAllRanges();selection.addRange(range);node.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));
    });
    await page.getByLabel('Your comment',{exact:true}).fill('Why can x be negative here?');
    await page.getByRole('button',{name:'Add comment',exact:true}).click();
    const canonical=await page.evaluate(()=>({note:editor.value().annotations[0],formula,start:result.steps[0].explanation.length+1}));
    assert.deepEqual(canonical.note.anchor,{kind:'text',start:canonical.start,end:canonical.start+canonical.formula.length,quote:canonical.formula},'math selection maps to original saved text');
    assert.equal(await page.locator('.math-highlight math').count(),1,'pinned formula remains typeset');
    await page.evaluate(()=>editor.setDisabled(true));
    assert.equal(await page.locator('.math-highlight math').count(),1,'submitted notes keep math formatting');
    await page.getByRole('button',{name:'Next step',exact:true}).click();
    await page.getByRole('button',{name:'1. Step 1',exact:true}).click();
    assert.equal(await page.locator('.annotation-step:visible h3').innerText(),'Step 1','saved comment returns to its step');
    // Selection after rendered math must not count MathML's duplicated semantics.
    const mapped=await page.evaluate(()=>{
      const host=document.createElement('p');document.querySelector('#test').append(host);
      const source=String.raw`📈 Start \(\frac{1}{4}\) then check the domain.`;
      renderer.renderMathText(host,source);
      const text=host.lastChild,range=document.createRange();range.setStart(text,6);range.setEnd(text,11);
      return {anchor:renderer.selectedCanonicalText(host,range,source),expected:source.indexOf('check')};
    });
    assert.deepEqual(mapped.anchor,{kind:'text',start:mapped.expected,end:mapped.expected+5,quote:'check'});
    await page.evaluate(()=>{
      const host=document.createElement('div');host.id='legacy';document.querySelector('#test').append(host);
      const output=structuredClone(result);delete output.sources[0].excerpt;
      annotation.mountAnnotations(host,output,null,{onChange(){},renderGraph:async()=>{},sourcePreviews:[{...output.sources[0],excerpt:'Only this reviewed passage.',provenance:'current-reference'}]});
    });
    await page.locator('#legacy .annotation-source').click();
    assert.match(await page.locator('#legacy [role=dialog]').innerText(),/Only this reviewed passage/);
    assert.match(await page.locator('#legacy [role=dialog]').innerText(),/Current lesson passage/,'old outputs identify current rather than frozen references');
    await page.evaluate(()=>{
      const host=document.createElement('div');host.id='malicious';document.querySelector('#test').append(host);
      renderer.renderMathText(host,String.raw`\href{javascript:alert(1)}{click} \includegraphics{https://evil.example/x} \htmlStyle{display:none}{hidden}`,{mathStart:0});
    });
    assert.equal(await page.locator('#malicious a,#malicious img,#malicious script').count(),0,'untrusted math cannot create active content');
    await page.evaluate(()=>renderer.renderMathText(document.querySelector('#malicious'),String.raw`\def\a{\a}\a`,{mathStart:0}));
    assert.equal(await page.locator('#malicious').textContent(),String.raw`\def\a{\a}\a`,'recursive macros stop and fall back to safe text');
    for(const width of [320,390,1280]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'math stays within viewport '+width);}
    assert.deepEqual(errors,[]);assert.deepEqual(outside,[],'formatting and references never request third-party resources');
    console.log(engine.name()+': real domain/slope math, source bubbles, inert input, canonical annotations and mobile layout passed');
  }finally{await browser.close();}
}}finally{await server.close();}
