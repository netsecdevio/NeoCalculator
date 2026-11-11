import assert from 'node:assert/strict';
import {chromium,webkit} from 'playwright';
import {resolve} from 'node:path';
import {startStaticServer} from './test-server.mjs';
import {buildExplanation} from '../../wasm/math/learning-steps.js';
for(const input of ['x^2=2','sin(x)','0*x+1=2','1 2x=4','*x=4','log10(3)','log10(0)']) assert.equal(buildExplanation(input),null,input);
assert.throws(()=>buildExplanation('1/0+1/2'),/zero/);
const server=await startStaticServer(resolve('out/wasm-math/dist/release'),8797);
try {
  for(const engine of [chromium,webkit]) {
    const browser=await engine.launch();
    try {
      const page=await browser.newPage();
      let failManifest=true;
      await page.route('**/numos-math-assets.json', route=>failManifest?route.fulfill({status:503,body:'unavailable'}):route.continue());
      await page.goto(server.origin);
      await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('retry'));
      assert.equal(await page.getByRole('button',{name:'Clear session'}).isEnabled(),true);
      failManifest=false;
      await page.getByRole('button',{name:'Clear session'}).click();
      await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Ready'));
      assert.equal(await page.locator('#explanation').isVisible(),false);
      for(const [input,expected] of [
        ['2*x+4=0','x = -2'],['-3*x-2=7','x = -3'],['1/2*x+1/3=2/3','x = 2/3'],
        ['1/3+1/6','1/2'],['1/3-5/6','-1/2'],['log10(1000)','log10(1000) = 3'],['log10(0.01)','log10(0.01) = -2'],
      ]) {
        await page.locator('#expression').fill(input);
        assert.equal(await page.locator('#explanation').isVisible(),false);
        await page.getByRole('button',{name:'Explain steps',exact:true}).click();
        await page.waitForFunction(()=>!document.querySelector('[data-action="explain"]').disabled);
        assert.match(await page.locator('#status').innerText(),/^Steps checked/,input);
        assert.ok((await page.locator('#explanation').innerText()).includes(expected),expected);
      }
      await page.locator('#expression').fill('x^2=2');
      await page.getByRole('button',{name:'Explain steps'}).click();
      await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('not available'));
      assert.equal(await page.locator('#explanation').isVisible(),false);
      await page.getByRole('button',{name:'Clear session'}).click();
      await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Ready'));
      assert.equal(await page.locator('#explanation').isVisible(),false);
      const rejecting=await browser.newPage();
      await rejecting.route('**/numos-math-client.*.js',route=>route.fulfill({contentType:'text/javascript',body:'export async function createNumosMath(){return {evaluate:async()=>({result:{kind:"integer",value:"1"}}),simplify:async()=>({result:{kind:"integer",value:"1"}}),shutdown:async()=>({})}}'}));
      await rejecting.goto(server.origin);
      await rejecting.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Ready'));
      await rejecting.locator('#expression').fill('2*x+4=0');
      await rejecting.getByRole('button',{name:'Explain steps'}).click();
      await rejecting.waitForFunction(()=>document.querySelector('#status').textContent.includes('could not be verified'));
      assert.equal(await rejecting.locator('#explanation').isVisible(),false);
      await rejecting.close();
      console.log(engine.name()+': checked explanations, unsupported cases and stale-step clearing passed');
    } finally {await browser.close();}
  }
} finally {await server.close();}
