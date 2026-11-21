/** Public calculator handoff only; no pairing, learner identity or work transfer. */
const STYLES = new Set(["silas", "graphing", "scientific"]);
const QR_IMAGES = {
  silas: new URL("./phone/qr-silas.png", import.meta.url).href,
  graphing: new URL("./phone/qr-graphing.png", import.meta.url).href,
  scientific: new URL("./phone/qr-scientific.png", import.meta.url).href,
};
export function phoneCalculatorUrl(style) {
  const selected = STYLES.has(style) ? style : "silas";
  return "https://famclaw.silas-ai.io/dashboard/lessons/calculator/emulator/index.html?persistence=disabled&style=" + selected;
}

export function createPhoneHandoff(getStyle = () => "silas") {
  const container = document.createElement("span");
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Open on my phone";
  button.className = "phone-handoff-button";
  const dialog = document.createElement("dialog");
  dialog.className = "phone-handoff-dialog";
  const title = document.createElement("h2");
  title.id = "phone-handoff-" + crypto.randomUUID();
  title.textContent = "Open on my phone";
  dialog.setAttribute("aria-labelledby", title.id);
  const help = document.createElement("p");
  help.textContent = "Use this calculator on your phone. Calculations stay on each device.";
  const instruction = document.createElement("p");
  instruction.textContent = "Scan with your phone’s camera to open SilasCalc.";
  const qr = document.createElement("img");
  qr.alt = "QR code for the public SilasCalc calculator";
  qr.width = 256;
  qr.height = 256;
  const link = document.createElement("a");
  link.textContent = "Open calculator link";
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.hidden = window.self !== window.top;
  const addressLabel = document.createElement("label");
  addressLabel.textContent = "Calculator address";
  const address = document.createElement("input");
  address.type = "text";
  address.inputMode = "url";
  address.readOnly = true;
  address.setAttribute("aria-label", "Calculator address");
  address.addEventListener("focus", () => address.select());
  address.addEventListener("click", () => address.select());
  addressLabel.append(address);
  const error = document.createElement("p");
  error.hidden = true;
  error.setAttribute("role", "status");
  error.textContent = "The QR image could not load. Copy the calculator address below to your phone.";
  qr.addEventListener("error", () => { error.hidden = false; });
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "Done";
  close.addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => button.focus());
  button.addEventListener("click", () => {
    const requested = getStyle();
    const selected = STYLES.has(requested) ? requested : "silas";
    const styleName = { silas: "SilasCalc", graphing: "Classroom graphing", scientific: "Scientific" }[selected];
    instruction.textContent = `Scan with your phone’s camera to open SilasCalc in the ${styleName} style.`;
    qr.alt = `QR code for SilasCalc in the ${styleName} style`;
    qr.src = QR_IMAGES[selected];
    link.href = phoneCalculatorUrl(selected);
    address.value = link.href;
    error.hidden = true;
    if (!dialog.open) dialog.showModal();
  });
  dialog.append(title, help, instruction, qr, link, error, addressLabel, close);
  const css = document.createElement("style");
  css.textContent = `
    .phone-handoff-dialog { color:#f5f7fb; background:#111b29; border:1px solid #8194ab; border-radius:16px; max-width:min(380px,calc(100vw - 48px)); padding:24px; box-sizing:border-box; text-align:center; }
    .phone-handoff-dialog::backdrop { background:rgba(3,8,15,.78); }
    .phone-handoff-dialog h2 { margin:0 0 12px; font-size:1.3rem; }
    .phone-handoff-dialog p { line-height:1.5; }
    .phone-handoff-dialog img { display:block; width:min(256px,100%); height:auto; margin:16px auto; image-rendering:pixelated; }
    .phone-handoff-dialog a { display:block; color:#94d5ff; margin:16px 0; text-decoration:underline; }
    .phone-handoff-dialog a[hidden] { display:none; }
    .phone-handoff-dialog label { display:block; text-align:left; font-size:.875rem; }
    .phone-handoff-dialog input { display:block; width:100%; box-sizing:border-box; padding:10px; margin:6px 0 16px; color:#f5f7fb; background:#07121e; border:1px solid #8194ab; border-radius:6px; }
    .phone-handoff-dialog button { color:#07121e; background:#9fdbff; border:1px solid #e4f3ff; border-radius:8px; padding:10px 20px; cursor:pointer; }
    .phone-handoff-dialog button:focus-visible,.phone-handoff-dialog a:focus-visible,.phone-handoff-dialog input:focus-visible { outline:3px solid #ffda78; outline-offset:4px; }
  `;
  container.append(css, button, dialog);
  return container;
}
