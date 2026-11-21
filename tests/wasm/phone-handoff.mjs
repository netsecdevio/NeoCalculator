import assert from "node:assert/strict";
import { resolve } from "node:path";
import { chromium, webkit } from "playwright";
import { startStaticServer } from "./test-server.mjs";

const server = await startStaticServer(resolve("wasm"), 8897);
try {
  for (const engine of [chromium, webkit]) {
    const browser = await engine.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      const external = [];
      page.on("request", request => {
        if (!request.url().startsWith(server.origin)) external.push(request.url());
      });
      await page.route("**/phone-fixture.html", route => route.fulfill({
        contentType: "text/html",
        body: '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><script type="module">import {createPhoneHandoff,phoneCalculatorUrl} from "./numos-phone.js";window.style="silas";window.phoneCalculatorUrl=phoneCalculatorUrl;document.body.append(createPhoneHandoff(()=>window.style));</script></body></html>',
      }));
      await page.goto(server.origin + "/phone-fixture.html");
      for (const style of ["silas", "graphing", "scientific", "javascript:alert(1)"]) {
        await page.evaluate(style => { window.style = style; }, style);
        await page.getByRole("button", { name: "Open on my phone", exact: true }).click();
        const selected = ["silas", "graphing", "scientific"].includes(style) ? style : "silas";
        const expected = "https://famclaw.silas-ai.io/dashboard/lessons/calculator/emulator/index.html?persistence=disabled&style=" + selected;
        assert.equal(await page.getByRole("link", { name: "Open calculator link" }).getAttribute("href"), expected);
        const styleName = { silas: "SilasCalc", graphing: "Classroom graphing", scientific: "Scientific" }[selected];
        assert.equal(await page.locator("dialog img").getAttribute("alt"), `QR code for SilasCalc in the ${styleName} style`);
        assert.equal(await page.getByText(`Scan with your phone’s camera to open SilasCalc in the ${styleName} style.`, { exact: true }).isVisible(), true);
        await page.waitForFunction(() => document.querySelector("dialog img").naturalWidth > 0);
        assert.match(await page.locator("dialog img").getAttribute("src"), new RegExp("qr-" + selected + "\\.png$"));
        assert.equal(await page.locator("dialog").evaluate(dialog => dialog.getBoundingClientRect().width <= innerWidth), true);
        await page.getByRole("button", { name: "Done", exact: true }).click();
        assert.equal(await page.getByRole("button", { name: "Open on my phone", exact: true }).evaluate(button => document.activeElement === button), true);
      }
      assert.deepEqual(external, [], "opening QR must not contact any third party or learner API");
      await page.route("**/qr-silas.png", route => route.abort());
      await page.evaluate(() => { window.style = "silas"; });
      await page.getByRole("button", { name: "Open on my phone", exact: true }).click();
      // A previous successful image may be cached; force an image error for the fallback control.
      await page.locator("dialog img").evaluate(image => image.dispatchEvent(new Event("error")));
      await page.getByRole("status").waitFor({ state: "visible" });
      assert.equal(await page.getByRole("link", { name: "Open calculator link" }).isVisible(), true);
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("dialog").evaluate(dialog => dialog.open), false);
      await page.route("**/embedded-phone.html", route => route.fulfill({
        contentType: "text/html",
        body: '<iframe title="Calculator" sandbox="allow-scripts allow-same-origin" src="/phone-fixture.html" style="width:100%;height:760px;border:0"></iframe>',
      }));
      await page.goto(server.origin + "/embedded-phone.html");
      const frame = page.frameLocator("iframe");
      await frame.getByRole("button", { name: "Open on my phone", exact: true }).click();
      assert.equal(await frame.getByRole("link", { name: "Open calculator link" }).count(), 0, "embedded dialog must not offer a blocked popup action");
      const address = frame.getByRole("textbox", { name: "Calculator address" });
      const expected = "https://famclaw.silas-ai.io/dashboard/lessons/calculator/emulator/index.html?persistence=disabled&style=silas";
      assert.equal(await address.inputValue(), expected);
      assert.equal(await address.getAttribute("readonly"), "");
      await address.click();
      await address.press("ControlOrMeta+A");
      assert.equal(await address.evaluate(input => input.selectionStart === 0 && input.selectionEnd === input.value.length), true);
      await frame.locator("dialog img").evaluate(image => image.dispatchEvent(new Event("error")));
      await frame.getByRole("status").waitFor({ state: "visible" });
      assert.equal(await address.isVisible(), true);
      assert.deepEqual(external, [], "embedded fallback must remain local and credential-free");
      const pageErrors = [];
      page.on("pageerror", error => pageErrors.push(error.message));
      // Older embedded webviews may lack UUID and some or all native dialog APIs.
      for (const missing of ["uuid", "constructor", "showModal", "close", "all"]) {
        const compatibility = await browser.newPage({ viewport: { width: 390, height: 844 } });
        compatibility.on("pageerror", error => pageErrors.push(error.message));
        await compatibility.addInitScript(mode => {
          Object.defineProperty(crypto, "randomUUID", { configurable: true, value: undefined });
          if (mode === "showModal" || mode === "all") Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: undefined });
          if (mode === "close" || mode === "all") Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: undefined });
          if (mode === "constructor" || mode === "all") Object.defineProperty(window, "HTMLDialogElement", { configurable: true, value: undefined });
        }, missing);
        await compatibility.route("**/compatibility-phone.html", route => route.fulfill({
          contentType: "text/html",
          body: '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><script type="module">import {createPhoneHandoff} from "./numos-phone.js";document.body.append(createPhoneHandoff(()=>"scientific"));</script></body></html>',
        }));
        await compatibility.goto(server.origin + "/compatibility-phone.html");
        const launch = compatibility.getByRole("button", { name: "Open on my phone", exact: true });
        await launch.waitFor();
        const panel = compatibility.locator(".phone-handoff-dialog");
        assert.equal(await panel.isVisible(), false);
        await launch.click();
        assert.equal(await panel.isVisible(), true);
        assert.equal(await panel.evaluate(node => node.tagName), missing === "uuid" ? "DIALOG" : "SECTION");
        assert.equal(await compatibility.getByRole("textbox", { name: "Calculator address" }).inputValue(), expected.replace("style=silas", "style=scientific"));
        await compatibility.waitForFunction(() => document.querySelector(".phone-handoff-dialog img").naturalWidth > 0);
        await compatibility.getByRole("button", { name: "Done", exact: true }).click();
        assert.equal(await panel.isVisible(), false);
        assert.equal(await launch.evaluate(button => document.activeElement === button), true);
        await launch.click();
        await compatibility.getByRole("textbox", { name: "Calculator address" }).press("Escape");
        assert.equal(await panel.isVisible(), false);
        await compatibility.close();
      }
      assert.deepEqual(pageErrors, [], "optional APIs must not break calculator construction or handoff");
      console.log(engine.name() + ": style allowlist, local QR assets, mobile fit, focus, fallback and zero external requests passed");
    } finally { await browser.close(); }
  }
} finally { await server.close(); }
