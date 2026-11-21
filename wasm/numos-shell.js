// Standalone-demo compatibility adapter only. The reusable component module
// does not install window.numos or window.numosReady.
import { NumosUnsupportedBrowserError } from "./numos-emulator-element.js";

const emulator = document.querySelector("numos-emulator");
if (!emulator) throw new Error("The standalone NumOS demo needs <numos-emulator>");
if (!globalThis.customElements) {
  const error = new NumosUnsupportedBrowserError({
    recoverable: false, details: "Missing: Custom Elements",
  });
  emulator.setAttribute("role", "alert");
  emulator.textContent = "This browser cannot run the calculator. Please use an up-to-date browser.";
  window.numos = Object.freeze({ isReady: () => false });
  window.numosReady = Promise.reject(error);
  window.numosReady.catch(() => {});
} else {
  const parameters = new URLSearchParams(location.search);
  emulator.calculatorStyle = parameters.get("style") || "silas";
  if (parameters.get("persistence") === "disabled") {
    emulator.setAttribute("persistence", "disabled");
  }
  if (parameters.get("persistenceTest")) {
    emulator.setAttribute("persistence-test", parameters.get("persistenceTest"));
  }

  // The student entry opens as a calculator, not an operating-system launcher.
  // HOME still exposes graphing and the other engine tools.
  emulator.addEventListener("numos-ready", () => {
    if (emulator.diagnosticState()?.app === "Menu") emulator.pressLogicalKey(48);
  });

  const api = Object.freeze({
    isReady: () => emulator.state === "ready",
    diagnosticState: () => emulator.diagnosticState(),
    requestShutdown: () => emulator.shutdown(),
    sendLogicalKey: (keyCode, actionCode = 1) =>
      emulator.sendLogicalKey(keyCode, actionCode),
    pressLogicalKey: (keyCode) => emulator.pressLogicalKey(keyCode),
    persistenceState: () => emulator.persistenceState(),
    flushPersistence: () => emulator.flushPersistence(),
    resetPersistentStorage: () => emulator.resetPersistentStorage(),
    start: () => emulator.start(),
    restart: () => emulator.restart(),
  });

  window.numos = api;
  window.numosReady = emulator.ready;
}
