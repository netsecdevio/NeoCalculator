const input = document.querySelector('#expression');
const status = document.querySelector('#status');
const answer = document.querySelector('#answer');
const canvas = document.querySelector('#graph');
const buttons = [...document.querySelectorAll('[data-action]')];
let math, createMath, generation = 0;
function busy(value) { buttons.forEach(button => { button.disabled = value; }); }
async function reset() {
  const token = ++generation;
  busy(true); input.value = ''; answer.textContent = ''; canvas.hidden = true;
  document.querySelector('#graph-description').textContent = '';
  status.textContent = 'Starting a fresh session…';
  const previous = math; math = null;
  if (previous) await previous.shutdown().catch(() => {});
  try {
    const session = await createMath({manifestUrl: new URL('./numos-math-assets.json', import.meta.url)});
    if (token !== generation) { await session.shutdown(); return; }
    math = session; status.textContent = 'Ready. Start with something simple.'; busy(false);
  } catch(error) { if(token === generation) status.textContent = 'Could not start: ' + error.message; }
}
async function run(action) {
  if (!math || buttons[0].disabled) return;
  const text = input.value.trim(); if (!text) { status.textContent = 'Enter an expression first.'; return; }
  const token = generation, session = math; busy(true); status.textContent = 'Working…'; answer.textContent = ''; canvas.hidden = true;
  document.querySelector('#graph-description').textContent = '';
  try {
    if (action === 'graph') {
      const expression = text.replace(/^y\s*=\s*/i, '');
      const handle = await session.compile1D(expression, 'x');
      try {
        const values = await handle.evaluateMany(Array.from({length:721},(_,i)=>-10+i/36));
        if (token !== generation) return;
        const ctx = canvas.getContext('2d'); ctx.clearRect(0,0,720,480);
        ctx.lineWidth=1; ctx.strokeStyle='#dbe5ee';
        for(let i=0;i<=20;i++){ctx.beginPath();ctx.moveTo(i*36,0);ctx.lineTo(i*36,480);ctx.moveTo(0,i*24);ctx.lineTo(720,i*24);ctx.stroke();}
        ctx.strokeStyle='#64788d';ctx.beginPath();ctx.moveTo(360,0);ctx.lineTo(360,480);ctx.moveTo(0,240);ctx.lineTo(720,240);ctx.stroke();
        ctx.fillStyle='#334d67';ctx.font='12px system-ui';for(let n=-10;n<=10;n+=2){if(n){ctx.fillText(String(n),360+n*36+2,254);ctx.fillText(String(n),364,240-n*24-3);}}
        ctx.strokeStyle='#145a87';ctx.lineWidth=2;ctx.beginPath();let previous=null;
        values.forEach((v,i)=>{const y=240-v.value*24;if(v.kind!=='finite'||!Number.isFinite(y)||Math.abs(v.value)>10){previous=null;return;}if(previous!==null&&Math.abs(y-previous)<120)ctx.lineTo(i,y);else ctx.moveTo(i,y);previous=y;});ctx.stroke();canvas.hidden=false;
        document.querySelector('#graph-description').textContent='y = '+expression+'; viewing x and y from −10 to 10. Large jumps are left disconnected.';
      } finally { await handle.dispose().catch(()=>{}); }
    } else {
      const result = action === 'solve' ? await session.solve(text,'x') : await session[action](text);
      if (token !== generation) return;
      answer.textContent = result.displayText || JSON.stringify(result.result, null, 2);
    }
    if (token === generation) status.textContent = 'Done. Check the result against your working.';
  } catch(error) { if(token === generation) status.textContent = error.code === 'TIME_LIMIT' || error.code === 'SHUTDOWN' ? 'That calculation stopped. Choose Clear session to start again.' : error.message; }
  finally { if(token === generation) busy(false); }
}
document.querySelector('#calculator').addEventListener('submit', event=>{event.preventDefault();void run('evaluate');});
buttons.filter(b=>b.type!=='submit').forEach(button=>button.addEventListener('click',()=>void run(button.dataset.action)));
document.querySelector('#clear').addEventListener('click',()=>{if(createMath) void reset();});
busy(true);
try {
  const manifestUrl = new URL('./numos-math-assets.json', import.meta.url);
  const response = await fetch(manifestUrl); if(!response.ok) throw Error('calculator files unavailable');
  const manifest = await response.json();
  const module = await import(new URL(manifest.assets.client.url, manifestUrl));
  createMath = module.createNumosMath; await reset();
} catch(error) { status.textContent='Could not load calculator: '+error.message; }
