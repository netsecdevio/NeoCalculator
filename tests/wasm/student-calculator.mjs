import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';
import { startStaticServer } from './test-server.mjs';
const root = fileURLToPath(new URL('../../out/wasm/dist/release/', import.meta.url));
const server = await startStaticServer(root, 4288);
try {
  for (const engine of [chromium, webkit]) {
    const browser = await engine.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 560, height: 820 } });
      await page.goto(`${server.origin}/index.html?persistence=disabled`);
      await page.waitForFunction(() => window.numos?.isReady());
      const host = page.locator('numos-emulator');
      assert.equal(await page.title(), 'SilasCalc');
      assert.equal(await host.locator('.brand').innerText(), 'SilasCalc');
      assert.equal(await host.locator('details').getAttribute('open'), null);
      assert.equal(await host.locator('.controls').isVisible(), true);
      assert.equal(await host.locator('.status-row').isVisible(), false);
      assert.equal(await host.locator('.silas-mark').evaluate(img => img.complete && img.naturalWidth > 0), true);
      const fullWidth = (await host.locator('canvas').boundingBox()).width;
      await page.setViewportSize({ width: 509, height: 745 });
      await page.waitForFunction(() => document.querySelector('numos-emulator').shadowRoot.querySelector('canvas').clientWidth < 490);
      const zoomWidth = (await host.locator('canvas').boundingBox()).width * 1.1;
      assert.ok(zoomWidth > fullWidth * .8, '110% host zoom must not halve the display');
      await page.setViewportSize({ width: 560, height: 820 });
      await page.waitForFunction(() => window.numos.diagnosticState().app === 'Calculation');
      for (const style of ['silas', 'graphing', 'scientific']) {
        await host.getByLabel('Calculator style', { exact: true }).selectOption(style);
        await host.locator('[data-key-id="AC"]').last().click();
        for (const key of ['NUM_2', 'ADD', 'NUM_3', 'ENTER']) {
          await host.locator(`[data-key-id="${key}"]`).first().click();
        }
        await page.waitForFunction(() => window.numos.diagnosticState().calculation.exact === '5');
        assert.equal(await page.evaluate(() => window.numos.diagnosticState().calculation.status), 'ok');
      }
      await host.getByLabel('Calculator style', { exact: true }).selectOption('graphing');
      assert.equal(await page.evaluate(() => window.numos.diagnosticState().calculation.exact), '5', 'changing style preserves the calculation');
      await host.locator('[data-key-id="MODE"]').click();
      await page.waitForFunction(() => window.numos.diagnosticState().app === "Menu");
      await host.locator('[data-key-id="GRAPH"]').click();
      await page.waitForFunction(() => window.numos.diagnosticState().app === 'Grapher');
      await host.getByLabel('Calculator style', { exact: true }).selectOption('silas');
      await page.evaluate(() => scrollTo(0, 0));
      const keypad = await host.locator('.controls').boundingBox();
      if (process.env.SILASCALC_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SILASCALC_SCREENSHOT_DIR}/silascalc-student-${engine.name()}.png`, fullPage: true });
      assert.ok(keypad.x >= 0 && keypad.x + keypad.width <= 560, 'keypad fits the window width');
      const keyGeometry = await host.locator('.key').evaluateAll(keys => keys.map(key => {
        const primary = key.querySelector('.key-primary').getBoundingClientRect();
        const secondary = [...key.querySelectorAll('.key-legend:not([hidden])')].map(label => label.getBoundingClientRect().bottom);
        return { height: key.getBoundingClientRect().height, gap: secondary.length ? primary.top - Math.max(...secondary) : 100 };
      }));
      assert.ok(keyGeometry.every(key => key.height >= 40 && key.gap >= 1), 'key legends and primary labels must not overlap');
      assert.equal(await page.evaluate(() => window.numos.persistenceState().state), 'disabled');
      await host.getByRole('button', { name: 'Open on my phone', exact: true }).click();
      const phone = host.locator('.phone-handoff-dialog');
      await page.waitForFunction(() => document.querySelector('numos-emulator').shadowRoot.querySelector('.phone-handoff-dialog img').naturalWidth > 0);
      assert.equal(await phone.getByRole('link').getAttribute('href'),
        'https://famclaw.silas-ai.io/dashboard/lessons/calculator/emulator/index.html?persistence=disabled&style=silas');
      const beforePhone = await page.evaluate(() => window.numos.diagnosticState().input);
      assert.ok(Number.isFinite(beforePhone.events));
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('Escape');
      assert.equal(await phone.evaluate(dialog => dialog.open), false);
      assert.deepEqual(await page.evaluate(() => window.numos.diagnosticState().input), beforePhone,
        'phone dialog keyboard events must not enter the calculator');
      const phonePage = await browser.newPage({ viewport: { width: 390, height: 844 } });
      await phonePage.goto(`${server.origin}/index.html?persistence=disabled&style=scientific`);
      await phonePage.waitForFunction(() => window.numos?.isReady());
      assert.equal(await phonePage.locator('numos-emulator').getByLabel('Calculator style', { exact: true }).inputValue(), 'scientific');
      assert.equal(await phonePage.evaluate(() => window.numos.persistenceState().state), 'disabled');
      await phonePage.close();
      if (process.env.SILASCALC_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SILASCALC_SCREENSHOT_DIR}/silascalc-student-${engine.name()}.png`, fullPage: true });
      await page.evaluate(() => window.numos.requestShutdown());
      console.log(`${engine.name()}: calculator branding, all three actual key layouts, graph entry, zoom and readable keypad passed`);
    } finally { await browser.close(); }
  }
} finally { await server.close(); }
