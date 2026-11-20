import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium,webkit} from 'playwright';
import {startStaticServer} from './test-server.mjs';

const screenshots=resolve('out/silascalc-visuals');
await mkdir(screenshots,{recursive:true});
const server=await startStaticServer(resolve('out/wasm-math/dist/release'),8808);
try {
 for(const engine of [chromium,webkit]) {
  const browser=await engine.launch();
  try {
   for(const colorScheme of ['dark','light']) {
    // Even a light OS preference must start in Silas dark mode.
    const page=await browser.newPage({viewport:{width:1040,height:950},colorScheme:'light'});
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/api/brainfood/math/**',route=>route.fulfill({json:route.request().url().endsWith('/classes')
      ? {classes:['105516'],classLabels:{'105516':'Algebra 1'}}
      : {models:[{id:'test/model',label:'Learning model'}],default_model:'test/model'}}));
    await page.goto(server.origin);
    await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Ready') && document.querySelector('#learning-class').value==='105516');
    assert.equal(await page.evaluate(()=>getComputedStyle(document.body).backgroundColor),'rgb(16, 21, 31)');
    if(colorScheme==='light') await page.evaluate(()=>{document.documentElement.dataset.theme='light';});
    assert.equal(await page.title(),'silascalc');
    assert.equal(await page.getByRole('heading',{level:1}).textContent(),'silascalc');
    assert.equal(await page.locator('#learning-class option:checked').textContent(),'Algebra 1');
    const font=await page.evaluate(async()=>{
      const faces=await document.fonts.load('18px "JetBrains Mono"');
      return {loaded:faces.some(face=>face.status==='loaded'),family:getComputedStyle(document.querySelector('#expression')).fontFamily};
    });
    assert.ok(font.loaded,'bundled JetBrains Mono must actually load');
    assert.match(font.family,/JetBrains Mono/);
    assert.equal(await page.locator('.brand img').evaluate(image=>image.naturalWidth),128);
    await page.locator('#expression').fill('y=2*x+12');
    await page.getByRole('button',{name:'Graph',exact:true}).click();
    await page.locator('#graph').waitFor({state:'visible'});
    assert.deepEqual(await page.locator('#graph').evaluate(canvas=>Array.from(canvas.getContext('2d').getImageData(9,9,1,1).data)),colorScheme==='dark'?[12,20,32,255]:[255,255,255,255],'graph pixels follow the selected theme');
    if(engine===chromium) await page.screenshot({path:resolve(screenshots,`silascalc-${colorScheme}.png`),fullPage:true});
    await page.setViewportSize({width:375,height:812});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no horizontal overflow on a phone');
    if(engine===chromium) await page.screenshot({path:resolve(screenshots,`silascalc-${colorScheme}-mobile.png`),fullPage:true});
    assert.deepEqual(errors,[]);
    await page.close();
   }
   console.log(engine.name()+': dark default, themed graph pixels, font loading, named classes and optional light/mobile layout passed');
  } finally {await browser.close();}
 }
} finally {await server.close();}
