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
      const pageErrors = [];
      const missingAssets = [];
      page.on('pageerror', error => pageErrors.push(error.message));
      page.on('response', response => {
        if (response.url().startsWith(server.origin) && response.status() >= 400)
          missingAssets.push(`${response.status()} ${response.url()}`);
      });
      await page.goto(`${server.origin}/index.html?persistence=disabled`);
      await page.waitForFunction(() => window.numos?.isReady());
      const host = page.locator('numos-emulator');
      assert.equal(await page.title(), 'SilasCalc');
      assert.equal(await host.locator('.brand').innerText(), 'SilasCalc');
      assert.equal(await host.locator('details').getAttribute('open'), null);
      await host.locator('summary').click();
      const contrasts = await host.locator('.details-body button').evaluateAll(buttons => {
        const luminance = css => {
          const channels = css.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => {
            value /= 255; return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
          });
          return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
        };
        return buttons.filter(button => !button.hidden && !button.disabled).map(button => {
          const css = getComputedStyle(button), fg = luminance(css.color), bg = luminance(css.backgroundColor);
          return { text: button.textContent, ratio: (Math.max(fg, bg) + .05) / (Math.min(fg, bg) + .05) };
        });
      });
      assert.ok(contrasts.length >= 4 && contrasts.every(item => item.ratio >= 4.5), JSON.stringify(contrasts));
      await host.locator('summary').click();
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
      // Exercise every packaged QR dependency, not just the default picture.
      for (const style of ['graphing', 'scientific', 'silas']) {
        await phone.getByRole('button', { name: 'Done', exact: true }).click();
        await host.getByLabel('Calculator style', { exact: true }).selectOption(style);
        await host.getByRole('button', { name: 'Open on my phone', exact: true }).click();
        await phone.locator('img').evaluate(img => img.decode());
        assert.ok(await phone.locator('img').evaluate(img => img.naturalWidth > 0));
        assert.ok((await phone.getByRole('link').getAttribute('href')).endsWith(`style=${style}`));
      }
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
      const launcherPage = await browser.newPage({ viewport: { width: 560, height: 820 } });
      await launcherPage.goto(`${server.origin}/index.html?persistence=disabled&start=launcher`);
      await launcherPage.waitForFunction(() => window.numos?.isReady());
      assert.equal(await launcherPage.evaluate(() => window.numos.diagnosticState().app), 'Menu');
      // Preserve the actual legacy equation-card workflow, including its coordinates.
      const launcherCanvas = launcherPage.locator('numos-emulator').locator('canvas');
      const launcherBox = await launcherCanvas.boundingBox();
      await launcherCanvas.click({ position: { x: 255 * launcherBox.width / 320, y: 72 * launcherBox.height / 240 }, delay: 40 });
      await launcherPage.waitForFunction(() => window.numos.diagnosticState().app === 'Equations');
      await launcherPage.evaluate(() => window.numos.restart());
      await launcherPage.waitForFunction(() => window.numos?.isReady());
      assert.equal(await launcherPage.evaluate(() => window.numos.diagnosticState().app), 'Menu');
      await launcherPage.close();
      if (process.env.SILASCALC_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SILASCALC_SCREENSHOT_DIR}/silascalc-student-${engine.name()}.png`, fullPage: true });
      assert.deepEqual(missingAssets, [], 'the served package contains every runtime/image dependency');
      assert.deepEqual(pageErrors, [], 'the standalone module graph loads without uncaught errors');
      await page.evaluate(() => window.numos.requestShutdown());
      console.log(`${engine.name()}: calculator branding, all three actual key layouts, graph entry, zoom and readable keypad passed`);
    } finally { await browser.close(); }
  }
} finally { await server.close(); }
