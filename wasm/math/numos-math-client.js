function makeError(value) {
  const error = new Error(value?.message || "NumOS Math request failed");
  error.name = "NumosMathError";
  error.code = value?.code || "INTERNAL_ERROR";
  return error;
}

export async function createNumosMath({
  manifestUrl = "./numos-math-assets.json",
  requestTimeoutMs = 5000,
} = {}) {
  if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 100 || requestTimeoutMs > 30000)
    throw makeError({code: "INVALID_REQUEST", message: "requestTimeoutMs must be 100–30000"});
  const manifestAbsolute = new URL(manifestUrl, import.meta.url);
  const manifestResponse = await fetch(manifestAbsolute);
  if (!manifestResponse.ok) throw new Error("Could not load NumOS Math manifest");
  const manifest = await manifestResponse.json();
  const workerUrl = new URL(manifest.assets.worker.url, manifestAbsolute);
  let worker = new Worker(workerUrl, { type: "module", name: "numos-math" });
  let nextRequestId = 1;
  let shutDown = false;
  const pending = new Map();

  const rejectAll = (code, message) => {
    for (const { reject, timer } of pending.values()) {
      clearTimeout(timer);
      reject(makeError({ code, message }));
    }
    pending.clear();
  };
  const bind = () => {
    const boundWorker = worker;
    worker.onmessage = ({ data }) => {
      if (worker !== boundWorker) return;
      const request = pending.get(data.requestId);
      if (!request) return;
      clearTimeout(request.timer);
      pending.delete(data.requestId);
      data.ok ? request.resolve(data.result)
              : request.reject(makeError(data.error));
    };
    worker.onerror = (event) => {
      if (worker !== boundWorker) return;
      shutDown = true;
      worker.terminate();
      rejectAll("INTERNAL_ERROR", event.message || "NumOS Math Worker failed");
    };
  };
  bind();
  const request = (method, args = []) => {
    if (shutDown) return Promise.reject(makeError({
      code: "SHUTDOWN", message: "session has been shut down",
    }));
    if (pending.size >= 16) return Promise.reject(makeError({code: "INVALID_REQUEST", message: "too many pending calculations"}));
    const requestId = nextRequestId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        shutDown = true;
        worker.terminate();
        rejectAll("TIME_LIMIT", "Calculation timed out; create a new session to continue");
      }, requestTimeoutMs);
      pending.set(requestId, { resolve, reject, timer });
      try { worker.postMessage({ requestId, method, args: structuredClone(args) }); }
      catch (error) { clearTimeout(timer); pending.delete(requestId); reject(error); }
    });
  };
  try { await request("initialize", [manifestAbsolute.href]); }
  catch (error) { worker.terminate(); throw error; }

  const withDisposal = (id, methods) => {
    let disposed = false;
    let disposing;
    return Object.freeze({...methods, dispose: () => {
      if (disposed) return Promise.reject(makeError({code: "DISPOSED_HANDLE", message: "expression was disposed"}));
      if (disposing) return disposing;
      disposing = request("handle.dispose", [id]).then(result => { disposed = true; return result; }).finally(() => { disposing = undefined; });
      return disposing;
    }});
  };
  const make1D = (id) => withDisposal(id, {
    evaluate: (x) => request("handle.evaluate1D", [id, x]),
    evaluateMany: (values) => {
      if (values == null || !Number.isInteger(values.length) || values.length < 0 || values.length > 4096)
        return Promise.reject(makeError({code: "INVALID_REQUEST", message: "at most 4096 graph samples are allowed"}));
      return request("handle.evaluateMany1D", [id, Array.from(values)]);
    },
  });
  const make2D = (id) => withDisposal(id, {
    evaluate: (x, y) => request("handle.evaluate2D", [id, x, y]),
    evaluateGrid: (bounds) =>
      request("handle.evaluateGrid2D", [id, structuredClone(bounds)]),
  });

  return Object.freeze({
    evaluate: (expression, options) =>
      request("evaluate", [expression, options]),
    approximate: (expression, options) =>
      request("approximate", [expression, options]),
    simplify: (expression, options) =>
      request("simplify", [expression, options]),
    differentiate: (expression, variable, options) =>
      request("differentiate", [expression, variable, options]),
    integrate: (expression, variable, options) =>
      request("integrate", [expression, variable, options]),
    solve: (equations, variables, options) =>
      request("solve", [equations, variables, options]),
    compile1D: async (expression, variable, options) =>
      make1D(await request("compileHandle1D",
        [expression, variable, options])),
    compile2D: async (expression, xVariable, yVariable, options) =>
      make2D(await request("compileHandle2D",
        [expression, xVariable, yVariable, options])),
    setAngleMode: (mode) => request("setAngleMode", [mode]),
    getAngleMode: () => request("getAngleMode"),
    setVariable: (name, expression) =>
      request("setVariable", [name, expression]),
    removeVariable: (name) => request("removeVariable", [name]),
    clearVariables: () => request("clearVariables"),
    reset: () => request("reset"),
    diagnostics: () => request("diagnostics"),
    cancel: async () => {
      if (shutDown) throw makeError({code: "SHUTDOWN", message: "session has been shut down"});
      worker.terminate();
      rejectAll("TIME_LIMIT", "Worker terminated for cancellation");
      worker = new Worker(workerUrl, { type: "module", name: "numos-math" });
      bind();
      await request("initialize", [manifestAbsolute.href]);
      return { cancelled: true, stateLost: true };
    },
    shutdown: async () => {
      try {
        return await request("shutdown");
      } finally {
        shutDown = true;
        worker.terminate();
        rejectAll("SHUTDOWN", "session has been shut down");
      }
    },
  });
}
