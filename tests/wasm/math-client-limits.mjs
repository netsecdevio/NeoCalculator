import assert from "node:assert/strict";
import {createNumosMath} from "../../wasm/math/numos-math-client.js";
const workers=[];
class FakeWorker {
  constructor(){this.terminated=false;workers.push(this);}
  postMessage(message){
    if(message.method === "initialize" || message.method === "shutdown")
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
await queued.cancel();
assert.deepEqual(await Promise.all(calls),Array(16).fill("TIME_LIMIT"));
await queued.shutdown();
assert.equal(workers.at(-1).terminated,true);
const cloning=await createNumosMath({requestTimeoutMs:100});
await assert.rejects(cloning.evaluate(()=>{}));
await cloning.shutdown();
console.log("Worker deadline, bounded queue, cancellation, shutdown and clone failure passed");
