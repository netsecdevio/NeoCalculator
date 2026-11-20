// All teaching requests go to the shared LLM + retrieval service. No solution templates.
const pending = new Map();
const params = new URLSearchParams(window.location.search);
const parentOrigin = params.get('parentOrigin') || window.location.origin;
const trustedParents = new Set(['http://127.0.0.1:1420','http://localhost:1420','http://tauri.localhost','https://tauri.localhost','tauri://localhost','https://brainfood.silas-ai.io']);
const parentTransport = params.get('transport')==='parent' && window.parent!==window;
window.addEventListener('message', event => {
  if (!parentTransport || !trustedParents.has(parentOrigin) || event.source !== window.parent || event.origin !== parentOrigin) return;
  const message=event.data;
  if (!message || message.type!=='brainfood-math-response' || !pending.has(message.id)) return;
  const job=pending.get(message.id);pending.delete(message.id);clearTimeout(job.timer);
  if(message.error) job.reject(Error(String(message.error)));
  else job.resolve(message.data);
});
async function request(action, body) {
  if(parentTransport) {
    if(!trustedParents.has(parentOrigin)) throw Error('This calculator embedding is not trusted. Open it from Brainfood.');
    const id=crypto.randomUUID();
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{pending.delete(id);reject(Error('Teaching help timed out. Please try again.'));},180000);
      pending.set(id,{resolve,reject,timer});
      window.parent.postMessage({type:'brainfood-math-request',id,action,body},parentOrigin);
    });
  }
  const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),180000);
  try {
    const response=await fetch('/api/brainfood/math/'+action,{method:body?'POST':'GET',credentials:'same-origin',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:controller.signal});
    if(!response.ok) {
      if(response.status===401||response.status===403) throw Error('Please sign in or pair this device to ask for teaching help.');
      if(response.status===429) throw Error('The tutor is busy. Please try again shortly.');
      throw Error('Teaching help is temporarily unavailable. Your problem has not been rejected.');
    }
    if(!response.headers.get('content-type')?.includes('application/json'))throw Error('Please sign in again to ask for teaching help.');
    return await response.json();
  } finally {clearTimeout(timeout);}
}
export const loadModels=()=>request('models');
export const requestExplanation=(problem,context,model,classId)=>request('explain',{problem,context,classId,...(model?{model}:{})});

export const loadClasses=()=>request("classes");
export const saveFeedback=(id,body)=>request("outputs/"+encodeURIComponent(id)+"/feedback",body);

export const loadOutputs=()=>request("outputs");
export const loadOutput=id=>request("outputs/"+encodeURIComponent(id));
