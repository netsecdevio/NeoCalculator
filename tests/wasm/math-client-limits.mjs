import assert from "node:assert/strict";
import {createNumosMath} from "../../wasm/math/numos-math-client.js";
const workers=[];
class FakeWorker {
  constructor(){this.terminated=false;this.messages=[];workers.push(this);}
  postMessage(message){
    this.messages.push(message);
    if(message.method === "initialize" || message.method === "shutdown" || message.method === "compileHandle1D" || message.method === "handle.dispose" || message.method === "handle.evaluateMany1D")
      queueMicrotask(()=>this.onmessage({data:{requestId:message.requestId,ok:true,result:{ready:true}}}));
  }
  terminate(){this.terminated=true;}
}
globalThis.Worker=FakeWorker;
globalThis.fetch=async()=>({ok:true,json:async()=>({assets:{worker:{url:"./worker.js"}}})});
await assert.rejects(createNumosMath({requestTimeoutMs:0}),{code:"INVALID_REQUEST"});
const math=await createNumosMath({requestTimeoutMs:100});
await assert.rejects(math.evaluate("long calculation"),{code:"TIME_LIMIT"});
assert.equal(workers.at(-1).terminated,true);
await assert.rejects(math.evaluate("2+2"),{code:"SHUTDOWN"});
const queued=await createNumosMath({requestTimeoutMs:1000});
const calls=Array.from({length:16},()=>queued.evaluate("x").catch(e=>e.code));
await assert.rejects(queued.evaluate("x"),{code:"INVALID_REQUEST"});
const staleWorker=workers.at(-1);
await queued.cancel();
staleWorker.onerror({message:"stale failure"});
assert.equal(workers.at(-1).terminated,false);
assert.deepEqual(await Promise.all(calls),Array(16).fill("TIME_LIMIT"));
await queued.shutdown();
assert.equal(workers.at(-1).terminated,true);
const cloning=await createNumosMath({requestTimeoutMs:100});
await assert.rejects(cloning.evaluate(()=>{}));
await cloning.shutdown();
console.log("Worker deadline, bounded queue, cancellation, shutdown and clone failure passed");

const handles=await createNumosMath({requestTimeoutMs:1000});
const handle=await handles.compile1D("x","x");
const activeWorker=workers.at(-1);
const busy=Array.from({length:16},()=>handles.evaluate("x").catch(e=>e.code));
await assert.rejects(handle.dispose(),{code:"INVALID_REQUEST"});
for(const message of activeWorker.messages.filter(m=>m.method === "evaluate")) activeWorker.onmessage({data:{requestId:message.requestId,ok:true,result:1}});
await Promise.all(busy);
await handle.evaluateMany({0:1,length:1});
assert.deepEqual(activeWorker.messages.at(-1).args[1],[1]);
await handle.dispose();
await assert.rejects(handle.dispose(),{code:"DISPOSED_HANDLE"});
await handles.shutdown();
console.log("Stale worker errors, retryable disposal and array-like samples passed");
