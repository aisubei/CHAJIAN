var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/knowledge/net.ts
import { EnvHttpProxyAgent, setGlobalDispatcher } from "undici";
function applyGlobalProxy() {
  if (proxyApplied) return;
  proxyApplied = true;
  const proxy = process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY;
  if (proxy === void 0 || proxy.trim() === "") return;
  try {
    setGlobalDispatcher(new EnvHttpProxyAgent());
  } catch {
  }
}
async function httpFetch(url, options = {}) {
  const { method, headers, body, timeoutMs = 3e4, retries = 1, redirect, signal } = options;
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fetch(url, {
        method,
        headers,
        body,
        signal: signal !== void 0 ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
        ...redirect !== void 0 ? { redirect } : {}
      });
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`network request failed: ${describeNetworkError(lastError)}`);
}
function describeNetworkError(error) {
  if (!(error instanceof Error)) return String(error);
  const timedOut = error.name === "TimeoutError" || error.name === "AbortError";
  const cause = error.cause;
  if (cause !== void 0) {
    const causeText = cause instanceof Error ? cause.message : String(cause);
    return timedOut ? `timeout (${causeText})` : `${error.message} (${causeText})`;
  }
  return timedOut ? "timeout" : error.message;
}
var proxyApplied;
var init_net = __esm({
  "src/knowledge/net.ts"() {
    "use strict";
    proxyApplied = false;
  }
});

// src/knowledge/embed.ts
import { rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve as resolve2 } from "node:path";
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
function setLocalModelCacheDir(dir) {
  cacheDirOverride = dir !== void 0 && dir.trim() !== "" ? resolve2(expandHomePath(dir.trim())) : void 0;
}
function setHfEndpoint(url) {
  hfEndpointOverride = url !== void 0 && url.trim() !== "" ? url.trim().replace(/\/+$/, "") : void 0;
}
function expandHomePath(input) {
  if (input === "~") return homedir();
  if (input.startsWith("~/") || input.startsWith("~\\")) return join(homedir(), input.slice(2));
  return input;
}
function localModelCacheDir() {
  if (cacheDirOverride !== void 0) return cacheDirOverride;
  const envHome = typeof process !== "undefined" ? process.env.DSH_HOME : void 0;
  const home = envHome !== void 0 && envHome.trim() !== "" ? resolve2(expandHomePath(envHome.trim())) : join(homedir(), ".dsh");
  return join(home, "cache", "dsh-knowledge", "local-models");
}
async function embedTexts(provider, baseUrl, model, apiKey, texts, signal) {
  if (texts.length === 0) return [];
  if (provider === "none") throw new Error('embedding provider is "none" \u2014 configure an endpoint or a local model, or keep lexical search');
  if (provider === "local") return embedLocal(model.trim() === "" ? DEFAULT_LOCAL_MODEL : model, texts);
  if (baseUrl.trim() === "") throw new Error("embedding base URL is empty");
  if (model.trim() === "") throw new Error("embedding model is empty");
  if (provider === "openai") return embedOpenAI(baseUrl, model, apiKey, texts, signal);
  if (provider === "ollama") return embedOllama(baseUrl, model, apiKey, texts, signal);
  throw new Error(`unknown embedding provider ${String(provider)}`);
}
function poolingFor(modelId) {
  const id = modelId.toLowerCase();
  if (id.includes("qwen3")) return "last_token";
  if (id.includes("bge") || id.includes("bce")) return "cls";
  if (id.includes("e5")) return "mean";
  if (id.includes("gte")) return "mean";
  return "mean";
}
function getLocalModelStatus(modelId) {
  return localModelStatus.get(modelId) ?? { model: modelId, status: "idle", progress: 0, message: "" };
}
function markLocalModelError(modelId, message) {
  localModelStatus.set(modelId, { model: modelId, status: "error", progress: 0, message });
}
async function isLocalModelDownloaded(modelId) {
  const { readdir: readdir3 } = await import("node:fs/promises");
  try {
    const entries = await readdir3(join(localModelCacheDir(), modelId, "onnx"));
    return entries.some((name) => name.endsWith(".onnx"));
  } catch {
    return false;
  }
}
function localWorkerPath() {
  return fileURLToPath(new URL("./embed-worker.mjs", import.meta.url));
}
function clearIdleTimer() {
  if (localWorkerIdleTimer !== null) {
    clearTimeout(localWorkerIdleTimer);
    localWorkerIdleTimer = null;
  }
}
function failAllPending(error) {
  for (const { reject } of localPending.values()) reject(error);
  localPending.clear();
}
function ensureLocalWorker() {
  if (localWorker !== null) return localWorker;
  const worker = new Worker(localWorkerPath());
  worker.unref();
  worker.on("message", (message) => {
    if (message.type === "progress" && message.modelId !== void 0) {
      localModelStatus.set(message.modelId, {
        model: message.modelId,
        status: message.status ?? "idle",
        progress: message.progress ?? 0,
        message: message.message ?? ""
      });
      armIdleTimer();
      return;
    }
    if (message.type === "released" && message.modelId !== void 0) {
      const waiters = localReleasedWaiters.get(message.modelId);
      if (waiters !== void 0) {
        localReleasedWaiters.delete(message.modelId);
        for (const resolve4 of waiters) resolve4();
      }
      return;
    }
    if (message.type === "cancelled" && message.modelId !== void 0) {
      const waiters = localCancelledWaiters.get(message.modelId);
      if (waiters !== void 0) {
        localCancelledWaiters.delete(message.modelId);
        for (const resolve4 of waiters) resolve4();
      }
      return;
    }
    if (message.id === void 0) return;
    const pending = localPending.get(message.id);
    if (pending === void 0) return;
    localPending.delete(message.id);
    if (message.ok === true) pending.resolve(message.vectors ?? null);
    else pending.reject(new Error(message.error ?? "local model worker failed"));
  });
  const onWorkerFailure = (error) => {
    if (localWorker !== worker) return;
    failAllPending(error);
    localWorker = null;
    clearIdleTimer();
  };
  worker.on("error", (error) => onWorkerFailure(error instanceof Error ? error : new Error(String(error))));
  worker.on("exit", () => onWorkerFailure(new Error("local model worker exited")));
  localWorker = worker;
  return worker;
}
function armIdleTimer() {
  clearIdleTimer();
  localWorkerIdleTimer = setTimeout(() => {
    localWorkerIdleTimer = null;
    if (localPending.size > 0) {
      armIdleTimer();
      return;
    }
    const worker = localWorker;
    localWorker = null;
    failAllPending(new Error("local model worker released after idle"));
    void worker?.terminate();
  }, LOCAL_WORKER_IDLE_TIMEOUT_MS);
  localWorkerIdleTimer.unref?.();
}
function postToWorker(message) {
  const worker = ensureLocalWorker();
  armIdleTimer();
  worker.postMessage(message);
}
function callWorker(type, payload) {
  return new Promise((resolve4, reject) => {
    const id = ++localRequestSeq;
    const timer = setTimeout(() => {
      localPending.delete(id);
      reject(new Error("local model worker request timed out"));
    }, LOCAL_WORKER_REQUEST_TIMEOUT_MS);
    timer.unref?.();
    localPending.set(id, {
      resolve: (value) => {
        clearTimeout(timer);
        resolve4(value);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      }
    });
    postToWorker({
      id,
      type,
      modelId: payload.modelId,
      cacheDir: localModelCacheDir(),
      hfEndpoint: hfEndpointOverride ?? (typeof process !== "undefined" && process.env.HF_ENDPOINT !== void 0 ? process.env.HF_ENDPOINT : void 0),
      texts: payload.texts,
      query: payload.query,
      pooling: payload.pooling,
      task: payload.task
    });
  });
}
async function embedLocal(modelId, texts) {
  const vectors = await callWorker("embed", { modelId, texts: [...texts], pooling: poolingFor(modelId) });
  return vectors;
}
async function rerankLocal(modelId, query, texts) {
  const scores = await callWorker("rerank", { modelId, query, texts: [...texts], task: "reranking" });
  return scores;
}
async function loadLocalModel(modelId, task = "feature-extraction") {
  await callWorker("load", { modelId, task });
}
async function cancelLocalModel(modelId) {
  postToWorker({ type: "cancel", modelId });
  localModelStatus.set(modelId, { model: modelId, status: "idle", progress: 0, message: "" });
  await waitForCancelAck(modelId);
  await rm(join(localModelCacheDir(), modelId), { recursive: true, force: true }).catch(() => {
  });
}
function waitForCancelAck(modelId) {
  return new Promise((resolve4) => {
    const done = () => resolve4();
    const waiters = localCancelledWaiters.get(modelId) ?? [];
    waiters.push(done);
    localCancelledWaiters.set(modelId, waiters);
    const timer = setTimeout(() => {
      const current = localCancelledWaiters.get(modelId) ?? [];
      const index = current.indexOf(done);
      if (index >= 0) {
        current.splice(index, 1);
        if (current.length === 0) localCancelledWaiters.delete(modelId);
      }
      resolve4();
    }, LOCAL_CANCEL_ACK_TIMEOUT_MS);
    timer.unref?.();
  });
}
async function removeLocalModel(modelId) {
  if (localModelStatus.get(modelId)?.status === "downloading") {
    throw new Error("\u6A21\u578B\u6B63\u5728\u4E0B\u8F7D\uFF0C\u5B8C\u6210\u540E\u624D\u80FD\u5220\u9664");
  }
  postToWorker({ type: "release", modelId });
  await new Promise((resolve4) => {
    const done = () => resolve4();
    const waiters = localReleasedWaiters.get(modelId) ?? [];
    waiters.push(done);
    localReleasedWaiters.set(modelId, waiters);
    const timer = setTimeout(() => {
      const current = localReleasedWaiters.get(modelId) ?? [];
      const index = current.indexOf(done);
      if (index >= 0) {
        current.splice(index, 1);
        if (current.length === 0) localReleasedWaiters.delete(modelId);
      }
      resolve4();
    }, LOCAL_RELEASE_ACK_TIMEOUT_MS);
    timer.unref?.();
  });
  localModelStatus.delete(modelId);
  await rm(join(localModelCacheDir(), modelId), { recursive: true, force: true });
}
async function disposeLocalModelWorker() {
  clearIdleTimer();
  const worker = localWorker;
  localWorker = null;
  failAllPending(new Error("local model worker disposed"));
  if (worker !== null) {
    try {
      worker.postMessage({ type: "shutdown" });
    } catch {
    }
    await worker.terminate();
  }
}
function hasActiveLocalModelDownload() {
  for (const status of localModelStatus.values()) {
    if (status.status === "downloading") return true;
  }
  return false;
}
async function embedOpenAI(baseUrl, model, apiKey, texts, signal) {
  const url = `${trimBase(baseUrl)}/embeddings`;
  const response = await httpFetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...apiKey ? { authorization: `Bearer ${apiKey}` } : {}
    },
    body: JSON.stringify({ model, input: texts }),
    timeoutMs: 6e4,
    ...signal !== void 0 ? { signal } : {}
  });
  if (!response.ok) {
    throw new Error(`embedding request failed: HTTP ${response.status} ${await response.text()}`);
  }
  const json = await response.json();
  const vectors = (json.data ?? []).map((entry) => entry.embedding);
  if (vectors.length !== texts.length || vectors.some((v) => v === void 0 || v.length === 0)) {
    throw new Error("embedding response did not return one vector per input");
  }
  return vectors.map(normalize);
}
async function embedOllama(baseUrl, model, _apiKey, texts, signal) {
  const base = trimBase(baseUrl);
  const response = await httpFetch(`${base}/api/embed`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, input: texts }),
    timeoutMs: 6e4,
    ...signal !== void 0 ? { signal } : {}
  });
  if (response.ok) {
    const json = await response.json();
    if (json.embeddings?.length === texts.length) return json.embeddings.map(normalize);
  }
  const vectors = [];
  for (const text of texts) {
    const legacy = await httpFetch(`${base}/api/embeddings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, prompt: text }),
      timeoutMs: 6e4,
      ...signal !== void 0 ? { signal } : {}
    });
    if (!legacy.ok) throw new Error(`ollama embedding failed: HTTP ${legacy.status} ${await legacy.text()}`);
    const json = await legacy.json();
    if (json.embedding === void 0 || json.embedding.length === 0) {
      throw new Error("ollama embedding response missing a vector");
    }
    vectors.push(normalize(json.embedding));
  }
  return vectors;
}
function normalize(vector) {
  let sum = 0;
  for (const value of vector) sum += value * value;
  const length = Math.sqrt(sum);
  if (length === 0) return vector;
  return vector.map((value) => value / length);
}
function trimBase(baseUrl) {
  return baseUrl.replace(/\/+$/, "");
}
var DEFAULT_LOCAL_MODEL, cacheDirOverride, hfEndpointOverride, localModelStatus, LOCAL_WORKER_IDLE_TIMEOUT_MS, LOCAL_WORKER_REQUEST_TIMEOUT_MS, LOCAL_RELEASE_ACK_TIMEOUT_MS, LOCAL_CANCEL_ACK_TIMEOUT_MS, localWorker, localWorkerIdleTimer, localRequestSeq, localPending, localReleasedWaiters, localCancelledWaiters;
var init_embed = __esm({
  "src/knowledge/embed.ts"() {
    "use strict";
    init_net();
    applyGlobalProxy();
    DEFAULT_LOCAL_MODEL = "onnx-community/Qwen3-Embedding-0.6B-ONNX";
    localModelStatus = /* @__PURE__ */ new Map();
    LOCAL_WORKER_IDLE_TIMEOUT_MS = 6e4;
    LOCAL_WORKER_REQUEST_TIMEOUT_MS = 30 * 6e4;
    LOCAL_RELEASE_ACK_TIMEOUT_MS = 3e3;
    LOCAL_CANCEL_ACK_TIMEOUT_MS = 3e3;
    localWorker = null;
    localWorkerIdleTimer = null;
    localRequestSeq = 0;
    localPending = /* @__PURE__ */ new Map();
    localReleasedWaiters = /* @__PURE__ */ new Map();
    localCancelledWaiters = /* @__PURE__ */ new Map();
  }
});

// src/knowledge/ocr.ts
var ocr_exports = {};
__export(ocr_exports, {
  DEFAULT_OCR_MIRROR: () => DEFAULT_OCR_MIRROR,
  buildOcrUrl: () => buildOcrUrl,
  disposeOcrWorker: () => disposeOcrWorker,
  downloadOcrModels: () => downloadOcrModels,
  extractPdfImages: () => extractPdfImages,
  getOcrModelStatus: () => getOcrModelStatus,
  isOcrReady: () => isOcrReady,
  listOcrLanguages: () => listOcrLanguages,
  normalizeRgba: () => normalizeRgba,
  ocrPdfText: () => ocrPdfText,
  parseCharacterDict: () => parseCharacterDict,
  postprocessOcrText: () => postprocessOcrText,
  prepareForOcr: () => prepareForOcr,
  removeOcrModels: () => removeOcrModels,
  renderPdfPages: () => renderPdfPages,
  rgbaToPng: () => rgbaToPng
});
import { deflateSync } from "node:zlib";
import { mkdir, readdir, rename, rm as rm2, writeFile } from "node:fs/promises";
import { dirname, join as join2 } from "node:path";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { Worker as Worker2 } from "node:worker_threads";
import { fileURLToPath as fileURLToPath2 } from "node:url";
function buildOcrUrl(mirror, repoPath) {
  const base = (mirror === void 0 || mirror.trim() === "" ? DEFAULT_OCR_MIRROR : mirror).trim().replace(/\/+$/, "");
  return `${base}${repoPath}`;
}
function ocrCacheDir() {
  return join2(localModelCacheDir(), "ocr");
}
function ppocrPath(fileName) {
  return join2(ocrCacheDir(), fileName);
}
function parseCharacterDict(yml) {
  const lines = yml.split("\n");
  const idx = lines.findIndex((line) => line.trim() === "character_dict:");
  if (idx < 0) return [];
  const chars = [];
  for (let i = idx + 1; i < lines.length; i += 1) {
    const stripped = lines[i].replace(/^\s+/, "");
    if (!stripped.startsWith("- ")) break;
    let value = stripped.slice(2);
    if (value.length >= 2) {
      if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
      else if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    }
    chars.push(value);
  }
  return chars;
}
function getOcrModelStatus() {
  return ocrStatus;
}
function isOcrReady() {
  return PPOCR_FILES.every((file) => existsSync(ppocrPath(file.fileName)));
}
function setOcrStatus(status) {
  ocrStatus = status;
}
async function downloadOcrModels(mirror) {
  if (ocrDownloadInFlight !== null) return ocrDownloadInFlight;
  const run = (async () => {
    await mkdir(ocrCacheDir(), { recursive: true });
    const missing = PPOCR_FILES.filter((file) => !existsSync(ppocrPath(file.fileName)));
    if (missing.length === 0) {
      setOcrStatus({ status: "ready", progress: 100, message: "" });
      return getOcrModelStatus();
    }
    setOcrStatus({ status: "downloading", progress: 0, message: "" });
    let done = 0;
    try {
      for (const file of missing) {
        await downloadModelFile(file, buildOcrUrl(mirror, file.repoPath), (fraction) => {
          setOcrStatus({
            status: "downloading",
            progress: Math.round((done + fraction) / PPOCR_FILES.length * 100),
            message: ""
          });
        });
        done += 1;
      }
      setOcrStatus({ status: "ready", progress: 100, message: "" });
    } catch (error) {
      setOcrStatus({
        status: "error",
        progress: Math.round(done / PPOCR_FILES.length * 100),
        message: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
    return getOcrModelStatus();
  })();
  ocrDownloadInFlight = run.finally(() => {
    ocrDownloadInFlight = null;
  });
  return ocrDownloadInFlight;
}
async function removeOcrModels() {
  await disposeOcrWorker();
  setOcrStatus({ status: "idle", progress: 0, message: "" });
  await rm2(ocrCacheDir(), { recursive: true, force: true });
}
async function downloadModelFile(file, url, onProgress) {
  const response = await httpFetch(url, { timeoutMs: 24e4 });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length < file.minBytes) {
    throw new Error(`${url} too small (${bytes.length} bytes) \u2014 mirror error page?`);
  }
  const dest = ppocrPath(file.fileName);
  if (file.fileName.endsWith(".txt")) {
    const chars = parseCharacterDict(new TextDecoder("utf-8").decode(bytes));
    if (chars.length < 1e3 || !chars.some((ch) => /[\u4e00-\u9fff]/.test(ch))) {
      throw new Error(`character_dict in inference.yml looks incomplete (${chars.length} entries, no CJK)`);
    }
    await writeFile(`${dest}.tmp`, `
${chars.join("\n")}
`);
  } else {
    await writeFile(`${dest}.tmp`, Buffer.from(bytes));
  }
  await rename(`${dest}.tmp`, dest);
  onProgress(1);
}
function ocrWorkerPath() {
  return fileURLToPath2(new URL("./ocr-worker.mjs", import.meta.url));
}
async function loadMupdf() {
  if (mupdfModule !== void 0) return mupdfModule;
  try {
    mupdfModule = await import("mupdf");
  } catch {
    mupdfModule = null;
  }
  return mupdfModule;
}
async function renderPdfPages(bytes, maxPages) {
  const mupdf = await loadMupdf();
  if (mupdf === null) return null;
  let document = null;
  try {
    document = mupdf.Document.openDocument(Uint8Array.from(bytes), "application/pdf");
    const out = [];
    const pageCount = Math.min(document.countPages(), maxPages);
    for (let index = 0; index < pageCount; index += 1) {
      let page = null;
      try {
        page = document.loadPage(index);
        const pixmap = page.toPixmap(mupdf.Matrix.scale(3, 3), mupdf.ColorSpace.DeviceRGB, false);
        const png = Buffer.from(pixmap.asPNG());
        if (png.length > 0) out.push({ page: index + 1, png });
      } catch (error) {
        console.warn(`[dsh-knowledge] page ${index + 1} render failed, skipping: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        page?.destroy();
      }
    }
    return out;
  } catch (error) {
    console.warn(`[dsh-knowledge] mupdf render failed, falling back to embedded rasters: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  } finally {
    document?.destroy();
  }
}
function failAllOcrPending(error) {
  for (const { reject } of ocrPending.values()) reject(error);
  ocrPending.clear();
}
function ensureOcrWorker() {
  if (ocrWorker !== null) return ocrWorker;
  const worker = new Worker2(ocrWorkerPath());
  worker.unref();
  worker.on("message", (message) => {
    if (message.id === void 0) return;
    const pending = ocrPending.get(message.id);
    if (pending === void 0) return;
    ocrPending.delete(message.id);
    if (message.ok === true) pending.resolve(message.text ?? "");
    else pending.reject(new Error(message.error ?? "OCR worker failed"));
  });
  const onFailure = (error) => {
    if (ocrWorker !== worker) return;
    failAllOcrPending(error);
    ocrWorker = null;
  };
  worker.on("error", (error) => onFailure(error instanceof Error ? error : new Error(String(error))));
  worker.on("exit", () => onFailure(new Error("OCR worker exited")));
  ocrWorker = worker;
  return worker;
}
function recognizePng(png) {
  return new Promise((resolve4, reject) => {
    const id = ++ocrRequestSeq;
    const timer = setTimeout(() => {
      ocrPending.delete(id);
      ocrTimeoutStreak += 1;
      if (ocrTimeoutStreak >= OCR_HUNG_TIMEOUT_THRESHOLD) {
        ocrTimeoutStreak = 0;
        const worker = ocrWorker;
        ocrWorker = null;
        failAllOcrPending(new Error("OCR worker respawned after request timeouts"));
        void worker?.terminate();
      }
      reject(new Error("OCR request timed out"));
    }, OCR_WORKER_REQUEST_TIMEOUT_MS);
    timer.unref?.();
    ocrPending.set(id, {
      resolve: (text) => {
        clearTimeout(timer);
        ocrTimeoutStreak = 0;
        resolve4(text);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      }
    });
    try {
      ensureOcrWorker().postMessage({ id, type: "ocr", png, modelDir: ocrCacheDir() });
    } catch (error) {
      clearTimeout(timer);
      ocrPending.delete(id);
      ocrWorker = null;
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
async function disposeOcrWorker() {
  const worker = ocrWorker;
  ocrWorker = null;
  failAllOcrPending(new Error("OCR worker disposed"));
  if (worker !== null) {
    try {
      worker.postMessage({ type: "shutdown" });
    } catch {
    }
    await worker.terminate();
  }
}
async function extractPdfImages(bytes) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({
    // pdfjs 6 rejects Buffer-typed input — always hand it a plain Uint8Array.
    data: Uint8Array.from(bytes),
    disableWorker: true,
    isEvalSupported: false,
    useSystemFonts: true,
    // Fake-worker mode cannot derive the image-decoder wasm path by itself on
    // some hosts — point it at pdfjs-dist/wasm explicitly (trailing slash).
    ...pdfjsWasmUrl !== void 0 ? { wasmUrl: pdfjsWasmUrl } : {},
    // CID-font cmaps for CJK PDFs (SimSun etc.) — see pdfjsCMapUrl above.
    ...pdfjsCMapUrl !== void 0 ? { cMapUrl: pdfjsCMapUrl, cMapPacked: true } : {}
  });
  try {
    const doc = await loadingTask.promise;
    const out = [];
    const pageCount = Math.min(doc.numPages, MAX_OCR_PAGES);
    let totalRasterBytes = 0;
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      const ops = await page.getOperatorList();
      for (let i = 0; i < ops.fnArray.length && out.length < MAX_OCR_IMAGES; i += 1) {
        if (ops.fnArray[i] !== pdfjs.OPS.paintImageXObject) continue;
        const name = ops.argsArray[i][0];
        const image = await waitForImage(page, name, 5e3);
        if (image === null || image.width <= 0 || image.height <= 0 || !image.data) continue;
        const pixels = image.width * image.height;
        if (pixels > MAX_IMAGE_PIXELS) continue;
        const bytes2 = pixels * 4;
        if (totalRasterBytes + bytes2 > MAX_TOTAL_RASTER_BYTES) continue;
        totalRasterBytes += bytes2;
        out.push({ width: image.width, height: image.height, data: normalizeRgba(image), page: pageNumber });
      }
    }
    return out;
  } finally {
    await loadingTask.destroy().catch(() => {
    });
  }
}
async function waitForImage(page, name, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (page.objs.has(name)) {
      const resolved = page.objs.get(name);
      if (resolved !== null) return resolved;
    }
    await new Promise((resolve4) => setTimeout(resolve4, 20));
  }
  return null;
}
function normalizeRgba(image) {
  const { width, height, data } = image;
  const expected = width * height;
  if (expected <= 0 || expected > MAX_IMAGE_PIXELS || expected * 4 > 4294967295) {
    throw new Error(`image dimensions out of range: ${width}\xD7${height}`);
  }
  if (data.length >= expected * 4) {
    const rgba2 = new Uint8ClampedArray(expected * 4);
    rgba2.set(data.subarray(0, expected * 4));
    for (let i = 3; i < rgba2.length; i += 4) rgba2[i] = 255;
    return rgba2;
  }
  if (data.length >= expected * 3) {
    const rgba2 = new Uint8ClampedArray(expected * 4);
    for (let i = 0; i < expected; i += 1) {
      rgba2[i * 4] = data[i * 3];
      rgba2[i * 4 + 1] = data[i * 3 + 1];
      rgba2[i * 4 + 2] = data[i * 3 + 2];
      rgba2[i * 4 + 3] = 255;
    }
    return rgba2;
  }
  if (data.length >= expected) {
    const rgba2 = new Uint8ClampedArray(expected * 4);
    for (let i = 0; i < expected; i += 1) {
      const v = data[i] ?? 0;
      rgba2[i * 4] = v;
      rgba2[i * 4 + 1] = v;
      rgba2[i * 4 + 2] = v;
      rgba2[i * 4 + 3] = 255;
    }
    return rgba2;
  }
  const rgba = new Uint8ClampedArray(expected * 4);
  for (let i = 0; i < expected; i += 1) {
    const bit = data[i >> 3] >> 7 - (i & 7) & 1;
    const v = bit === 1 ? 255 : 0;
    rgba[i * 4] = v;
    rgba[i * 4 + 1] = v;
    rgba[i * 4 + 2] = v;
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}
function rgbaToPng(width, height, rgba) {
  const rowBytes = 1 + width * 4;
  const raw = Buffer.alloc(height * rowBytes);
  for (let y = 0; y < height; y += 1) {
    raw[y * rowBytes] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * rowBytes + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function crc32(buffer) {
  crcTable ??= (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();
  let crc = 4294967295;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 255] ^ crc >>> 8;
  return (crc ^ 4294967295) >>> 0;
}
async function ocrPdfText(bytes) {
  if (!isOcrReady()) return "";
  try {
    const pageTexts = /* @__PURE__ */ new Map();
    const rendered = await renderPdfPages(bytes, MAX_OCR_PAGES);
    const recognize = async (page, png) => {
      try {
        const text = postprocessOcrText(await recognizePng(png));
        if (text.length > 0) {
          const bucket = pageTexts.get(page) ?? [];
          bucket.push(text);
          pageTexts.set(page, bucket);
        }
      } catch (error) {
        console.warn(`[dsh-knowledge] OCR failed for page ${page}: ${error instanceof Error ? error.message : String(error)}`);
      }
    };
    if (rendered !== null) {
      for (const { page, png } of rendered) await recognize(page, png);
    } else {
      const images = await extractPdfImages(bytes);
      for (const image of images) {
        const { width, height, data } = prepareForOcr(image.width, image.height, image.data);
        const png = rgbaToPng(width, height, data);
        await recognize(image.page, png);
      }
    }
    return [...pageTexts.entries()].sort((a, b) => a[0] - b[0]).map(([, texts]) => texts.join("\n")).join("\n\n");
  } catch (error) {
    console.warn(`[dsh-knowledge] OCR failed for scanned PDF: ${error instanceof Error ? error.message : String(error)}`);
    return "";
  }
}
function upscale2x(width, height, rgba) {
  const out = new Uint8ClampedArray(width * height * 4 * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const src = (y * width + x) * 4;
      const r = rgba[src], g = rgba[src + 1], b = rgba[src + 2], a = rgba[src + 3];
      for (let dy = 0; dy < 2; dy += 1) {
        for (let dx = 0; dx < 2; dx += 1) {
          const dst = ((y * 2 + dy) * width * 2 + (x * 2 + dx)) * 4;
          out[dst] = r;
          out[dst + 1] = g;
          out[dst + 2] = b;
          out[dst + 3] = a;
        }
      }
    }
  }
  return { width: width * 2, height: height * 2, data: out };
}
function prepareForOcr(width, height, rgba) {
  let w = width, h = height, data = rgba;
  if (w < 1200 && h < 800) {
    const up = upscale2x(w, h, data);
    w = up.width;
    h = up.height;
    data = up.data;
  }
  const gray = new Uint8ClampedArray(w * h);
  for (let i = 0; i < w * h; i += 1) {
    gray[i] = Math.round(0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]);
  }
  let min = 255, max = 0;
  for (let i = 0; i < gray.length; i += 1) {
    if (gray[i] < min) min = gray[i];
    if (gray[i] > max) max = gray[i];
  }
  const range = max - min;
  const stretched = new Uint8ClampedArray(w * h);
  if (range > 0) {
    for (let i = 0; i < gray.length; i += 1) {
      stretched[i] = Math.round((gray[i] - min) / range * 255);
    }
  } else {
    stretched.set(gray);
  }
  const sharpened = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let sum = 0;
      for (let ky = -1; ky <= 1; ky += 1) {
        for (let kx = -1; kx <= 1; kx += 1) {
          const px = Math.min(w - 1, Math.max(0, x + kx));
          const py = Math.min(h - 1, Math.max(0, y + ky));
          sum += stretched[py * w + px] * SHARPEN_KERNEL[(ky + 1) * 3 + (kx + 1)];
        }
      }
      sharpened[y * w + x] = Math.min(255, Math.max(0, sum));
    }
  }
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i += 1) {
    const v = sharpened[i];
    out[i * 4] = v;
    out[i * 4 + 1] = v;
    out[i * 4 + 2] = v;
    out[i * 4 + 3] = 255;
  }
  return { width: w, height: h, data: out };
}
function postprocessOcrText(text) {
  return text.replace(/([\u4e00-\u9fff\u3400-\u4dbf])[ \t\u3000\u00a0]+(?=[\u4e00-\u9fff\u3400-\u4dbf])/g, "$1");
}
async function listOcrLanguages() {
  let files = [];
  try {
    files = await readdir(ocrCacheDir());
  } catch {
  }
  const onDisk = new Set(files);
  return PPOCR_FILES.map((file) => ({ lang: file.fileName, ready: onDisk.has(file.fileName) }));
}
var MAX_OCR_PAGES, MAX_OCR_IMAGES, MAX_IMAGE_PIXELS, MAX_TOTAL_RASTER_BYTES, DEFAULT_OCR_MIRROR, PPOCR_FILES, ocrStatus, ocrDownloadInFlight, OCR_WORKER_REQUEST_TIMEOUT_MS, ocrWorker, ocrRequestSeq, ocrPending, pdfjsWasmUrl, pdfjsCMapUrl, mupdfModule, OCR_HUNG_TIMEOUT_THRESHOLD, ocrTimeoutStreak, crcTable, SHARPEN_KERNEL;
var init_ocr = __esm({
  "src/knowledge/ocr.ts"() {
    "use strict";
    init_net();
    init_embed();
    MAX_OCR_PAGES = 100;
    MAX_OCR_IMAGES = 200;
    MAX_IMAGE_PIXELS = 32e6;
    MAX_TOTAL_RASTER_BYTES = 512 * 1024 * 1024;
    DEFAULT_OCR_MIRROR = "https://hf-mirror.com";
    PPOCR_FILES = [
      {
        repoPath: "/PaddlePaddle/PP-OCRv5_mobile_det_onnx/resolve/main/inference.onnx",
        fileName: "ppocrv5_det.onnx",
        minBytes: 1e6
      },
      {
        repoPath: "/PaddlePaddle/PP-OCRv5_mobile_rec_onnx/resolve/main/inference.onnx",
        fileName: "ppocrv5_rec.onnx",
        minBytes: 1e6
      },
      {
        repoPath: "/PaddlePaddle/PP-OCRv5_mobile_rec_onnx/resolve/main/inference.yml",
        fileName: "ppocrv5_dict.txt",
        minBytes: 1e4
      }
    ];
    ocrStatus = { status: "idle", progress: 0, message: "" };
    ocrDownloadInFlight = null;
    OCR_WORKER_REQUEST_TIMEOUT_MS = 5 * 6e4;
    ocrWorker = null;
    ocrRequestSeq = 0;
    ocrPending = /* @__PURE__ */ new Map();
    pdfjsWasmUrl = (() => {
      try {
        const require2 = createRequire(import.meta.url);
        const pkg = require2.resolve("pdfjs-dist/package.json");
        return `${dirname(pkg).replace(/\\/g, "/")}/wasm/`;
      } catch {
        return void 0;
      }
    })();
    pdfjsCMapUrl = (() => {
      try {
        const require2 = createRequire(import.meta.url);
        const pkg = require2.resolve("pdfjs-dist/package.json");
        return `${dirname(pkg).replace(/\\/g, "/")}/cmaps/`;
      } catch {
        return void 0;
      }
    })();
    OCR_HUNG_TIMEOUT_THRESHOLD = 2;
    ocrTimeoutStreak = 0;
    crcTable = null;
    SHARPEN_KERNEL = [
      0,
      -0.4,
      0,
      -0.4,
      2.6,
      -0.4,
      0,
      -0.4,
      0
    ];
  }
});

// src/knowledge/mineru.ts
var mineru_exports = {};
__export(mineru_exports, {
  extractPdfWithMineru: () => extractPdfWithMineru
});
import JSZip from "jszip";
async function apiJson(url, settings, init) {
  const response = await httpFetch(url, {
    method: init?.method ?? "GET",
    headers: {
      authorization: `Bearer ${settings.apiKey}`,
      accept: "*/*",
      ...init?.body !== void 0 ? { "content-type": "application/json" } : {}
    },
    body: init?.body,
    timeoutMs: 6e4,
    ...init?.signal !== void 0 ? { signal: init.signal } : {}
  });
  if (!response.ok) {
    throw new Error(`mineru request failed: HTTP ${response.status} ${(await response.text()).slice(0, 200)}`);
  }
  return await response.json();
}
async function extractPdfWithMineru(bytes, fileName, settings, signal) {
  const host = settings.apiHost.trim() === "" ? "https://mineru.net" : settings.apiHost.trim().replace(/\/+$/, "");
  const batch = await apiJson(`${host}/api/v4/file-urls/batch`, settings, {
    method: "POST",
    body: JSON.stringify({
      files: [{ name: fileName, data_id: "dsh-knowledge" }]
    }),
    ...signal !== void 0 ? { signal } : {}
  });
  if (batch.code !== 0 || batch.data.batch_id === "") {
    throw new Error(`mineru batch create failed: ${batch.msg ?? "empty batch_id"}`);
  }
  const uploadUrl = batch.data.file_urls[0];
  if (!uploadUrl) throw new Error("mineru batch create returned no upload URL");
  const upload = await httpFetch(uploadUrl, {
    method: "PUT",
    headers: batch.data.headers?.[0],
    body: bytes,
    timeoutMs: 12e4,
    ...signal !== void 0 ? { signal } : {}
  });
  if (!upload.ok) throw new Error(`mineru upload failed: HTTP ${upload.status}`);
  const deadline = Date.now() + EXTRACT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (signal?.aborted === true) throw new Error("mineru extraction aborted (document was deleted)");
    await new Promise((resolve4) => setTimeout(resolve4, POLL_INTERVAL_MS));
    const result = await apiJson(
      `${host}/api/v4/extract-results/batch/${batch.data.batch_id}`,
      settings,
      signal !== void 0 ? { signal } : void 0
    );
    if (result.code !== 0) throw new Error(`mineru poll failed: ${result.msg ?? "non-zero code"}`);
    const fileResult = result.data.extract_result?.[0];
    if (fileResult === void 0) continue;
    if (fileResult.state === "failed") {
      throw new Error(`mineru extract failed: ${fileResult.err_msg ?? "unknown error"}`);
    }
    if (fileResult.state === "done") {
      if (!fileResult.full_zip_url) throw new Error("mineru extract done without a result zip");
      const zipResponse = await httpFetch(fileResult.full_zip_url, {
        timeoutMs: 12e4,
        ...signal !== void 0 ? { signal } : {}
      });
      if (!zipResponse.ok) throw new Error(`mineru result download failed: HTTP ${zipResponse.status}`);
      const zip = await JSZip.loadAsync(new Uint8Array(await zipResponse.arrayBuffer()));
      const markdownEntry = Object.values(zip.files).find(
        (entry) => !entry.dir && /\.md$/i.test(entry.name) && !entry.name.includes("__assets__")
      );
      if (markdownEntry === void 0) throw new Error("mineru result zip contains no markdown");
      const markdown = await markdownEntry.async("string");
      if (markdown.trim().length === 0) throw new Error("mineru returned empty markdown");
      return markdown;
    }
  }
  throw new Error("mineru extract timed out");
}
var POLL_INTERVAL_MS, EXTRACT_TIMEOUT_MS;
var init_mineru = __esm({
  "src/knowledge/mineru.ts"() {
    "use strict";
    init_net();
    POLL_INTERVAL_MS = 5e3;
    EXTRACT_TIMEOUT_MS = 30 * 6e4;
  }
});

// src/knowledge/caption.ts
var caption_exports = {};
__export(caption_exports, {
  captionPdfImages: () => captionPdfImages
});
async function captionPdfImages(bytes, config) {
  if (config.provider === "off") return "";
  const model = config.model.trim();
  if (model === "") return "";
  let images = [];
  try {
    const extracted = await extractPdfImages(bytes);
    images = extracted.filter((image) => image.width >= MIN_CAPTION_EDGE && image.height >= MIN_CAPTION_EDGE && image.width * image.height <= MAX_CAPTION_PIXELS).slice(0, MAX_CAPTION_IMAGES).map((image) => {
      const { width, height, data } = image;
      const png = rgbaToPng(width, height, data);
      return { page: image.page, png };
    });
  } catch (error) {
    console.warn(`[dsh-knowledge] caption image extraction failed: ${error instanceof Error ? error.message : String(error)}`);
    return "";
  }
  if (images.length === 0) return "";
  const descriptions = [];
  let failures = 0;
  let firstError = "";
  for (const { page, png } of images) {
    try {
      const text = await captionImage(png, config);
      if (text.trim().length > 0) descriptions.push(`\uFF08\u7B2C ${page} \u9875\u56FE\u8868\u63CF\u8FF0\uFF09${text.trim()}`);
    } catch (error) {
      failures += 1;
      if (firstError === "") firstError = error instanceof Error ? error.message : String(error);
    }
  }
  if (failures > 0) {
    console.warn(`[dsh-knowledge] captioning failed for ${failures}/${images.length} image(s): ${firstError}`);
  }
  if (descriptions.length === 0) return "";
  return `

[\u6587\u6863\u56FE\u8868\u63CF\u8FF0]
${descriptions.join("\n")}`;
}
async function captionImage(png, config) {
  if (config.provider === "ollama") return captionViaOllama(png, config);
  return captionViaOpenAI(png, config);
}
async function captionViaOpenAI(png, config) {
  const baseUrl = config.baseUrl.trim() === "" ? config.embeddingBaseUrl : config.baseUrl.trim();
  if (baseUrl === "") throw new Error("captioning base URL is empty (set it or the embedding base URL)");
  const base64 = png.toString("base64");
  const response = await httpFetch(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...config.apiKey !== "" ? { authorization: `Bearer ${config.apiKey}` } : {}
    },
    body: JSON.stringify({
      model: config.model.trim(),
      messages: [{
        role: "user",
        content: [
          { type: "text", text: CAPTION_PROMPT },
          { type: "image_url", image_url: { url: `data:image/png;base64,${base64}` } }
        ]
      }]
    }),
    timeoutMs: 12e4
  });
  if (!response.ok) throw new Error(`caption request failed: HTTP ${response.status} ${(await response.text()).slice(0, 200)}`);
  const json = await response.json();
  const content = json.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("caption response missing content");
  return content;
}
async function captionViaOllama(png, config) {
  const baseUrl = config.baseUrl.trim() === "" ? "http://127.0.0.1:11434" : config.baseUrl.trim().replace(/\/+$/, "");
  const base64 = png.toString("base64");
  const response = await httpFetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: config.model.trim(),
      messages: [{ role: "user", content: CAPTION_PROMPT, images: [base64] }],
      stream: false
    }),
    timeoutMs: 18e4
  });
  if (!response.ok) throw new Error(`ollama caption failed: HTTP ${response.status} ${(await response.text()).slice(0, 200)}`);
  const json = await response.json();
  const content = json.message?.content;
  if (typeof content !== "string") throw new Error("ollama caption response missing content");
  return content;
}
var MAX_CAPTION_IMAGES, MIN_CAPTION_EDGE, MAX_CAPTION_PIXELS, CAPTION_PROMPT;
var init_caption = __esm({
  "src/knowledge/caption.ts"() {
    "use strict";
    init_net();
    init_ocr();
    MAX_CAPTION_IMAGES = 20;
    MIN_CAPTION_EDGE = 160;
    MAX_CAPTION_PIXELS = 4e6;
    CAPTION_PROMPT = "\u8BF7\u7528\u7B80\u6D01\u7684\u4E2D\u6587\u63CF\u8FF0\u8FD9\u5F20\u56FE\u7247/\u56FE\u8868\u7684\u5185\u5BB9\uFF1A\u8BF4\u660E\u5B83\u5C55\u793A\u7684\u4E3B\u9898\u3001\u6570\u636E\u8D8B\u52BF\u6216\u5173\u952E\u7ED3\u8BBA\u3002\u82E5\u4FE1\u606F\u4E0D\u8DB3\u8BF7\u76F4\u63A5\u8BF4\u65E0\u6CD5\u5224\u65AD\u3002";
  }
});

// src/knowledge/index.ts
import { Service } from "@deepseek-ai/cordis";
import { createHash as createHash2 } from "node:crypto";
import { cp, mkdir as mkdir3, readdir as readdir2, readFile as readFile3, rename as rename2, rm as rm4, stat } from "node:fs/promises";
import { basename, extname as extname2, isAbsolute, join as join5, relative, resolve as resolve3 } from "node:path";

// src/knowledge/chunk.ts
function normalizeText(text) {
  return text.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
function chunkText(text, size, overlap, options) {
  const normalized = normalizeText(text);
  if (normalized.length === 0) return [];
  const tokenBudget = Number.isFinite(size) ? Math.max(64, Math.trunc(size)) : 64;
  const tokenOverlap = Number.isFinite(overlap) ? Math.min(Math.max(0, Math.trunc(overlap)), tokenBudget - 1) : 0;
  const charsPerToken = normalized.length / Math.max(1, estimateTokens(normalized));
  const safeSize = Math.max(64, Math.round(tokenBudget * charsPerToken));
  const safeOverlap = Math.min(Math.round(tokenOverlap * charsPerToken), safeSize - 1);
  const smartChunk = options?.smartChunk ?? true;
  const blocks = smartChunk ? splitBlocks(normalized) : [{ text: normalized, heading: void 0 }];
  const chunks = [];
  for (const block of blocks) {
    if (!smartChunk) {
      const separator = normalizeSeparator(options?.separator ?? "\n\n");
      const pieces = block.text.split(separator).map((piece) => piece.trim()).filter((piece) => piece.length > 0);
      for (const piece of pieces) {
        chunks.push(...windowOrKeep(piece, safeSize, safeOverlap, block.heading));
      }
      continue;
    }
    chunks.push(...windowOrKeep(block.text, safeSize, safeOverlap, block.heading));
  }
  return chunks.length > 0 ? chunks : [{ text: normalized.slice(0, safeSize) }];
}
function windowOrKeep(blockText, size, overlap, heading) {
  if (blockText.length <= size) return [{ text: blockText, ...heading !== void 0 ? { heading } : {} }];
  return windowBlock(blockText, size, overlap).map((piece) => ({
    text: piece,
    ...heading !== void 0 ? { heading } : {}
  }));
}
function normalizeSeparator(separator) {
  const decoded = separator.replace(/\\n/g, "\n").replace(/\\t/g, "	");
  return decoded.length > 0 ? decoded : "\n\n";
}
function splitSemanticSegments(text, options) {
  const normalized = normalizeText(text);
  if (normalized.length === 0) return [];
  const blocks = splitBlocks(normalized);
  if (options?.separator === void 0 || options.separator === "") return blocks;
  const separator = normalizeSeparator(options.separator);
  const out = [];
  for (const block of blocks) {
    for (const piece of block.text.split(separator).map((piece2) => piece2.trim()).filter((piece2) => piece2.length > 0)) {
      out.push({ text: piece, ...block.heading !== void 0 ? { heading: block.heading } : {} });
    }
  }
  return out;
}
function mergeSemanticSegments(segments, vectors, size, threshold = 0.75) {
  const fullText = segments.map((segment) => segment.text).join("\n");
  const charsPerToken = fullText.length / Math.max(1, estimateTokens(fullText));
  const tokenBudget = Number.isFinite(size) ? Math.max(64, Math.trunc(size)) : 64;
  const safeSize = Math.max(64, Math.round(tokenBudget * charsPerToken));
  const out = [];
  if (segments.length === 0) return out;
  let text = segments[0].text;
  let heading = segments[0].heading;
  let vec = vectors[0];
  let weight = text.length;
  const flush = () => {
    out.push({ text, ...heading !== void 0 ? { heading } : {}, ...vec !== void 0 ? { embedding: vec } : {} });
  };
  for (let i = 1; i < segments.length; i += 1) {
    const segment = segments[i];
    const nextLength = text.length + segment.text.length + 1;
    const vector = vectors[i];
    const similar = vec !== void 0 && vector !== void 0 ? cosineSimilarity(vec, vector) >= threshold : true;
    if (nextLength <= safeSize && similar) {
      text += `
${segment.text}`;
      if (vec !== void 0 && vector !== void 0) {
        const newWeight = weight + segment.text.length;
        vec = normalizeAdd(vec, weight, vector, segment.text.length);
        weight = newWeight;
      }
    } else {
      flush();
      text = segment.text;
      heading = segment.heading;
      vec = vector;
      weight = text.length;
    }
  }
  flush();
  return out;
}
function normalizeAdd(a, aWeight, b, bWeight) {
  const out = new Array(a.length);
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) {
    const v = (a[i] * aWeight + b[i] * bWeight) / (aWeight + bWeight);
    out[i] = v;
    sum += v * v;
  }
  const length = Math.sqrt(sum);
  if (!Number.isFinite(length) || length === 0) return out;
  for (let i = 0; i < out.length; i += 1) out[i] /= length;
  return out;
}
function cosineSimilarity(a, b) {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const av = a[i];
    const bv = b[i];
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  const norm = Math.sqrt(normA) * Math.sqrt(normB);
  if (norm === 0) return 0;
  const cosine = dot / norm;
  return Number.isFinite(cosine) ? Math.max(0, Math.min(1, cosine)) : 0;
}
function refineChunksByTokenLimit(chunks, tokenLimit, estimateTokens3) {
  if (tokenLimit <= 0) return [...chunks];
  const out = [];
  const refine = (piece) => {
    if (estimateTokens3(piece.text) <= tokenLimit || piece.text.length < 40) {
      out.push(piece);
      return;
    }
    const split = splitAtPreferredBoundary(piece.text);
    if (split === null) {
      out.push(piece);
      return;
    }
    const heading = piece.heading !== void 0 ? { heading: piece.heading } : {};
    refine({ text: split[0], ...heading });
    refine({ text: split[1], ...heading });
  };
  for (const chunk of chunks) refine(chunk);
  return out;
}
function splitAtPreferredBoundary(text) {
  const mid = Math.floor(text.length / 2);
  const radius = Math.max(1, Math.floor(text.length * 0.25));
  const lo = Math.max(0, mid - radius);
  const hi = Math.min(text.length, mid + radius);
  const window = text.slice(lo, hi);
  for (const separator of ["\n\n", "\u3002", "\uFF01", "\uFF1F", "\uFF0C", ", ", " "]) {
    const idx = window.lastIndexOf(separator);
    if (idx < 0) continue;
    const cut = lo + idx + separator.length;
    const left = text.slice(0, cut).trim();
    const right = text.slice(cut).trim();
    if (left.length > 0 && right.length > 0) return [left, right];
  }
  return null;
}
function splitBlocks(text) {
  const blocks = [];
  let current = "";
  let fence = "";
  const headings = [];
  const headingPath = () => {
    const present = headings.filter((entry) => entry !== void 0 && entry.trim().length > 0);
    return present.length > 0 ? present.join(" > ") : void 0;
  };
  const flush = () => {
    if (current.trim().length > 0) {
      const path = headingPath();
      blocks.push({ text: current.trim(), ...path !== void 0 ? { heading: path } : {} });
    }
    current = "";
  };
  for (const line of text.split("\n")) {
    if (fence !== "") {
      current += (current.length > 0 ? "\n" : "") + line;
      const closer = new RegExp(`^\\s*${fence[0] === "`" ? "`" : "~"}{${fence.length},}\\s*$`);
      if (closer.test(line)) fence = "";
      continue;
    }
    const fenceStart = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fenceStart !== null) {
      flush();
      fence = fenceStart[1];
      current = line;
      continue;
    }
    const heading = matchHeading(line);
    if (heading !== void 0) {
      flush();
      const level = heading.level;
      headings.length = level;
      headings[level - 1] = heading.title;
      continue;
    }
    if (line.trim().length === 0) {
      flush();
      continue;
    }
    current += (current.length > 0 ? "\n" : "") + line;
  }
  flush();
  return blocks;
}
function matchHeading(line) {
  const match = /^(#{1,6})\s+(.+)$/.exec(line);
  if (match === null) return void 0;
  return { level: match[1].length, title: match[2].trim() };
}
function windowBlock(block, size, overlap) {
  const chunks = [];
  let start = 0;
  while (start < block.length) {
    const end = start + size;
    if (end >= block.length) {
      chunks.push(block.slice(start).trim());
      break;
    }
    const windowStart = Math.max(start + 1, end - Math.max(1, Math.round(size * WINDOW_RATIO)));
    const cut = Math.max(findCut(block, end, windowStart), start + 1);
    chunks.push(block.slice(start, cut).trim());
    const next = Math.max(cut - overlap, start + 1);
    if (next <= start) break;
    start = next;
  }
  return chunks;
}
var BREAK_PATTERNS = [
  { pattern: /\n#{1}(?!#)/g, score: 100 },
  { pattern: /\n#{2}(?!#)/g, score: 90 },
  { pattern: /\n#{3}(?!#)/g, score: 80 },
  { pattern: /\n#{4}(?!#)/g, score: 70 },
  { pattern: /\n#{5}(?!#)/g, score: 60 },
  { pattern: /\n#{6}(?!#)/g, score: 50 },
  { pattern: /\n```/g, score: 80 },
  { pattern: /\n(?:---|\*\*\*|___)\s*\n/g, score: 60 },
  { pattern: /\n\n+/g, score: 20 },
  { pattern: /[。！？]/g, score: 8, after: true },
  { pattern: /\n[-*]\s/g, score: 5 },
  { pattern: /\n\d+\.\s/g, score: 5 },
  { pattern: /\n/g, score: 1 }
];
var WINDOW_RATIO = 0.22;
var DECAY_FACTOR = 0.7;
function findCut(block, end, min) {
  const windowSize = Math.max(1, end - min);
  let bestPos = -1;
  let bestScore = -1;
  const source = block.slice(min, end);
  for (const { pattern: pattern2, score, after } of BREAK_PATTERNS) {
    pattern2.lastIndex = 0;
    for (const match of source.matchAll(pattern2)) {
      const cut = min + match.index + (after === true ? match[0].length : 0);
      const decayed = score * Math.pow(DECAY_FACTOR, (end - cut) / windowSize);
      if (decayed > bestScore) {
        bestScore = decayed;
        bestPos = cut;
      }
    }
  }
  return bestPos > min ? bestPos : end;
}
function estimateTokens(text) {
  const cjk = (text.match(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/g) ?? []).length;
  const latin = text.length - cjk;
  return Math.max(1, Math.ceil(cjk / 1.5 + latin / 4));
}

// dsh/vendor/cosmokit/src/misc.ts
function isNullable(value) {
  return value === null || value === void 0;
}
function isPlainObject(data) {
  return data && typeof data === "object" && !Array.isArray(data);
}
function filterKeys(object, filter) {
  return Object.fromEntries(Object.entries(object).filter(([key, value]) => filter(key, value)));
}
function mapValues(object, transform) {
  return Object.fromEntries(Object.entries(object).map(([key, value]) => [key, transform(value, key)]));
}
function pick(source, keys, forced) {
  if (!keys) return { ...source };
  const result = {};
  for (const key of keys) {
    if (forced || source[key] !== void 0) result[key] = source[key];
  }
  return result;
}

// dsh/vendor/cosmokit/src/types.ts
function is(type, value) {
  if (arguments.length === 1) return (value2) => is(type, value2);
  return type in globalThis && value instanceof globalThis[type] || Object.prototype.toString.call(value).slice(8, -1) === type;
}
function isArrayBufferLike(value) {
  return is("ArrayBuffer", value) || is("SharedArrayBuffer", value);
}
function isArrayBufferSource(value) {
  return isArrayBufferLike(value) || ArrayBuffer.isView(value);
}
var Binary;
((Binary2) => {
  Binary2.is = isArrayBufferLike;
  Binary2.isSource = isArrayBufferSource;
  function fromSource(source) {
    if (ArrayBuffer.isView(source)) {
      return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
    } else {
      return source;
    }
  }
  Binary2.fromSource = fromSource;
  function toBase64(source) {
    source = fromSource(source);
    if (typeof Buffer !== "undefined") {
      return Buffer.from(source).toString("base64");
    }
    let binary = "";
    const bytes = new Uint8Array(source);
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }
  Binary2.toBase64 = toBase64;
  function fromBase64(source) {
    if (typeof Buffer !== "undefined") return fromSource(Buffer.from(source, "base64"));
    return Uint8Array.from(atob(source), (c) => c.charCodeAt(0));
  }
  Binary2.fromBase64 = fromBase64;
  function toHex(source) {
    source = fromSource(source);
    if (typeof Buffer !== "undefined") return Buffer.from(source).toString("hex");
    return Array.from(new Uint8Array(source), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  Binary2.toHex = toHex;
  function fromHex(source) {
    if (typeof Buffer !== "undefined") return fromSource(Buffer.from(source, "hex"));
    const hex = source.length % 2 === 0 ? source : source.slice(0, source.length - 1);
    const buffer = [];
    for (let i = 0; i < hex.length; i += 2) {
      buffer.push(parseInt(`${hex[i]}${hex[i + 1]}`, 16));
    }
    return Uint8Array.from(buffer).buffer;
  }
  Binary2.fromHex = fromHex;
})(Binary || (Binary = {}));
var base64ToArrayBuffer = Binary.fromBase64;
var arrayBufferToBase64 = Binary.toBase64;
var hexToArrayBuffer = Binary.fromHex;
var arrayBufferToHex = Binary.toHex;
function clone(source, refs = /* @__PURE__ */ new Map()) {
  if (!source || typeof source !== "object") return source;
  if (is("Date", source)) return new Date(source.valueOf());
  if (is("RegExp", source)) return new RegExp(source.source, source.flags);
  if (isArrayBufferLike(source)) return source.slice(0);
  if (ArrayBuffer.isView(source)) return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
  const cached = refs.get(source);
  if (cached) return cached;
  if (Array.isArray(source)) {
    const result2 = [];
    refs.set(source, result2);
    source.forEach((value, index) => {
      result2[index] = Reflect.apply(clone, null, [value, refs]);
    });
    return result2;
  }
  const result = Object.create(Object.getPrototypeOf(source));
  refs.set(source, result);
  for (const key of Reflect.ownKeys(source)) {
    const descriptor = { ...Reflect.getOwnPropertyDescriptor(source, key) };
    if ("value" in descriptor) {
      descriptor.value = Reflect.apply(clone, null, [descriptor.value, refs]);
    }
    Reflect.defineProperty(result, key, descriptor);
  }
  return result;
}
function deepEqual(a, b, strict) {
  if (a === b) return true;
  if (!strict && isNullable(a) && isNullable(b)) return true;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return false;
  if (!a || !b) return false;
  function check(test, then) {
    return test(a) ? test(b) ? then(a, b) : false : test(b) ? false : void 0;
  }
  return check(Array.isArray, (a2, b2) => a2.length === b2.length && a2.every((item, index) => deepEqual(item, b2[index]))) ?? check(is("Date"), (a2, b2) => a2.valueOf() === b2.valueOf()) ?? check(is("RegExp"), (a2, b2) => a2.source === b2.source && a2.flags === b2.flags) ?? check(isArrayBufferLike, (a2, b2) => {
    if (a2.byteLength !== b2.byteLength) return false;
    const viewA = new Uint8Array(a2);
    const viewB = new Uint8Array(b2);
    for (let i = 0; i < viewA.length; i++) {
      if (viewA[i] !== viewB[i]) return false;
    }
    return true;
  }) ?? Object.keys({ ...a, ...b }).every((key) => deepEqual(a[key], b[key], strict));
}

// dsh/vendor/cosmokit/src/time.ts
var Time;
((Time2) => {
  Time2.millisecond = 1;
  Time2.second = 1e3;
  Time2.minute = Time2.second * 60;
  Time2.hour = Time2.minute * 60;
  Time2.day = Time2.hour * 24;
  Time2.week = Time2.day * 7;
  let timezoneOffset = (/* @__PURE__ */ new Date()).getTimezoneOffset();
  function setTimezoneOffset(offset) {
    timezoneOffset = offset;
  }
  Time2.setTimezoneOffset = setTimezoneOffset;
  function getTimezoneOffset() {
    return timezoneOffset;
  }
  Time2.getTimezoneOffset = getTimezoneOffset;
  function getDateNumber(date2 = /* @__PURE__ */ new Date(), offset) {
    if (typeof date2 === "number") date2 = new Date(date2);
    if (offset === void 0) offset = timezoneOffset;
    return Math.floor((date2.valueOf() / Time2.minute - offset) / 1440);
  }
  Time2.getDateNumber = getDateNumber;
  function fromDateNumber(value, offset) {
    const date2 = new Date(value * Time2.day);
    if (offset === void 0) offset = timezoneOffset;
    return new Date(+date2 + offset * Time2.minute);
  }
  Time2.fromDateNumber = fromDateNumber;
  const numeric = /\d+(?:\.\d+)?/.source;
  const timeRegExp = new RegExp(`^${[
    "w(?:eek(?:s)?)?",
    "d(?:ay(?:s)?)?",
    "h(?:our(?:s)?)?",
    "m(?:in(?:ute)?(?:s)?)?",
    "s(?:ec(?:ond)?(?:s)?)?"
  ].map((unit) => `(${numeric}${unit})?`).join("")}$`);
  function parseTime(source) {
    const capture = timeRegExp.exec(source);
    if (!capture) return 0;
    return (parseFloat(capture[1]) * Time2.week || 0) + (parseFloat(capture[2]) * Time2.day || 0) + (parseFloat(capture[3]) * Time2.hour || 0) + (parseFloat(capture[4]) * Time2.minute || 0) + (parseFloat(capture[5]) * Time2.second || 0);
  }
  Time2.parseTime = parseTime;
  function parseDate(date2) {
    const parsed = parseTime(date2);
    if (parsed) {
      date2 = Date.now() + parsed;
    } else if (/^\d{1,2}(:\d{1,2}){1,2}$/.test(date2)) {
      date2 = `${(/* @__PURE__ */ new Date()).toLocaleDateString()}-${date2}`;
    } else if (/^\d{1,2}-\d{1,2}-\d{1,2}(:\d{1,2}){1,2}$/.test(date2)) {
      date2 = `${(/* @__PURE__ */ new Date()).getFullYear()}-${date2}`;
    }
    return date2 ? new Date(date2) : /* @__PURE__ */ new Date();
  }
  Time2.parseDate = parseDate;
  function format(ms) {
    const abs = Math.abs(ms);
    if (abs >= Time2.day - Time2.hour / 2) {
      return Math.round(ms / Time2.day) + "d";
    } else if (abs >= Time2.hour - Time2.minute / 2) {
      return Math.round(ms / Time2.hour) + "h";
    } else if (abs >= Time2.minute - Time2.second / 2) {
      return Math.round(ms / Time2.minute) + "m";
    } else if (abs >= Time2.second) {
      return Math.round(ms / Time2.second) + "s";
    }
    return ms + "ms";
  }
  Time2.format = format;
  function toDigits(source, length = 2) {
    return source.toString().padStart(length, "0");
  }
  Time2.toDigits = toDigits;
  function template(template2, time = /* @__PURE__ */ new Date()) {
    return template2.replace("yyyy", time.getFullYear().toString()).replace("yy", time.getFullYear().toString().slice(2)).replace("MM", toDigits(time.getMonth() + 1)).replace("dd", toDigits(time.getDate())).replace("hh", toDigits(time.getHours())).replace("mm", toDigits(time.getMinutes())).replace("ss", toDigits(time.getSeconds())).replace("SSS", toDigits(time.getMilliseconds(), 3));
  }
  Time2.template = template;
})(Time || (Time = {}));

// dsh/vendor/schemastery/lib/index.mjs
var kSchema = Symbol.for("schemastery");
var kValidationError = Symbol.for("ValidationError");
globalThis.__schemastery_index__ ??= 0;
globalThis.__schemastery_refs__ = void 0;
var ValidationError = class extends TypeError {
  options;
  name = "ValidationError";
  constructor(message, options) {
    let prefix = "$";
    for (const segment of options.path || []) if (typeof segment === "string") prefix += "." + segment;
    else if (typeof segment === "number") prefix += "[" + segment + "]";
    else if (typeof segment === "symbol") prefix += `[Symbol(${segment.toString()})]`;
    if (prefix.startsWith(".")) prefix = prefix.slice(1);
    super((prefix === "$" ? "" : `${prefix} `) + message);
    this.options = options;
  }
  static is(error) {
    return !!error?.[kValidationError];
  }
};
Object.defineProperty(ValidationError.prototype, kValidationError, { value: true });
var Schema = function(options) {
  const schema = function(data, options2 = {}) {
    return Schema.resolve(data, schema, options2)[0];
  };
  if (options.refs) {
    const refs = mapValues(options.refs, (options2) => new Schema(options2));
    const getRef = (uid) => refs[uid];
    for (const key in refs) {
      const options2 = refs[key];
      options2.sKey = getRef(options2.sKey);
      options2.inner = getRef(options2.inner);
      options2.list = options2.list && options2.list.map(getRef);
      options2.dict = options2.dict && mapValues(options2.dict, getRef);
    }
    return refs[options.uid];
  }
  Object.assign(schema, options);
  if (typeof schema.callback === "string") try {
    schema.callback = new Function("return " + schema.callback)();
  } catch {
  }
  Object.defineProperty(schema, "uid", { value: globalThis.__schemastery_index__++ });
  Object.setPrototypeOf(schema, Schema.prototype);
  schema.meta ||= {};
  schema.toString = schema.toString.bind(schema);
  return schema;
};
Schema.prototype = Object.create(Function.prototype);
Schema.prototype[kSchema] = true;
Object.defineProperty(Schema.prototype, "~standard", { get() {
  return {
    version: 1,
    vendor: "schemastery",
    validate: (value) => {
      try {
        return { value: Schema.resolve(value, this, {})[0] };
      } catch (error) {
        if (ValidationError.is(error)) return { issues: [{
          message: error.message,
          path: error.options.path
        }] };
        throw error;
      }
    }
  };
} });
Schema.ValidationError = ValidationError;
Schema.prototype.toJSON = function toJSON() {
  if (globalThis.__schemastery_refs__) {
    globalThis.__schemastery_refs__[this.uid] ??= JSON.parse(JSON.stringify({ ...this }));
    return this.uid;
  }
  globalThis.__schemastery_refs__ = { [this.uid]: { ...this } };
  globalThis.__schemastery_refs__[this.uid] = JSON.parse(JSON.stringify({ ...this }));
  const result = {
    uid: this.uid,
    refs: globalThis.__schemastery_refs__
  };
  globalThis.__schemastery_refs__ = void 0;
  return result;
};
Schema.prototype.set = function set(key, value) {
  this.dict[key] = value;
  return this;
};
Schema.prototype.push = function push(value) {
  this.list.push(value);
  return this;
};
function mergeDesc(original, messages) {
  const result = typeof original === "string" ? { "": original } : { ...original };
  for (const locale in messages) {
    const value = messages[locale];
    if (value?.$description || value?.$desc) result[locale] = value.$description || value.$desc;
    else if (typeof value === "string") result[locale] = value;
  }
  return result;
}
function getInner(value) {
  return value?.$value ?? value?.$inner;
}
function extractKeys(data) {
  return filterKeys(data ?? {}, (key) => !key.startsWith("$"));
}
Schema.prototype.i18n = function i18n(messages) {
  const schema = Schema(this);
  const desc = mergeDesc(schema.meta.description, messages);
  if (Object.keys(desc).length) schema.meta.description = desc;
  if (schema.dict) schema.dict = mapValues(schema.dict, (inner, key) => {
    return inner.i18n(mapValues(messages, (data) => getInner(data)?.[key] ?? data?.[key]));
  });
  if (schema.list) schema.list = schema.list.map((inner, index) => {
    return inner.i18n(mapValues(messages, (data = {}) => {
      if (Array.isArray(getInner(data))) return getInner(data)[index];
      if (Array.isArray(data)) return data[index];
      return extractKeys(data);
    }));
  });
  if (schema.inner) schema.inner = schema.inner.i18n(mapValues(messages, (data) => {
    if (getInner(data)) return getInner(data);
    return extractKeys(data);
  }));
  if (schema.sKey) schema.sKey = schema.sKey.i18n(mapValues(messages, (data) => data?.$key));
  return schema;
};
Schema.prototype.extra = function extra(key, value) {
  const schema = Schema(this);
  schema.meta = {
    ...schema.meta,
    [key]: value
  };
  return schema;
};
for (const key of [
  "required",
  "disabled",
  "collapse",
  "hidden",
  "loose"
]) Object.assign(Schema.prototype, { [key](value = true) {
  const schema = Schema(this);
  schema.meta = {
    ...schema.meta,
    [key]: value
  };
  return schema;
} });
Schema.prototype.deprecated = function deprecated() {
  const schema = Schema(this);
  schema.meta.badges ||= [];
  schema.meta.badges.push({
    text: "deprecated",
    type: "danger"
  });
  return schema;
};
Schema.prototype.experimental = function experimental() {
  const schema = Schema(this);
  schema.meta.badges ||= [];
  schema.meta.badges.push({
    text: "experimental",
    type: "warning"
  });
  return schema;
};
Schema.prototype.pattern = function pattern(regexp) {
  const schema = Schema(this);
  const pattern2 = pick(regexp, ["source", "flags"]);
  schema.meta = {
    ...schema.meta,
    pattern: pattern2
  };
  return schema;
};
Schema.prototype.simplify = function simplify(value) {
  if (deepEqual(value, this.meta.default, this.type === "dict")) return null;
  if (isNullable(value)) return value;
  if (this.type === "object" || this.type === "dict") {
    const result = {};
    for (const key in value) {
      const item = (this.type === "object" ? this.dict[key] : this.inner)?.simplify(value[key]);
      if (this.type === "dict" || !isNullable(item)) result[key] = item;
    }
    if (deepEqual(result, this.meta.default, this.type === "dict")) return null;
    return result;
  } else if (this.type === "array" || this.type === "tuple") {
    const result = [];
    value.forEach((value2, index) => {
      const schema = this.type === "array" ? this.inner : this.list[index];
      const item = schema ? schema.simplify(value2) : value2;
      result.push(item);
    });
    return result;
  } else if (this.type === "intersect") {
    const result = {};
    for (const item of this.list) Object.assign(result, item.simplify(value));
    return result;
  } else if (this.type === "union") for (const schema of this.list) try {
    Schema.resolve(value, schema, {});
    return schema.simplify(value);
  } catch {
  }
  return value;
};
Schema.prototype.toString = function toString(inline) {
  return formatters[this.type]?.(this, inline) ?? `Schema<${this.type}>`;
};
Schema.prototype.role = function role(role, extra2) {
  const schema = Schema(this);
  schema.meta = {
    ...schema.meta,
    role,
    extra: extra2
  };
  return schema;
};
for (const key of [
  "default",
  "link",
  "comment",
  "description",
  "max",
  "min",
  "step"
]) Object.assign(Schema.prototype, { [key](value) {
  const schema = Schema(this);
  schema.meta = {
    ...schema.meta,
    [key]: value
  };
  return schema;
} });
var resolvers = {};
Schema.extend = function extend(type, resolve4) {
  resolvers[type] = resolve4;
};
Schema.resolve = function resolve(data, schema, options = {}, strict = false) {
  if (!schema) return [data];
  if (options.ignore?.(data, schema)) return [data];
  if (isNullable(data) && schema.type !== "lazy") {
    if (schema.meta.required) throw new ValidationError(`missing required value`, options);
    let current = schema;
    let fallback = schema.meta.default;
    while (current?.type === "intersect" && isNullable(fallback)) {
      current = current.list[0];
      fallback = current?.meta.default;
    }
    if (isNullable(fallback)) return [data];
    data = clone(fallback);
  }
  const callback = resolvers[schema.type];
  if (!callback) throw new ValidationError(`unsupported type "${schema.type}"`, options);
  try {
    return callback(data, schema, options, strict);
  } catch (error) {
    if (!schema.meta.loose) throw error;
    return [schema.meta.default];
  }
};
Schema.from = function from(source) {
  if (isNullable(source)) return Schema.any();
  else if ([
    "string",
    "number",
    "boolean"
  ].includes(typeof source)) return Schema.const(source).required();
  else if (source[kSchema]) return source;
  else if (typeof source === "function") switch (source) {
    case String:
      return Schema.string().required();
    case Number:
      return Schema.number().required();
    case Boolean:
      return Schema.boolean().required();
    case Function:
      return Schema.function().required();
    default:
      return Schema.is(source).required();
  }
  else throw new TypeError(`cannot infer schema from ${source}`);
};
Schema.lazy = function lazy(builder) {
  const toJSON2 = () => {
    if (!schema.inner[kSchema]) {
      schema.inner = schema.builder();
      schema.inner.meta = {
        ...schema.meta,
        ...schema.inner.meta
      };
    }
    return schema.inner.toJSON();
  };
  const schema = new Schema({
    type: "lazy",
    builder,
    inner: { toJSON: toJSON2 }
  });
  return schema;
};
Schema.natural = function natural() {
  return Schema.number().step(1).min(0);
};
Schema.percent = function percent() {
  return Schema.number().step(0.01).min(0).max(1).role("slider");
};
Schema.date = function date() {
  return Schema.union([Schema.is(Date), Schema.transform(Schema.string().role("datetime"), (value, options) => {
    const date2 = new Date(value);
    if (isNaN(+date2)) throw new ValidationError(`invalid date "${value}"`, options);
    return date2;
  }, true)]);
};
Schema.regExp = function regExp(flag = "") {
  return Schema.union([Schema.is(RegExp), Schema.transform(Schema.string().role("regexp", { flag }), (value, options) => {
    try {
      return new RegExp(value, flag);
    } catch (e) {
      throw new ValidationError(e.message, options);
    }
  }, true)]);
};
Schema.arrayBuffer = function arrayBuffer(encoding) {
  return Schema.union([
    Schema.is(ArrayBuffer),
    Schema.is(SharedArrayBuffer),
    Schema.transform(Schema.any(), (value, options) => {
      if (Binary.isSource(value)) return Binary.fromSource(value);
      throw new ValidationError(`expected ArrayBufferSource but got ${value}`, options);
    }, true),
    ...encoding ? [Schema.transform(Schema.string(), (value, options) => {
      try {
        return encoding === "base64" ? Binary.fromBase64(value) : Binary.fromHex(value);
      } catch (e) {
        throw new ValidationError(e.message, options);
      }
    }, true)] : []
  ]);
};
Schema.extend("lazy", (data, schema, options, strict) => {
  if (!schema.inner[kSchema]) {
    schema.inner = schema.builder();
    schema.inner.meta = {
      ...schema.meta,
      ...schema.inner.meta
    };
  }
  return Schema.resolve(data, schema.inner, options, strict);
});
Schema.extend("any", (data) => {
  return [data];
});
Schema.extend("never", (data, _, options) => {
  throw new ValidationError(`expected nullable but got ${data}`, options);
});
Schema.extend("const", (data, { value }, options) => {
  if (deepEqual(data, value)) return [value];
  throw new ValidationError(`expected ${value} but got ${data}`, options);
});
function checkWithinRange(data, meta, description, options, skipMin = false) {
  const { max = Infinity, min = -Infinity } = meta;
  if (data > max) throw new ValidationError(`expected ${description} <= ${max} but got ${data}`, options);
  if (data < min && !skipMin) throw new ValidationError(`expected ${description} >= ${min} but got ${data}`, options);
}
Schema.extend("string", (data, { meta }, options) => {
  if (typeof data !== "string") throw new ValidationError(`expected string but got ${data}`, options);
  if (meta.pattern) {
    const regexp = new RegExp(meta.pattern.source, meta.pattern.flags);
    if (!regexp.test(data)) throw new ValidationError(`expect string to match regexp ${regexp}`, options);
  }
  checkWithinRange(data.length, meta, "string length", options);
  return [data];
});
function decimalShift(data, digits) {
  const str = data.toString();
  if (str.includes("e")) return data * Math.pow(10, digits);
  const index = str.indexOf(".");
  if (index === -1) return data * Math.pow(10, digits);
  const frac = str.slice(index + 1);
  const integer = str.slice(0, index);
  if (frac.length <= digits) return +(integer + frac.padEnd(digits, "0"));
  return +(integer + frac.slice(0, digits) + "." + frac.slice(digits));
}
function isMultipleOf(data, min, step) {
  step = Math.abs(step);
  if (!/^\d+\.\d+$/.test(step.toString())) return (data - min) % step === 0;
  const index = step.toString().indexOf(".");
  const digits = step.toString().slice(index + 1).length;
  return Math.abs(decimalShift(data, digits) - decimalShift(min, digits)) % decimalShift(step, digits) === 0;
}
Schema.extend("number", (data, { meta }, options) => {
  if (typeof data !== "number") throw new ValidationError(`expected number but got ${data}`, options);
  checkWithinRange(data, meta, "number", options);
  const { step } = meta;
  if (step && !isMultipleOf(data, meta.min ?? 0, step)) throw new ValidationError(`expected number multiple of ${step} but got ${data}`, options);
  return [data];
});
Schema.extend("boolean", (data, _, options) => {
  if (typeof data === "boolean") return [data];
  throw new ValidationError(`expected boolean but got ${data}`, options);
});
Schema.extend("bitset", (data, { bits, meta }, options) => {
  let value = 0, keys = [];
  if (typeof data === "number") {
    value = data;
    for (const key in bits) if (data & bits[key]) keys.push(key);
  } else if (Array.isArray(data)) {
    keys = data;
    for (const key of keys) {
      if (typeof key !== "string") throw new ValidationError(`expected string but got ${key}`, options);
      if (key in bits) value |= bits[key];
    }
  } else throw new ValidationError(`expected number or array but got ${data}`, options);
  if (value === meta.default) return [value];
  return [value, keys];
});
Schema.extend("function", (data, _, options) => {
  if (typeof data === "function") return [data];
  throw new ValidationError(`expected function but got ${data}`, options);
});
Schema.extend("is", (data, { constructor }, options) => {
  if (typeof constructor === "function") {
    if (data instanceof constructor) return [data];
    throw new ValidationError(`expected ${constructor.name} but got ${data}`, options);
  } else {
    if (isNullable(data)) throw new ValidationError(`expected ${constructor} but got ${data}`, options);
    let prototype = Object.getPrototypeOf(data);
    while (prototype) {
      if (prototype.constructor?.name === constructor) return [data];
      prototype = Object.getPrototypeOf(prototype);
    }
    throw new ValidationError(`expected ${constructor} but got ${data}`, options);
  }
});
function property(data, key, schema, options) {
  try {
    const [value, adapted] = Schema.resolve(data[key], schema, {
      ...options,
      path: [...options.path || [], key]
    });
    if (adapted !== void 0) data[key] = adapted;
    return value;
  } catch (e) {
    if (!options?.autofix) throw e;
    delete data[key];
    return schema.meta.default;
  }
}
Schema.extend("array", (data, { inner, meta }, options) => {
  if (!Array.isArray(data)) throw new ValidationError(`expected array but got ${data}`, options);
  checkWithinRange(data.length, meta, "array length", options, !isNullable(inner.meta.default));
  return [data.map((_, index) => property(data, index, inner, options))];
});
Schema.extend("dict", (data, { inner, sKey }, options, strict) => {
  if (!isPlainObject(data)) throw new ValidationError(`expected object but got ${data}`, options);
  const result = {};
  for (const key in data) {
    let rKey;
    try {
      rKey = Schema.resolve(key, sKey, options)[0];
    } catch (error) {
      if (strict) continue;
      throw error;
    }
    result[rKey] = property(data, key, inner, options);
    data[rKey] = data[key];
    if (key !== rKey) delete data[key];
  }
  return [result];
});
Schema.extend("tuple", (data, { list }, options, strict) => {
  if (!Array.isArray(data)) throw new ValidationError(`expected array but got ${data}`, options);
  const result = list.map((inner, index) => property(data, index, inner, options));
  if (strict) return [result];
  result.push(...data.slice(list.length));
  return [result];
});
function merge(result, data) {
  for (const key in data) {
    if (key in result) continue;
    result[key] = data[key];
  }
}
Schema.extend("object", (data, { dict }, options, strict) => {
  if (!isPlainObject(data)) throw new ValidationError(`expected object but got ${data}`, options);
  const result = {};
  for (const key in dict) {
    const value = property(data, key, dict[key], options);
    if (!isNullable(value) || key in data) result[key] = value;
  }
  if (!strict) merge(result, data);
  return [result];
});
Schema.extend("union", (data, { list, toString: toString2 }, options, strict) => {
  const messages = [];
  for (const inner of list) try {
    return Schema.resolve(data, inner, options, strict);
  } catch (error) {
    messages.push(error);
  }
  throw new ValidationError(`expected ${toString2()} but got ${JSON.stringify(data)}`, options);
});
Schema.extend("intersect", (data, { list, toString: toString2 }, options, strict) => {
  if (!list.length) return [data];
  let result;
  for (const inner of list) {
    const value = Schema.resolve(data, inner, options, true)[0];
    if (isNullable(value)) continue;
    if (isNullable(result)) result = value;
    else if (typeof result !== typeof value) throw new ValidationError(`expected ${toString2()} but got ${JSON.stringify(data)}`, options);
    else if (typeof value === "object") merge(result ??= {}, value);
    else if (result !== value) throw new ValidationError(`expected ${toString2()} but got ${JSON.stringify(data)}`, options);
  }
  if (!strict && isPlainObject(data)) merge(result, data);
  return [result];
});
Schema.extend("transform", (data, { inner, callback, preserve }, options) => {
  const [result, adapted = data] = Schema.resolve(data, inner, options, true);
  if (preserve) return [callback(result)];
  else return [callback(result), callback(adapted)];
});
var formatters = {};
function defineMethod(name, keys, format) {
  formatters[name] = format;
  Object.assign(Schema, { [name](...args) {
    const schema = new Schema({ type: name });
    keys.forEach((key, index) => {
      switch (key) {
        case "sKey":
          schema.sKey = args[index] ?? Schema.string();
          break;
        case "inner":
          schema.inner = Schema.from(args[index]);
          break;
        case "list":
          schema.list = args[index].map(Schema.from);
          break;
        case "dict":
          schema.dict = mapValues(args[index], Schema.from);
          break;
        case "bits":
          schema.bits = {};
          for (const key2 in args[index]) {
            if (typeof args[index][key2] !== "number") continue;
            schema.bits[key2] = args[index][key2];
          }
          break;
        case "callback": {
          const callback = schema.callback = args[index];
          callback["toJSON"] ||= () => callback.toString();
          break;
        }
        case "constructor": {
          const constructor = schema.constructor = args[index];
          if (typeof constructor === "function") constructor["toJSON"] ||= () => constructor["name"];
          break;
        }
        default:
          schema[key] = args[index];
      }
    });
    if (name === "object" || name === "dict") schema.meta.default = {};
    else if (name === "array" || name === "tuple") schema.meta.default = [];
    else if (name === "bitset") schema.meta.default = 0;
    return schema;
  } });
}
defineMethod("is", ["constructor"], ({ constructor }) => {
  if (typeof constructor === "function") return constructor.name;
  else return constructor;
});
defineMethod("any", [], () => "any");
defineMethod("never", [], () => "never");
defineMethod("const", ["value"], ({ value }) => typeof value === "string" ? JSON.stringify(value) : value);
defineMethod("string", [], () => "string");
defineMethod("number", [], () => "number");
defineMethod("boolean", [], () => "boolean");
defineMethod("bitset", ["bits"], () => "bitset");
defineMethod("function", [], () => "function");
defineMethod("array", ["inner"], ({ inner }) => `${inner.toString(true)}[]`);
defineMethod("dict", ["inner", "sKey"], ({ inner, sKey }) => `{ [key: ${sKey.toString()}]: ${inner.toString()} }`);
defineMethod("tuple", ["list"], ({ list }) => `[${list.map((inner) => inner.toString()).join(", ")}]`);
defineMethod("object", ["dict"], ({ dict }) => {
  if (Object.keys(dict).length === 0) return "{}";
  return `{ ${Object.entries(dict).map(([key, inner]) => {
    return `${key}${inner.meta.required ? "" : "?"}: ${inner.toString()}`;
  }).join(", ")} }`;
});
defineMethod("union", ["list"], ({ list }, inline) => {
  const result = list.map(({ toString: format }) => format()).join(" | ");
  return inline ? `(${result})` : result;
});
defineMethod("intersect", ["list"], ({ list }) => {
  return `${list.map((inner) => inner.toString(true)).join(" & ")}`;
});
defineMethod("transform", [
  "inner",
  "callback",
  "preserve"
], ({ inner }, isInner) => inner.toString(isInner));

// src/knowledge/config.ts
var Config = Schema.object({
  embeddingProvider: Schema.union(["openai", "ollama", "local", "none"]).default("none"),
  embeddingBaseUrl: Schema.string().default(""),
  embeddingModel: Schema.string().default(""),
  embeddingApiKey: Schema.string().default(""),
  rerankModel: Schema.string().default(""),
  rerankBaseUrl: Schema.string().default(""),
  rerankApiKey: Schema.string().default(""),
  smartChunk: Schema.boolean().default(true),
  chunkSeparator: Schema.string().default("\n\n"),
  chunkSize: Schema.number().default(1024),
  chunkOverlap: Schema.number().default(200),
  topK: Schema.number().default(6),
  searchMode: Schema.union(["auto", "hybrid", "vector", "lexical"]).default("auto"),
  similarityThreshold: Schema.number().default(0),
  mmrDiversity: Schema.number().default(0),
  rrfVectorWeight: Schema.number().default(1),
  embeddingBatchSize: Schema.number().default(32),
  siblingChunks: Schema.number().default(1),
  localModelCacheDir: Schema.string().default(""),
  hfEndpoint: Schema.string().default(""),
  chunkStorePath: Schema.string().default(""),
  documentProcessorProvider: Schema.union(["builtin", "mineru"]).default("builtin"),
  mineruApiKey: Schema.string().default(""),
  mineruApiHost: Schema.string().default(""),
  semanticChunk: Schema.boolean().default(false),
  semanticChunkThreshold: Schema.number().default(0.75),
  chunkTokenLimit: Schema.number().default(0),
  conflictStrategy: Schema.union(["keep", "replace", "rename"]).default("rename"),
  urlRefreshHours: Schema.number().default(0),
  imageCaptionProvider: Schema.union(["off", "openai", "ollama"]).default("off"),
  imageCaptionModel: Schema.string().default(""),
  imageCaptionBaseUrl: Schema.string().default(""),
  imageCaptionApiKey: Schema.string().default(""),
  resumeInterruptedOnStartup: Schema.boolean().default(true)
});
function resolveConfig(config, overrides) {
  const apiKey = overrides.embeddingApiKey ?? process.env.KNOWLEDGE_API_KEY ?? config.embeddingApiKey;
  const rerankApiKey = overrides.rerankApiKey ?? process.env.KNOWLEDGE_RERANK_API_KEY ?? config.rerankApiKey;
  const chunkSize = clampInt(overrides.chunkSize ?? config.chunkSize, 64, 1e5, 1024);
  const chunkOverlap = clampInt(overrides.chunkOverlap ?? config.chunkOverlap, 0, chunkSize - 1, 0);
  const topK = clampInt(overrides.topK ?? config.topK, 1, 50, 6);
  const embeddingBatchSize = clampInt(overrides.embeddingBatchSize ?? config.embeddingBatchSize, 1, 512, 32);
  const rrfVectorWeight = clampNumber(overrides.rrfVectorWeight ?? config.rrfVectorWeight, 0.1, 5, 1);
  const siblingChunks = clampInt(overrides.siblingChunks ?? config.siblingChunks, 0, 3, 1);
  return {
    embeddingProvider: overrides.embeddingProvider ?? config.embeddingProvider,
    embeddingBaseUrl: overrides.embeddingBaseUrl ?? config.embeddingBaseUrl,
    embeddingModel: overrides.embeddingModel ?? config.embeddingModel,
    embeddingApiKey: apiKey,
    rerankModel: overrides.rerankModel ?? config.rerankModel,
    rerankBaseUrl: overrides.rerankBaseUrl ?? config.rerankBaseUrl,
    rerankApiKey,
    smartChunk: overrides.smartChunk ?? config.smartChunk,
    chunkSeparator: overrides.chunkSeparator ?? config.chunkSeparator,
    chunkSize,
    chunkOverlap,
    topK,
    searchMode: overrides.searchMode ?? config.searchMode,
    similarityThreshold: clampNumber(overrides.similarityThreshold ?? config.similarityThreshold, 0, 1, 0),
    mmrDiversity: clampNumber(overrides.mmrDiversity ?? config.mmrDiversity, 0, 1, 0),
    rrfVectorWeight,
    embeddingBatchSize,
    siblingChunks,
    hfEndpoint: overrides.hfEndpoint ?? config.hfEndpoint,
    documentProcessorProvider: overrides.documentProcessorProvider ?? config.documentProcessorProvider,
    mineruApiKey: overrides.mineruApiKey ?? config.mineruApiKey,
    mineruApiHost: overrides.mineruApiHost ?? config.mineruApiHost,
    semanticChunk: overrides.semanticChunk ?? config.semanticChunk,
    semanticChunkThreshold: clampNumber(overrides.semanticChunkThreshold ?? config.semanticChunkThreshold, 0, 1, 0.75),
    chunkTokenLimit: clampInt(overrides.chunkTokenLimit ?? config.chunkTokenLimit, 0, 1e6, 0),
    conflictStrategy: overrides.conflictStrategy ?? config.conflictStrategy,
    urlRefreshHours: clampInt(overrides.urlRefreshHours ?? config.urlRefreshHours, 0, 24 * 365, 0),
    imageCaptionProvider: overrides.imageCaptionProvider ?? config.imageCaptionProvider,
    imageCaptionModel: overrides.imageCaptionModel ?? config.imageCaptionModel,
    imageCaptionBaseUrl: overrides.imageCaptionBaseUrl ?? config.imageCaptionBaseUrl,
    imageCaptionApiKey: overrides.imageCaptionApiKey ?? config.imageCaptionApiKey,
    resumeInterruptedOnStartup: overrides.resumeInterruptedOnStartup ?? config.resumeInterruptedOnStartup,
    localModelCacheDir: overrides.localModelCacheDir ?? config.localModelCacheDir
  };
}
function resolveConfigFor(config, overrides, baseConfig) {
  const resolved = resolveConfig(config, overrides);
  if (baseConfig === void 0) return resolved;
  const chunkSize = clampInt(baseConfig.chunkSize ?? resolved.chunkSize, 64, 1e5, 800);
  const chunkOverlap = clampInt(baseConfig.chunkOverlap ?? resolved.chunkOverlap, 0, chunkSize - 1, 0);
  const topK = clampInt(baseConfig.topK ?? resolved.topK, 1, 50, 6);
  return {
    ...resolved,
    embeddingProvider: baseConfig.embeddingProvider ?? resolved.embeddingProvider,
    embeddingBaseUrl: baseConfig.embeddingBaseUrl ?? resolved.embeddingBaseUrl,
    embeddingModel: baseConfig.embeddingModel ?? resolved.embeddingModel,
    embeddingApiKey: baseConfig.embeddingApiKey ?? resolved.embeddingApiKey,
    rerankModel: baseConfig.rerankModel ?? resolved.rerankModel,
    rerankBaseUrl: baseConfig.rerankBaseUrl ?? resolved.rerankBaseUrl,
    rerankApiKey: baseConfig.rerankApiKey ?? resolved.rerankApiKey,
    smartChunk: baseConfig.smartChunk ?? resolved.smartChunk,
    chunkSeparator: baseConfig.chunkSeparator ?? resolved.chunkSeparator,
    chunkSize,
    chunkOverlap,
    topK,
    searchMode: baseConfig.searchMode ?? resolved.searchMode,
    similarityThreshold: clampNumber(baseConfig.similarityThreshold ?? resolved.similarityThreshold, 0, 1, 0),
    mmrDiversity: clampNumber(baseConfig.mmrDiversity ?? resolved.mmrDiversity, 0, 1, 0),
    rrfVectorWeight: clampNumber(baseConfig.rrfVectorWeight ?? resolved.rrfVectorWeight, 0.1, 5, 1),
    embeddingBatchSize: clampInt(baseConfig.embeddingBatchSize ?? resolved.embeddingBatchSize, 1, 512, 32),
    siblingChunks: clampInt(baseConfig.siblingChunks ?? resolved.siblingChunks, 0, 3, 1),
    documentProcessorProvider: baseConfig.documentProcessorProvider ?? resolved.documentProcessorProvider,
    mineruApiKey: baseConfig.mineruApiKey ?? resolved.mineruApiKey,
    mineruApiHost: baseConfig.mineruApiHost ?? resolved.mineruApiHost,
    semanticChunk: baseConfig.semanticChunk ?? resolved.semanticChunk,
    semanticChunkThreshold: clampNumber(baseConfig.semanticChunkThreshold ?? resolved.semanticChunkThreshold, 0, 1, 0.75),
    chunkTokenLimit: clampInt(baseConfig.chunkTokenLimit ?? resolved.chunkTokenLimit, 0, 1e6, 0),
    conflictStrategy: baseConfig.conflictStrategy ?? resolved.conflictStrategy,
    urlRefreshHours: clampInt(baseConfig.urlRefreshHours ?? resolved.urlRefreshHours, 0, 24 * 365, 0),
    imageCaptionProvider: baseConfig.imageCaptionProvider ?? resolved.imageCaptionProvider,
    imageCaptionModel: baseConfig.imageCaptionModel ?? resolved.imageCaptionModel,
    imageCaptionBaseUrl: baseConfig.imageCaptionBaseUrl ?? resolved.imageCaptionBaseUrl,
    imageCaptionApiKey: baseConfig.imageCaptionApiKey ?? resolved.imageCaptionApiKey
  };
}
function clampInt(value, min, max, fallback) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
function clampNumber(value, min, max, fallback) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

// src/knowledge/index.ts
init_embed();

// src/knowledge/localModels.ts
init_embed();
var LOCAL_MODELS = [
  {
    id: "onnx-community/Qwen3-Embedding-0.6B-ONNX",
    name: "Qwen3 Embedding 0.6B",
    kind: "embedding",
    subtitle: "1024 \u7EF4 \xB7 \u4E2D\u6587\u5F3A \xB7 last-token \u6C60\u5316",
    dimensions: 1024,
    maxTokens: 32768
  },
  {
    id: "Xenova/bge-small-zh-v1.5",
    name: "BGE Small zh v1.5",
    kind: "embedding",
    subtitle: "512 \u7EF4 \xB7 \u4E2D\u6587\u68C0\u7D22 \xB7 CLS \u6C60\u5316",
    dimensions: 512,
    maxTokens: 512
  },
  {
    id: "Xenova/bge-small-en-v1.5",
    name: "BGE Small en v1.5",
    kind: "embedding",
    subtitle: "384 \u7EF4 \xB7 \u82F1\u6587\u68C0\u7D22 \xB7 CLS \u6C60\u5316",
    dimensions: 384,
    maxTokens: 512
  },
  {
    id: "Xenova/gte-small",
    name: "GTE Small",
    kind: "embedding",
    subtitle: "384 \u7EF4 \xB7 \u591A\u8BED\u8A00 \xB7 mean \u6C60\u5316",
    dimensions: 384,
    maxTokens: 512
  },
  {
    id: "Xenova/multilingual-e5-small",
    name: "Multilingual E5 Small",
    kind: "embedding",
    subtitle: "384 \u7EF4 \xB7 \u591A\u8BED\u8A00 \xB7 CLS \u6C60\u5316",
    dimensions: 384,
    maxTokens: 512
  },
  {
    id: "Xenova/bge-reranker-base",
    name: "BGE Reranker Base",
    kind: "reranking",
    subtitle: "\u672C\u5730\u91CD\u6392 \xB7 \u8DE8\u7F16\u7801\u5668 \xB7 \u53CC\u8BED\uFF08\u68C0\u7D22\u8D28\u91CF\u63D0\u5347\u660E\u663E\uFF0C\u7EA6 280MB\uFF09"
  }
];
function findModel(id) {
  const descriptor = LOCAL_MODELS.find((model) => model.id === id);
  if (descriptor === void 0) throw new Error(`unknown local model: ${id}`);
  return descriptor;
}
async function summarize(descriptor) {
  const live = getLocalModelStatus(descriptor.id);
  if (live.status === "downloading") {
    return { ...descriptor, status: "downloading", progress: live.progress, message: live.message };
  }
  if (live.status === "error") {
    return { ...descriptor, status: "error", progress: live.progress, message: live.message };
  }
  if (live.status === "ready") {
    return { ...descriptor, status: "ready", progress: 100, message: "" };
  }
  const downloaded = await isLocalModelDownloaded(descriptor.id);
  return { ...descriptor, status: downloaded ? "ready" : "not_downloaded", progress: downloaded ? 100 : 0, message: "" };
}
async function listLocalModels() {
  return Promise.all(LOCAL_MODELS.map(summarize));
}
async function downloadLocalModel(id) {
  const descriptor = findModel(id);
  const task = descriptor.kind === "reranking" ? "reranking" : "feature-extraction";
  void loadLocalModel(id, task).catch((error) => {
    markLocalModelError(descriptor.id, error instanceof Error ? error.message : String(error));
  });
  return summarize(descriptor);
}
async function cancelLocalModelDownload(id) {
  const descriptor = findModel(id);
  await cancelLocalModel(id);
  return { ...descriptor, status: "not_downloaded", progress: 0, message: "" };
}
async function deleteLocalModel(id) {
  const descriptor = findModel(id);
  await removeLocalModel(id);
  return { ...descriptor, status: "not_downloaded", progress: 0, message: "" };
}

// src/knowledge/index.ts
init_ocr();
init_net();

// src/knowledge/http.ts
var MAX_BODY_BYTES = 32 * 1024 * 1024;
function knowledgeRoute(service) {
  return {
    kind: "prefix",
    path: "/knowledge",
    handler: (req, res) => {
      void handleRequest(service, req, res);
    }
  };
}
async function handleRequest(service, req, res) {
  try {
    await service.whenReady();
    const url = new URL(req.url ?? "/", "http://dsh.internal");
    const pathname = url.pathname;
    const rel = pathname.slice("/knowledge".length);
    const segments = rel.split("/").filter(Boolean).map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });
    const method = (req.method ?? "GET").toUpperCase();
    const body = method === "GET" ? void 0 : await readJson(req);
    const value = await route(service, method, segments, body ?? {}, url.searchParams);
    if (value === void 0) {
      writeJson(res, 404, { ok: false, error: { code: "not-found", message: `no route for ${method} ${pathname}` } });
      return;
    }
    if (isRawDownload(value)) {
      const { bytes, fileName, mimeType, inline } = value;
      res.writeHead(200, {
        "content-type": mimeType ?? "application/octet-stream",
        "content-disposition": inline === true ? `inline; filename*=UTF-8''${encodeURIComponent(fileName)}` : `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "content-length": String(bytes.byteLength)
      });
      res.end(Buffer.from(bytes));
      return;
    }
    writeJson(res, 200, { ok: true, value });
  } catch (error) {
    if (error instanceof ConflictError) {
      writeJson(res, 409, { ok: false, error: { code: "conflict", message: error.message } });
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    writeJson(res, 500, { ok: false, error: { code: "error", message } });
  }
}
function isRawDownload(value) {
  return typeof value === "object" && value !== null && value.rawDownload === true;
}
async function route(service, method, segments, body, query) {
  if (segments[0] === "config") {
    if (method === "GET") return service.getConfig();
    if (method === "PUT") return service.setConfig(body);
    return void 0;
  }
  if (segments[0] === "knowledge-toggle") {
    if (method === "GET") {
      return { enabled: service.isEnabled(), enabledBaseIds: service.getEnabledBaseIds() };
    }
    if (method === "PUT") {
      if (typeof body.enabled === "boolean") await service.setEnabled(body.enabled);
      if (Array.isArray(body.enabledBaseIds)) {
        await service.setEnabledBaseIds(body.enabledBaseIds.filter((id) => typeof id === "string"));
      }
      return { enabled: service.isEnabled(), enabledBaseIds: service.getEnabledBaseIds() };
    }
    return void 0;
  }
  if (segments[0] === "groups") {
    if (method === "GET") return service.listGroups();
    if (method === "POST") return service.createGroup(typeof body.name === "string" ? body.name : "");
    if (method === "PATCH") {
      return service.renameGroup(
        typeof body.from === "string" ? body.from : "",
        typeof body.to === "string" ? body.to : ""
      );
    }
    if (method === "DELETE") {
      return service.deleteGroup(typeof body.name === "string" ? body.name : "").then(() => ({ deleted: true }));
    }
    return void 0;
  }
  if (segments[0] === "stats" && method === "GET") return service.stats();
  if (segments[0] === "local-model-status" && method === "GET") {
    return service.getLocalModelStatus(query.get("model") ?? void 0);
  }
  if (segments[0] === "probe-embedding-dimensions" && method === "POST") {
    return service.probeEmbeddingDimensions({
      ...typeof body.provider === "string" ? { provider: body.provider } : {},
      ...typeof body.baseUrl === "string" ? { baseUrl: body.baseUrl } : {},
      ...typeof body.model === "string" ? { model: body.model } : {},
      ...typeof body.apiKey === "string" ? { apiKey: body.apiKey } : {}
    });
  }
  if (segments[0] === "local-models") {
    if (method === "GET") return service.listLocalModels();
    if (segments[1] === "download" && method === "POST") {
      return service.downloadLocalModel(query.get("model") ?? "");
    }
    if (segments[1] === "cancel" && method === "POST") {
      return service.cancelLocalModel(query.get("model") ?? "");
    }
    if (segments[1] === "remove" && method === "DELETE") {
      return service.deleteLocalModel(query.get("model") ?? "");
    }
    if (segments[1] === "migrate" && method === "POST") {
      return service.migrateLocalModels(typeof body.to === "string" ? body.to : "");
    }
    return void 0;
  }
  if (segments[0] === "local-ocr") {
    if (method === "GET" && segments.length === 1) return service.getOcrStatus();
    if (segments[1] === "download" && method === "POST") return service.downloadOcr();
    if (segments[1] === "remove" && method === "DELETE") return service.deleteOcr();
    return void 0;
  }
  if (segments[0] === "local-ollama") {
    if (segments[1] === "tags" && method === "GET") {
      return { models: await service.listOllamaModels(typeof query.get("baseUrl") === "string" ? query.get("baseUrl") : "") };
    }
    if (segments[1] === "pull" && method === "POST") {
      const model = typeof body.model === "string" ? body.model.trim() : "";
      if (model === "") throw new Error("ollama model name is empty");
      const baseUrl = typeof body.baseUrl === "string" ? body.baseUrl : "";
      void service.pullOllamaModel(model, baseUrl).catch(() => {
      });
      return { started: true };
    }
    if (segments[1] === "pull" && method === "DELETE") {
      const model = query.get("model") ?? "";
      if (model === "") throw new Error("ollama model name is empty");
      service.cancelOllamaPull(model);
      return { cancelled: true };
    }
    if (segments[1] === "delete" && method === "DELETE") {
      const model = typeof body.model === "string" ? body.model.trim() : "";
      if (model === "") throw new Error("ollama model name is empty");
      const baseUrl = typeof body.baseUrl === "string" ? body.baseUrl : "";
      await service.deleteOllamaModel(model, baseUrl);
      return { deleted: true };
    }
    if (segments[1] === "status" && method === "GET") {
      return service.getOllamaPullStatus(query.get("model") ?? "");
    }
    if (segments[1] === "pulls" && method === "GET") {
      return { pulls: service.activeOllamaPulls() };
    }
    return void 0;
  }
  if (segments[0] === "model-suggestions" && method === "GET") {
    return service.modelSuggestions();
  }
  if (segments[0] === "indexing-status" && method === "GET") {
    return service.indexingStatus();
  }
  if (segments[0] === "import-directory" && segments.length >= 2) {
    const jobId = segments[1];
    if (method === "GET") return service.directoryImportStatus(jobId);
    if (segments[2] === "cancel" && method === "POST") {
      service.cancelDirectoryImport(jobId);
      return { cancelled: true };
    }
    return void 0;
  }
  if (segments[0] === "reindex" && segments.length >= 2) {
    const jobId = segments[1];
    if (method === "GET") return service.reindexJobStatus(jobId);
    if (segments[2] === "cancel" && method === "POST") {
      service.cancelReindexJob(jobId);
      return { cancelled: true };
    }
    return void 0;
  }
  if (segments[0] === "bases") {
    if (segments.length === 1) {
      if (method === "GET") return service.listBases();
      if (method === "POST") return service.createBase(body);
      return void 0;
    }
    const baseId = segments[1];
    if (segments.length === 2) {
      if (method === "PATCH") return service.renameBase(baseId, body);
      if (method === "DELETE") return service.deleteBase(baseId).then(() => ({ deleted: true }));
      return void 0;
    }
    if (segments.length === 3) {
      if (segments[2] === "stats" && method === "GET") return service.stats(baseId);
      if (segments[2] === "reindex" && method === "POST") return service.startReindexBase(baseId);
      if (segments[2] === "files-batch" && method === "POST") {
        const bodyRequest = body;
        if (!Array.isArray(bodyRequest.files)) {
          return void 0;
        }
        return service.addFiles({
          baseId,
          files: bodyRequest.files.filter((file) => typeof file === "object" && file !== null && typeof file.fileName === "string").map((file) => ({
            fileName: file.fileName,
            ...typeof file.mimeType === "string" ? { mimeType: file.mimeType } : {},
            ...typeof file.contentBase64 === "string" ? { contentBase64: file.contentBase64 } : {}
          })),
          ...bodyRequest.conflict === "rename" || bodyRequest.conflict === "replace" || bodyRequest.conflict === "detect" ? { conflict: bodyRequest.conflict } : {},
          ...typeof bodyRequest.parentDirectoryId === "string" ? { parentDirectoryId: bodyRequest.parentDirectoryId } : {}
        });
      }
      if (segments[2] === "restore" && method === "POST") {
        const config = typeof body.config === "object" && body.config !== null ? body.config : void 0;
        return service.restoreBase(baseId, typeof body.name === "string" ? body.name : "", config);
      }
      if (segments[2] === "import-directory" && method === "POST") {
        return service.importDirectory({ baseId, path: typeof body.path === "string" ? body.path : "" });
      }
      if (segments[2] === "import-directory-tree" && method === "POST") {
        return service.importDirectoryTree(baseId, typeof body.path === "string" ? body.path : "");
      }
      if (segments[2] === "directories" && method === "POST") {
        return service.createDirectory(
          baseId,
          typeof body.title === "string" ? body.title : "directory",
          typeof body.parentDirectoryId === "string" ? body.parentDirectoryId : void 0
        );
      }
      if (segments[2] === "documents") {
        if (method === "GET") return service.listDocuments(baseId);
        if (method === "POST") {
          if (typeof body.url === "string") {
            return service.addUrlDocument({
              baseId,
              url: body.url,
              ...typeof body.title === "string" ? { title: body.title } : {},
              ...typeof body.parentDirectoryId === "string" ? { parentDirectoryId: body.parentDirectoryId } : {}
            });
          }
          const request = body;
          if (typeof request.contentBase64 === "string") {
            const conflict = body.conflict;
            return service.addFileDocument({
              baseId,
              fileName: typeof body.fileName === "string" ? body.fileName : "document",
              ...typeof body.mimeType === "string" ? { mimeType: body.mimeType } : {},
              ...typeof body.title === "string" ? { title: body.title } : {},
              ...conflict === "keep" || conflict === "replace" || conflict === "rename" || conflict === "detect" ? { conflict } : {},
              ...typeof body.parentDirectoryId === "string" ? { parentDirectoryId: body.parentDirectoryId } : {},
              contentBase64: request.contentBase64
            });
          }
          return service.addTextDocument({
            baseId,
            title: typeof body.title === "string" ? body.title : "untitled",
            content: typeof body.content === "string" ? body.content : "",
            ...typeof body.parentDirectoryId === "string" ? { parentDirectoryId: body.parentDirectoryId } : {}
          });
        }
      }
    }
    return void 0;
  }
  if (segments[0] === "documents") {
    if (segments.length === 1) {
      if (method === "DELETE") return service.deleteDocuments(readIds(body));
      return void 0;
    }
    if (segments.length === 2 && segments[1] === "reindex" && method === "POST") {
      return service.reindexDocuments(readIds(body));
    }
    const documentId = segments[1];
    if (segments.length === 2) {
      if (method === "GET") {
        const rawTextLimit = readIntQuery(query, "rawTextLimit");
        const includeChunks = query.get("includeChunks") !== "false";
        return service.getDocument(documentId, {
          includeChunks,
          ...rawTextLimit !== void 0 ? { rawTextLimit } : {}
        });
      }
      if (method === "PATCH") return service.renameDocument(documentId, typeof body.title === "string" ? body.title : "");
      if (method === "DELETE") return service.deleteDocument(documentId).then(() => ({ deleted: true }));
      return void 0;
    }
    if (segments.length === 3) {
      if (segments[2] === "chunks" && method === "GET") {
        return service.listChunks(documentId, readIntQuery(query, "limit"), readIntQuery(query, "offset"));
      }
      if (segments[2] === "reindex" && method === "POST") return service.reindexDocument(documentId);
      if (segments[2] === "refresh" && method === "POST") return service.refreshUrlDocument(documentId);
      if (segments[2] === "raw" && method === "GET") {
        const raw = await service.getRawFile(documentId);
        if (raw === void 0) return void 0;
        return { rawDownload: true, inline: query.get("inline") === "1", ...raw };
      }
    }
    return void 0;
  }
  if (segments[0] === "search" && method === "POST") {
    return service.search(body);
  }
  return void 0;
}
async function readJson(req) {
  const mediaType = (req.headers["content-type"] ?? "").split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType === "") return {};
  if (mediaType !== "application/json") throw new Error("content type must be application/json");
  const text = await readBody(req);
  if (text.trim().length === 0) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("body is not valid JSON");
  }
}
async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    const buffer = chunk;
    size += buffer.byteLength;
    if (size > MAX_BODY_BYTES) throw new Error("request body too large");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}
function writeJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}
function readIds(body) {
  return Array.isArray(body.ids) ? body.ids.filter((id) => typeof id === "string") : [];
}
function readIntQuery(query, key) {
  const raw = query.get(key);
  if (raw === null || raw === "") return void 0;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.trunc(value) : void 0;
}

// src/knowledge/parse.ts
var SUPPORTED_DOCUMENT_EXTENSIONS = [
  "txt",
  "md",
  "markdown",
  "mdx",
  "csv",
  "html",
  "htm",
  "json",
  "log",
  "pdf",
  "docx",
  "doc",
  "pptx",
  "ppt",
  "xlsx",
  "xls",
  "epub"
];
function extensionOf(fileName) {
  const idx = fileName.lastIndexOf(".");
  return idx >= 0 ? fileName.slice(idx + 1).toLowerCase() : "";
}
async function parseDocumentBuffer(buffer, fileName, mimeType) {
  const ext = extensionOf(fileName);
  if (mimeType === "application/pdf" || ext === "pdf") return parsePdf(buffer);
  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || ext === "docx") {
    return parseDocx(buffer);
  }
  if (ext === "html" || ext === "htm") return extractHtmlToMarkdown(decodeText(buffer));
  if (ext === "pptx") return parsePptx(buffer);
  if (ext === "xlsx") return parseXlsx(buffer);
  if (ext === "epub") return parseEpub(buffer);
  if (ext === "doc") return parseDoc(buffer);
  if (ext === "ppt") return parseLegacyOffice(buffer, "ppt");
  if (ext === "xls") return parseLegacyOffice(buffer, "xlsx");
  return decodeText(buffer);
}
function decodeText(buffer) {
  if (buffer.length >= 3 && buffer[0] === 239 && buffer[1] === 187 && buffer[2] === 191) {
    return new TextDecoder("utf-8").decode(buffer.subarray(3));
  }
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
  let replacements = 0;
  for (let i = 0; i < utf8.length; i += 1) {
    if (utf8.charCodeAt(i) === 65533) {
      replacements += 1;
      if (replacements > 8) break;
    }
  }
  if (replacements <= 8) return utf8;
  try {
    return new TextDecoder("gb18030").decode(buffer);
  } catch {
    return utf8;
  }
}
function extractFromHtml(html) {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch !== null ? decodeEntities(titleMatch[1].trim()) : "";
  const withoutBlocks = html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<head[\s\S]*?<\/head>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  const withBreaks = withoutBlocks.replace(/<\/(p|div|h[1-6]|li|tr|section|article|blockquote)>/gi, "\n").replace(/<(br|hr)\s*\/?>/gi, "\n");
  const withoutTags = withBreaks.replace(/<[^>]+>/g, " ");
  const text = decodeEntities(withoutTags).split("\n").map((line) => line.replace(/\s+/g, " ").trim()).filter((line) => line.length > 0).join("\n");
  return { title, text };
}
var turndownCtor = null;
async function loadTurndown() {
  if (turndownCtor === null) {
    const mod = await import("turndown");
    turndownCtor = mod.default ?? mod;
  }
  return turndownCtor;
}
async function extractHtmlToMarkdown(html) {
  const cleaned = html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<head[\s\S]*?<\/head>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<noscript[\s\S]*?<\/noscript>/gi, " ").replace(/<(nav|footer|aside|form|iframe|svg|canvas|template)[\s\S]*?<\/\1>/gi, " ");
  try {
    const Turndown = await loadTurndown();
    const converter = new Turndown({
      headingStyle: "atx",
      codeBlockStyle: "fenced",
      bulletListMarker: "-",
      emDelimiter: "*"
    });
    const markdown = converter.turndown(cleaned);
    if (markdown.trim().length === 0) return extractFromHtml(html).text;
    return markdown.replace(/\n{3,}/g, "\n\n").trim();
  } catch {
    return extractFromHtml(html).text;
  }
}
async function extractHtmlDocument(html) {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch !== null ? decodeEntities(titleMatch[1].trim()) : "";
  const text = await extractHtmlToMarkdown(html);
  return { title, text };
}
var NAMED_ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "\u2014",
  ndash: "\u2013",
  hellip: "\u2026",
  lsquo: "\u2018",
  rsquo: "\u2019",
  ldquo: "\u201C",
  rdquo: "\u201D",
  copy: "\xA9",
  reg: "\xAE",
  trade: "\u2122",
  middot: "\xB7",
  bull: "\u2022",
  times: "\xD7",
  divide: "\xF7",
  deg: "\xB0",
  plusmn: "\xB1"
};
function decodeEntities(text) {
  return text.replace(/&#x([0-9a-f]+);/gi, (_match, hex) => codePointFrom(parseInt(hex, 16))).replace(/&#(\d+);/g, (_match, dec) => codePointFrom(Number(dec))).replace(/&([a-z][a-z0-9]+);/gi, (match, name) => NAMED_ENTITIES[name.toLowerCase()] ?? match);
}
function codePointFrom(value) {
  if (!Number.isInteger(value) || value < 0 || value > 1114111 || value >= 55296 && value <= 57343) return "\uFFFD";
  return String.fromCodePoint(value);
}
function averageLineLength(text) {
  const lines = text.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
  if (lines.length === 0) return 0;
  return lines.reduce((sum, line) => sum + line.length, 0) / lines.length;
}
async function extractTextWithLayout(bytes) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  let cMapUrl;
  try {
    const { createRequire: createRequire2 } = await import("node:module");
    const { dirname: dirname4 } = await import("node:path");
    const require2 = createRequire2(import.meta.url);
    const pkg = require2.resolve("pdfjs-dist/package.json");
    cMapUrl = `${dirname4(pkg).replace(/\\/g, "/")}/cmaps/`;
  } catch {
  }
  const loadingTask = pdfjs.getDocument({
    data: Uint8Array.from(bytes),
    disableWorker: true,
    isEvalSupported: false,
    useSystemFonts: true,
    ...cMapUrl !== void 0 ? { cMapUrl, cMapPacked: true } : {}
  });
  try {
    const doc = await loadingTask.promise;
    const pages = [];
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      const items = (content.items ?? []).map((item) => ({
        str: item.str ?? "",
        x: item.transform?.[4] ?? 0,
        y: item.transform?.[5] ?? 0,
        height: Math.abs(item.transform?.[3] ?? 0) || 10
      })).filter((item) => item.str.length > 0);
      if (items.length === 0) continue;
      const heights = items.map((item) => item.height).sort((a, b) => a - b);
      const tolerance = (heights[Math.floor(heights.length / 2)] ?? 10) * 0.6;
      const bands = /* @__PURE__ */ new Map();
      for (const item of items) {
        const band = Math.round(item.y / tolerance);
        const list = bands.get(band) ?? [];
        list.push({ x: item.x, str: item.str });
        bands.set(band, list);
      }
      const lines = [...bands.entries()].sort((a, b) => a[0] - b[0]).map(([, list]) => list.sort((a, b) => a.x - b.x).map((entry) => entry.str).join("")).filter((line) => line.trim().length > 0);
      if (lines.length > 0) pages.push(lines.join("\n"));
    }
    return pages.join("\n\n");
  } finally {
    await loadingTask.destroy().catch(() => {
    });
  }
}
async function ocrFallback(bytes) {
  try {
    const { isOcrReady: isOcrReady2, ocrPdfText: ocrPdfText2 } = await Promise.resolve().then(() => (init_ocr(), ocr_exports));
    if (!isOcrReady2()) return "";
    return await ocrPdfText2(bytes);
  } catch {
    return "";
  }
}
async function parsePdf(buffer) {
  let primaryError = null;
  let text = "";
  try {
    const pdfParse = await loadPdfParse();
    const result = await pdfParse(Buffer.from(buffer));
    text = typeof result?.text === "string" ? result.text : "";
  } catch (error) {
    primaryError = error instanceof Error ? error : new Error(String(error));
  }
  if (text.trim().length > 0) {
    const avgLine = averageLineLength(text);
    if (avgLine >= 5) return text;
    let reassembled = "";
    try {
      reassembled = await extractTextWithLayout(buffer);
    } catch {
    }
    if (averageLineLength(reassembled) >= 12 && reassembled.trim().length > 0) return reassembled;
    const recognized = await ocrFallback(buffer);
    if (recognized.trim().length > 0) return recognized;
    try {
      const anydoc = await loadAnydoc();
      const markdown = (await anydoc.toMarkdownBytes(Buffer.from(buffer))).trim();
      if (markdown.length > 0) return markdown;
    } catch {
    }
    return text;
  }
  try {
    const anydoc = await loadAnydoc();
    const markdown = (await anydoc.toMarkdownBytes(Buffer.from(buffer))).trim();
    if (markdown.length > 0) return markdown;
  } catch {
  }
  let ocrReady = false;
  try {
    const { isOcrReady: isOcrReady2, ocrPdfText: ocrPdfText2 } = await Promise.resolve().then(() => (init_ocr(), ocr_exports));
    ocrReady = isOcrReady2();
    if (ocrReady) {
      const recognized = await ocrPdfText2(buffer);
      if (recognized.trim().length > 0) return recognized;
    }
  } catch {
  }
  if (primaryError !== null) {
    throw new Error(`PDF parsing failed: ${primaryError.message}`);
  }
  throw new Error(
    ocrReady ? "PDF contains no extractable text (it may be scanned)" : "PDF contains no extractable text (it may be scanned) \u2014 download the local OCR models in Settings \u2192 Local Models to auto-recognize scans"
  );
}
async function parseDocx(buffer) {
  try {
    const mammoth = await loadMammoth();
    const result = await mammoth.extractRawText({ buffer: Buffer.from(buffer) });
    const text = result?.value ?? "";
    if (text.trim().length === 0) throw new Error("DOCX contains no extractable text");
    return text;
  } catch (error) {
    throw new Error(`DOCX parsing failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
async function parseDoc(buffer) {
  try {
    const WordExtractor = await loadWordExtractor();
    const extractor = new WordExtractor();
    const doc = await extractor.extract(Buffer.from(buffer));
    const text = doc.getBody() ?? "";
    if (text.trim().length === 0) throw new Error("DOC contains no extractable text");
    return text;
  } catch (error) {
    throw new Error(`DOC parsing failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
async function parseLegacyOffice(buffer, format) {
  try {
    const anydoc = await loadAnydoc();
    const markdown = await anydoc.toMarkdownBytes(buffer, format);
    const text = markdown.trim();
    if (text.length === 0) throw new Error("document contains no extractable content");
    return text;
  } catch (error) {
    throw new Error(`document parsing failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
async function parsePptx(buffer) {
  const zip = await loadZip(buffer);
  const slides = [];
  for (const name of Object.keys(zip.files).sort()) {
    if (!/^ppt\/slides\/slide\d+\.xml$/.test(name)) continue;
    const xml = await zip.files[name].async("string");
    slides.push(stripXmlText(xml, "a:t"));
  }
  if (slides.length === 0) throw new Error("PPTX contains no extractable slides");
  return slides.join("\n\n");
}
async function parseXlsx(buffer) {
  const zip = await loadZip(buffer);
  const shared = zip.files["xl/sharedStrings.xml"];
  const sharedStrings = [];
  if (shared !== void 0) {
    const xml = await shared.async("string");
    for (const si of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      const inner = si[1] ?? "";
      const text = [...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decodeEntities(m[1] ?? "")).join("");
      sharedStrings.push(text);
    }
  }
  const lines = [];
  for (const name of Object.keys(zip.files).sort()) {
    if (!/^xl\/worksheets\/sheet\d+\.xml$/.test(name)) continue;
    const xml = await zip.files[name].async("string");
    const rows = xml.split(/<row\b/);
    for (const row of rows) {
      const cells = [];
      for (const cell of row.matchAll(/<c\b[^>]*>([\s\S]*?)<\/c>/g)) {
        const tag = cell[0] ?? "";
        const type = /<c\b[^>]*\bt="([^"]*)"/.exec(tag)?.[1];
        const content = cell[1] ?? "";
        const inline = /<is>([\s\S]*?)<\/is>/.exec(content);
        if (inline !== null) {
          const text = [...(inline[1] ?? "").matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decodeEntities(m[1] ?? "")).join("");
          cells.push(text);
          continue;
        }
        const ref = /<v>([\s\S]*?)<\/v>/.exec(content);
        const raw = ref?.[1] ?? "";
        if (type === "s") {
          const sharedIdx = Number(raw);
          if (Number.isInteger(sharedIdx) && sharedIdx >= 0 && sharedIdx < sharedStrings.length) {
            cells.push(sharedStrings[sharedIdx]);
          }
        } else if (type === "b") {
          cells.push(raw === "1" ? "1" : "0");
        } else if (raw.trim().length > 0) {
          cells.push(decodeEntities(raw));
        }
      }
      if (cells.some((cell) => cell.trim().length > 0)) lines.push(cells.join("	"));
    }
  }
  if (lines.length === 0) throw new Error("XLSX contains no extractable cells");
  return lines.join("\n");
}
async function parseEpub(buffer) {
  const zip = await loadZip(buffer);
  const pages = [];
  for (const name of Object.keys(zip.files).sort()) {
    if (!/\.(xhtml|html|htm)$/.test(name)) continue;
    if (/nav|toc|cover/i.test(name)) continue;
    const html = await zip.files[name].async("string");
    const text = await extractHtmlToMarkdown(html);
    if (text.trim().length > 0) pages.push(text);
  }
  if (pages.length === 0) throw new Error("EPUB contains no extractable pages");
  return pages.join("\n\n");
}
function stripXmlText(xml, tag) {
  const parts = [];
  const pattern2 = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "g");
  for (const match of xml.matchAll(pattern2)) {
    if (match[1] !== void 0) parts.push(decodeEntities(match[1]));
  }
  return parts.join("");
}
async function loadPdfParse() {
  const mod = await import("pdf-parse");
  return mod.default;
}
async function loadMammoth() {
  const mod = await import("mammoth");
  return mod.default ?? mod;
}
async function loadWordExtractor() {
  const mod = await import("word-extractor");
  return mod.default ?? mod;
}
async function loadAnydoc() {
  const mod = await import("@firecrawl/anydoc");
  return mod;
}
var MAX_ARCHIVE_UNCOMPRESSED_BYTES = 256 * 1024 * 1024;
async function loadZip(buffer) {
  const mod = await import("jszip");
  const JSZip2 = mod.default ?? mod;
  let zip;
  try {
    zip = await new JSZip2().loadAsync(buffer);
  } catch (error) {
    throw new Error(`archive parsing failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  const total = Object.values(zip.files).reduce((sum, entry) => {
    const size = entry._data?.uncompressedSize;
    return sum + (typeof size === "number" && Number.isFinite(size) ? size : 0);
  }, 0);
  if (total > MAX_ARCHIVE_UNCOMPRESSED_BYTES) {
    throw new Error(`archive too large to unpack (${Math.round(total / 1024 / 1024)} MB uncompressed)`);
  }
  return zip;
}

// src/knowledge/retrieval.ts
function cosineSimilarity2(a, b) {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i += 1) dot += a[i] * b[i];
  return clamp01(dot);
}
var LATIN_WORD = /[a-z0-9_]+/g;
var CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]+/g;
function tokenize(text) {
  const tokens = [];
  const lowered = text.toLowerCase();
  for (const match of lowered.match(LATIN_WORD) ?? []) {
    if (match.length > 1) tokens.push(match);
  }
  for (const run of lowered.match(CJK) ?? []) {
    if (run.length === 1) {
      tokens.push(run);
      continue;
    }
    for (let i = 0; i < run.length - 1; i += 1) tokens.push(run.slice(i, i + 2));
  }
  return tokens;
}
function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}
var BM25_K1 = 1.5;
var BM25_B = 0.75;
function buildBm25(documents) {
  const docTokens = /* @__PURE__ */ new Map();
  const df = /* @__PURE__ */ new Map();
  let totalLength = 0;
  for (const doc of documents) {
    const tokens = tokenize(doc.text);
    docTokens.set(doc.id, tokens);
    totalLength += tokens.length;
    const seen = /* @__PURE__ */ new Set();
    for (const token of tokens) {
      if (!seen.has(token)) {
        df.set(token, (df.get(token) ?? 0) + 1);
        seen.add(token);
      }
    }
  }
  const n = documents.length;
  const avgdl = n > 0 ? totalLength / n : 0;
  return {
    score(id, queryTokens) {
      const tokens = docTokens.get(id);
      if (tokens === void 0 || tokens.length === 0) return 0;
      const tf = /* @__PURE__ */ new Map();
      for (const token of tokens) tf.set(token, (tf.get(token) ?? 0) + 1);
      let sum = 0;
      for (const token of queryTokens) {
        const documentFrequency = df.get(token);
        if (documentFrequency === void 0) continue;
        const idf = Math.log((n - documentFrequency + 0.5) / (documentFrequency + 0.5) + 1);
        const termFrequency = tf.get(token) ?? 0;
        if (termFrequency === 0) continue;
        const norm = termFrequency / (termFrequency + BM25_K1 * (1 - BM25_B + BM25_B * (tokens.length / avgdl)));
        sum += idf * norm;
      }
      return sum;
    }
  };
}
function normalizeBm25(raw) {
  return raw / (raw + 1);
}
var RRF_K = 60;
function reciprocalRankFusion(rankedLists, weights) {
  const fused = /* @__PURE__ */ new Map();
  for (let i = 0; i < rankedLists.length; i += 1) {
    const weight = weights?.[i] ?? 1;
    rankedLists[i].forEach((id, index) => {
      fused.set(id, (fused.get(id) ?? 0) + weight / (RRF_K + index + 1));
    });
  }
  return fused;
}
function maximalMarginalRelevance(hits, byId, queryVector, lambda, topK) {
  const withEmbedding = hits.filter((hit) => {
    const embedding = byId.get(hit.id)?.embedding;
    return embedding !== void 0 && embedding.length === queryVector.length;
  });
  const withoutEmbedding = hits.filter((hit) => !withEmbedding.includes(hit));
  if (withEmbedding.length < 2) return [...hits];
  const selected = [];
  const remaining = [...withEmbedding];
  const target = Math.min(withEmbedding.length, topK);
  while (selected.length < target && remaining.length > 0) {
    let bestIndex = 0;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < remaining.length; i += 1) {
      const hit = remaining[i];
      const embedding = byId.get(hit.id).embedding;
      let maxSimilarity = 0;
      for (const picked of selected) {
        const pickedEmbedding = byId.get(picked.id).embedding;
        maxSimilarity = Math.max(maxSimilarity, cosineSimilarity2(embedding, pickedEmbedding));
      }
      const score = lambda * hit.score - (1 - lambda) * maxSimilarity;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }
    selected.push(remaining.splice(bestIndex, 1)[0]);
  }
  return [...selected, ...remaining, ...withoutEmbedding];
}
function rank(query, candidates, options) {
  const queryTokens = tokenize(query);
  const vectorAvailable = options.queryVector !== void 0 && candidates.some((candidate) => candidate.embedding !== void 0 && candidate.embedding.length === options.queryVector.length);
  let mode;
  if (options.mode === "vector" || options.mode === "hybrid") mode = options.mode;
  else if (options.mode === "lexical") mode = "lexical";
  else mode = vectorAvailable ? "hybrid" : "lexical";
  if (mode !== "lexical" && !vectorAvailable) mode = "lexical";
  const scorer = buildBm25(candidates);
  const lexical = /* @__PURE__ */ new Map();
  for (const candidate of candidates) lexical.set(candidate.id, normalizeBm25(scorer.score(candidate.id, queryTokens)));
  const vector = /* @__PURE__ */ new Map();
  if (options.queryVector !== void 0) {
    for (const candidate of candidates) {
      if (candidate.embedding !== void 0 && candidate.embedding.length === options.queryVector.length) {
        vector.set(candidate.id, cosineSimilarity2(options.queryVector, candidate.embedding));
      }
    }
  }
  let ranked;
  if (mode === "vector") {
    ranked = [...vector.entries()].map(([id, score]) => ({ id, score, vectorScore: score }));
  } else if (mode === "lexical") {
    ranked = [...lexical.entries()].map(([id, score]) => ({ id, score, lexicalScore: score }));
  } else {
    const vectorOrder = [...vector.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
    const lexicalOrder = [...lexical.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
    const fused = reciprocalRankFusion([vectorOrder, lexicalOrder]);
    const maxFused = 2 / (RRF_K + 1);
    ranked = candidates.map((candidate) => ({
      id: candidate.id,
      score: (fused.get(candidate.id) ?? 0) / maxFused,
      vectorScore: vector.get(candidate.id),
      lexicalScore: lexical.get(candidate.id)
    }));
  }
  ranked.sort((a, b) => b.score - a.score);
  if (options.mmr && options.mmrLambda > 0 && options.queryVector !== void 0) {
    const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
    ranked = maximalMarginalRelevance(ranked, byId, options.queryVector, options.mmrLambda, Math.max(options.topK * 3, 12));
  }
  return ranked.filter((hit) => hit.score >= options.threshold).slice(0, options.topK);
}

// src/knowledge/rerank.ts
init_net();
init_embed();
async function rerankCandidates(baseUrl, model, apiKey, query, candidates, topN) {
  const keep = topN !== void 0 ? Math.max(1, Math.min(Math.trunc(topN), candidates.length)) : candidates.length;
  if (model.startsWith("local:")) {
    const modelId = model.slice("local:".length).trim();
    if (modelId === "") throw new Error("local rerank model id is empty");
    const scores2 = await rerankLocal(modelId, query, candidates.map((candidate) => candidate.text));
    const out = /* @__PURE__ */ new Map();
    const ranked = candidates.map((candidate, i) => ({ id: candidate.id, score: scores2[i] !== void 0 ? clamp012(scores2[i]) : 0 })).sort((a, b) => b.score - a.score).slice(0, keep);
    for (const entry of ranked) out.set(entry.id, entry.score);
    return out;
  }
  const url = `${baseUrl.replace(/\/+$/, "")}/rerank`;
  const response = await httpFetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...apiKey ? { authorization: `Bearer ${apiKey}` } : {}
    },
    body: JSON.stringify({
      model,
      query,
      documents: candidates.map((candidate) => candidate.text),
      top_n: keep
    }),
    timeoutMs: 6e4
  });
  if (!response.ok) {
    const error = new Error(`rerank request failed: HTTP ${response.status} ${await response.text()}`);
    error.status = response.status;
    throw error;
  }
  const json = await response.json();
  const scores = /* @__PURE__ */ new Map();
  for (const result of json.results ?? []) {
    const candidate = candidates[result.index ?? -1];
    if (candidate === void 0) continue;
    scores.set(candidate.id, typeof result.relevance_score === "number" ? clamp012(result.relevance_score) : 0);
  }
  return scores;
}
function clamp012(value) {
  return Math.max(0, Math.min(1, value));
}

// src/knowledge/chunkdb.ts
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir as homedir2 } from "node:os";
import { dirname as dirname2, join as join3 } from "node:path";
function resolveChunkStorePath(explicit) {
  if (explicit !== void 0 && explicit.trim() !== "") return explicit;
  return join3(dshHome(), "storages", "knowledge-chunks.sqlite");
}
function legacyChunkFilePath() {
  return join3(dshHome(), "storages", "knowledge.json");
}
function dshHome() {
  const fromEnv = process.env.DSH_HOME;
  return fromEnv !== void 0 && fromEnv.trim() !== "" ? fromEnv : join3(homedir2(), ".dsh");
}
var EMBEDDING_HASH_QUERY_BATCH = 500;
var DELETE_BATCH_SIZE = 2e3;
var DELETE_YIELD_BUDGET_MS = 50;
var VACUUM_MIN_FREELIST_RATIO = 0.2;
var VACUUM_MIN_FREED_BYTES = 8 * 1024 * 1024;
var MAX_MATCH_TERMS = 64;
function extractFtsTokens(query) {
  return query.match(/[\p{L}\p{N}_]+/gu) ?? [];
}
function extractMatchTerms(query) {
  const trigrams = [];
  const words = [];
  for (const token of extractFtsTokens(query)) {
    const chars = [...token];
    let cursor = 0;
    while (cursor < chars.length) {
      const unsegmented = UNSEGMENTED_SCRIPT.test(chars[cursor]);
      let end = cursor + 1;
      while (end < chars.length && UNSEGMENTED_SCRIPT.test(chars[end]) === unsegmented) end += 1;
      const run = chars.slice(cursor, end);
      if (!unsegmented || run.length <= 3) {
        words.push(run.join(""));
      } else {
        for (let start = 0; start + 3 <= run.length; start += 1) trigrams.push(run.slice(start, start + 3).join(""));
      }
      cursor = end;
    }
  }
  const distinct = [.../* @__PURE__ */ new Set([...words.filter((word) => [...word].length >= 3), ...trigrams])];
  if (distinct.length > MAX_MATCH_TERMS) {
    console.warn(`[dsh-knowledge] BM25 query exceeds the MATCH term cap; shedding the tail (${distinct.length} terms)`);
  }
  return distinct.slice(0, MAX_MATCH_TERMS);
}
function extractShortTerms(query) {
  return [...new Set(extractFtsTokens(query).filter((token) => [...token].length < 3))];
}
function docFilterSql(docIds, column) {
  if (docIds === void 0 || docIds.length === 0) return null;
  if (docIds.length > EMBEDDING_HASH_QUERY_BATCH) {
    throw new Error(`too many document ids in filter (${docIds.length} > ${EMBEDDING_HASH_QUERY_BATCH})`);
  }
  return {
    sql: ` AND ${column} IN (${docIds.map(() => "?").join(",")})`,
    params: [...docIds]
  };
}
var UNSEGMENTED_SCRIPT = /[\p{Script_Extensions=Han}\p{Script_Extensions=Hiragana}\p{Script_Extensions=Katakana}]/u;
function toLikePattern(token) {
  return `%${token.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}
function needsLikeFallback(query) {
  return extractMatchTerms(query).length === 0;
}
function encodeEmbedding(values) {
  return Buffer.from(new Float32Array(values).buffer);
}
function decodeEmbedding(blob) {
  if (blob === void 0 || blob === null || blob.byteLength === 0) return void 0;
  return Array.from(new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4));
}
function decodeEmbeddingFloat32(blob) {
  if (blob === void 0 || blob === null || blob.byteLength === 0) return void 0;
  return new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4);
}
function cosineFloat32(a, b) {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const av = a[i];
    const bv = b[i];
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  const norm = Math.sqrt(normA) * Math.sqrt(normB);
  if (norm === 0) return 0;
  const cosine = dot / norm;
  return Number.isFinite(cosine) ? Math.max(0, Math.min(1, cosine)) : 0;
}
function toChunkRow(chunk) {
  return {
    chunk_id: chunk.id,
    doc_id: chunk.docId,
    base_id: chunk.baseId,
    idx: chunk.index,
    text: chunk.text,
    heading: chunk.heading ?? null,
    context: chunk.context ?? null,
    embedding: chunk.embedding !== void 0 ? encodeEmbedding(chunk.embedding) : null,
    embedding_model: chunk.embeddingModel ?? null
  };
}
function hashEmbeddingText(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
var ChunkDatabase = class _ChunkDatabase {
  db;
  /**
   * Per-base vector cache for the brute-force lane: vectors load lazily on
   * the first vector query for a base and stay in sync with every write
   * path, so repeated searches never re-fetch/re-decode the BLOBs. Float32
   * storage keeps the cosine loop on typed arrays. Invalidation stays
   * exact (per doc / per base), never a whole-store flush.
   */
  vectorCache = /* @__PURE__ */ new Map();
  static SELECT_COLUMNS = "chunk_id, doc_id, base_id, idx, text, heading, context, embedding, embedding_model";
  constructor(path) {
    mkdirSync(dirname2(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA synchronous = NORMAL");
    this.db.exec("PRAGMA foreign_keys = OFF");
    this.db.exec("PRAGMA busy_timeout = 5000");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chunk (
        chunk_id TEXT PRIMARY KEY,
        doc_id TEXT NOT NULL,
        base_id TEXT NOT NULL,
        idx INTEGER NOT NULL,
        text TEXT NOT NULL,
        search_text TEXT NOT NULL,
        heading TEXT,
        context TEXT,
        embedding BLOB,
        embedding_model TEXT,
        embedding_text_hash TEXT,
        fts_rowid INTEGER
      );
      CREATE INDEX IF NOT EXISTS chunk_doc_idx ON chunk(doc_id);
      CREATE INDEX IF NOT EXISTS chunk_base_idx ON chunk(base_id);
      CREATE VIRTUAL TABLE IF NOT EXISTS chunk_fts USING fts5(
        search_text, content='chunk', content_rowid='fts_rowid', tokenize='trigram'
      );
      -- fts_rowid is a STABLE surrogate key assigned by the insert trigger (never
      -- app code): the implicit rowid is renumbered by VACUUM, which would silently
      -- desync this external-content FTS from its rows (Cherry's #16132-class fix).
      CREATE TRIGGER IF NOT EXISTS chunk_ai AFTER INSERT ON chunk BEGIN
        UPDATE chunk SET fts_rowid = (SELECT COALESCE(MAX(fts_rowid), 0) + 1 FROM chunk)
          WHERE chunk_id = NEW.chunk_id;
        INSERT INTO chunk_fts(rowid, search_text)
        SELECT fts_rowid, search_text FROM chunk WHERE chunk_id = NEW.chunk_id;
      END;
      CREATE TRIGGER IF NOT EXISTS chunk_ad AFTER DELETE ON chunk BEGIN
        INSERT INTO chunk_fts(chunk_fts, rowid, search_text) VALUES ('delete', OLD.fts_rowid, OLD.search_text);
      END;
      -- fts_rowid is stable across a text edit, so it is not reassigned \u2014 only the
      -- FTS row is re-keyed.
      CREATE TRIGGER IF NOT EXISTS chunk_au AFTER UPDATE OF search_text ON chunk BEGIN
        INSERT INTO chunk_fts(chunk_fts, rowid, search_text) VALUES ('delete', OLD.fts_rowid, OLD.search_text);
        INSERT INTO chunk_fts(rowid, search_text) VALUES (NEW.fts_rowid, NEW.search_text);
      END;
    `);
    this.migrateEmbeddingHashColumn();
    this.migrateFtsRowidColumn();
    this.migrateFromBundleLayout();
  }
  /**
   * Schema evolution for the stable FTS surrogate key: older stores keyed the
   * external-content FTS on the implicit `rowid`, which VACUUM renumbers — the
   * FTS then silently points at the wrong rows (Cherry's #16132 class). Adds
   * the `fts_rowid` column, backfills it from the current rowid, and rebuilds
   * `chunk_fts` (virtual tables cannot change their content_rowid in place).
   * Idempotent: a fresh store already has both, so only the unique index is
   * ensured. `fts_rowid` must be unique so the MAX+1 assignment in the insert
   * trigger stays a correct key — the UNIQUE index makes a violation loud.
   */
  migrateFtsRowidColumn() {
    const columns = this.db.prepare("PRAGMA table_info(chunk)").all();
    if (!columns.some((column) => column.name === "fts_rowid")) {
      this.db.exec("ALTER TABLE chunk ADD COLUMN fts_rowid INTEGER");
    }
    this.db.exec("UPDATE chunk SET fts_rowid = rowid WHERE fts_rowid IS NULL");
    const fts = this.db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'chunk_fts'").get();
    this.db.exec("CREATE UNIQUE INDEX IF NOT EXISTS chunk_fts_rowid_uniq ON chunk(fts_rowid)");
    if (fts !== void 0 && fts.sql.includes("fts_rowid")) return;
    this.db.exec("DROP TRIGGER IF EXISTS chunk_ai");
    this.db.exec("DROP TRIGGER IF EXISTS chunk_ad");
    this.db.exec("DROP TRIGGER IF EXISTS chunk_au");
    this.db.exec("DROP TABLE IF EXISTS chunk_fts");
    this.db.exec(`CREATE VIRTUAL TABLE chunk_fts USING fts5(
      search_text, content='chunk', content_rowid='fts_rowid', tokenize='trigram'
    )`);
    this.db.exec(`CREATE TRIGGER chunk_ai AFTER INSERT ON chunk BEGIN
      UPDATE chunk SET fts_rowid = (SELECT COALESCE(MAX(fts_rowid), 0) + 1 FROM chunk)
        WHERE chunk_id = NEW.chunk_id;
      INSERT INTO chunk_fts(rowid, search_text)
      SELECT fts_rowid, search_text FROM chunk WHERE chunk_id = NEW.chunk_id;
    END`);
    this.db.exec(`CREATE TRIGGER chunk_ad AFTER DELETE ON chunk BEGIN
      INSERT INTO chunk_fts(chunk_fts, rowid, search_text) VALUES ('delete', OLD.fts_rowid, OLD.search_text);
    END`);
    this.db.exec(`CREATE TRIGGER chunk_au AFTER UPDATE OF search_text ON chunk BEGIN
      INSERT INTO chunk_fts(chunk_fts, rowid, search_text) VALUES ('delete', OLD.fts_rowid, OLD.search_text);
      INSERT INTO chunk_fts(rowid, search_text) VALUES (NEW.fts_rowid, NEW.search_text);
    END`);
    this.db.exec(`INSERT INTO chunk_fts(chunk_fts) VALUES('rebuild')`);
  }
  /**
   * Schema evolution for the `embedding_text_hash` dedup column: add it to a
   * store created by an older version, then backfill the hash of every stored
   * vector from its `search_text` (the exact text the embedding model saw, so
   * the hash is authoritative for reuse). Idempotent — a fresh store already
   * has the column and nothing to backfill. The index is created here, AFTER
   * the column exists: on an old store the column does not exist when the
   * constructor's CREATE TABLE runs, and a CREATE INDEX on a missing column
   * would fail the whole open.
   */
  migrateEmbeddingHashColumn() {
    const columns = this.db.prepare("PRAGMA table_info(chunk)").all();
    if (!columns.some((column) => column.name === "embedding_text_hash")) {
      this.db.exec("ALTER TABLE chunk ADD COLUMN embedding_text_hash TEXT");
    }
    this.db.exec("CREATE INDEX IF NOT EXISTS chunk_emb_hash_idx ON chunk(embedding_text_hash, embedding_model)");
    const missing = this.db.prepare(
      "SELECT chunk_id, search_text FROM chunk WHERE embedding IS NOT NULL AND embedding_text_hash IS NULL"
    ).all();
    if (missing.length === 0) return;
    const update = this.db.prepare("UPDATE chunk SET embedding_text_hash = ? WHERE chunk_id = ?");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const row of missing) update.run(hashEmbeddingText(row.search_text), row.chunk_id);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  /** One-time migration from the previous per-document bundle layout. */
  migrateFromBundleLayout() {
    const table = this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'chunk_bundles'").get();
    if (table === void 0) return;
    const count = this.db.prepare("SELECT COUNT(*) AS c FROM chunk").get().c;
    if (count === 0) {
      const bundles = this.db.prepare("SELECT doc_id, chunks_json FROM chunk_bundles").all();
      const insert = this.db.prepare(
        "INSERT INTO chunk (chunk_id, doc_id, base_id, idx, text, search_text, heading, context, embedding, embedding_model, embedding_text_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      );
      this.db.exec("BEGIN IMMEDIATE");
      try {
        for (const row of bundles) {
          const chunks = JSON.parse(row.chunks_json);
          for (const chunk of chunks) {
            const searchText = searchTextOf(chunk);
            insert.run(
              chunk.id,
              chunk.docId,
              chunk.baseId,
              chunk.index,
              chunk.text,
              searchText,
              chunk.heading ?? null,
              chunk.context ?? null,
              chunk.embedding !== void 0 ? encodeEmbedding(chunk.embedding) : null,
              chunk.embeddingModel ?? null,
              chunk.embedding !== void 0 ? hashEmbeddingText(searchText) : null
            );
          }
        }
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    }
    this.db.exec("DROP TABLE IF EXISTS chunk_bundles");
  }
  get size() {
    return this.db.prepare("SELECT COUNT(*) AS c FROM chunk").get().c;
  }
  listChunks(baseId) {
    const rows = this.db.prepare(`SELECT ${_ChunkDatabase.SELECT_COLUMNS} FROM chunk WHERE base_id = ? ORDER BY doc_id, idx`).all(baseId);
    return rows.map(rowToChunk);
  }
  listChunksByDoc(docId, limit, offset) {
    const sql = `SELECT ${_ChunkDatabase.SELECT_COLUMNS} FROM chunk WHERE doc_id = ? ORDER BY idx`;
    const rows = limit !== void 0 ? this.db.prepare(`${sql} LIMIT ? OFFSET ?`).all(docId, limit, offset ?? 0) : this.db.prepare(sql).all(docId);
    return rows.map(rowToChunk);
  }
  /** Chunks of one document whose index falls in `[fromIdx, toIdx]` — the
   *  sibling context around a search hit, fetched with one bounded SQL query. */
  listChunksByIndexRange(docId, fromIdx, toIdx) {
    const rows = this.db.prepare(
      `SELECT ${_ChunkDatabase.SELECT_COLUMNS} FROM chunk WHERE doc_id = ? AND idx >= ? AND idx <= ? ORDER BY idx`
    ).all(docId, fromIdx, toIdx);
    return rows.map(rowToChunk);
  }
  /** Actual chunk count per document, for reconciling stale document metadata. */
  chunkCountsByDoc(baseIds) {
    const scope = [...baseIds];
    if (scope.length === 0) return /* @__PURE__ */ new Map();
    const placeholders = scope.map(() => "?").join(",");
    const rows = this.db.prepare(`SELECT doc_id, COUNT(*) AS c FROM chunk WHERE base_id IN (${placeholders}) GROUP BY doc_id`).all(...scope);
    return new Map(rows.map((row) => [row.doc_id, row.c]));
  }
  putChunks(chunks) {
    if (chunks.length === 0) return;
    const docId = chunks[0].docId;
    const baseId = chunks[0].baseId;
    const deleteOld = this.db.prepare("DELETE FROM chunk WHERE doc_id = ? AND base_id = ?");
    const insert = this.db.prepare(
      "INSERT INTO chunk (chunk_id, doc_id, base_id, idx, text, search_text, heading, context, embedding, embedding_model, embedding_text_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );
    this.db.exec("BEGIN IMMEDIATE");
    try {
      deleteOld.run(docId, baseId);
      for (const chunk of chunks) {
        const searchText = searchTextOf(chunk);
        insert.run(
          chunk.id,
          chunk.docId,
          chunk.baseId,
          chunk.index,
          chunk.text,
          searchText,
          chunk.heading ?? null,
          chunk.context ?? null,
          chunk.embedding !== void 0 ? encodeEmbedding(chunk.embedding) : null,
          chunk.embeddingModel ?? null,
          chunk.embedding !== void 0 ? hashEmbeddingText(searchText) : null
        );
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    this.dropVectorCacheByDoc(docId);
    for (const chunk of chunks) this.upsertVectorCache(chunk);
  }
  /**
   * Incrementally persist a batch of chunks WITHOUT clearing the document's
   * other rows (unlike {@link putChunks}, which replaces the whole bundle).
   * This is the crash-recovery write path: `ingestDocument` embeds in batches
   * and lands each batch here, so a crash mid-embedding leaves every completed
   * batch in the store. On restart the recovery pass re-runs the embed with
   * hash reuse (decision A4) and only the missing batches hit the API.
   *
   * `ON CONFLICT(chunk_id) DO UPDATE` (not REPLACE) keeps the rowid stable, so
   * the external-content FTS trigger chain stays consistent.
   */
  putChunkBatch(chunks) {
    if (chunks.length === 0) return;
    const upsert = this.db.prepare(
      `INSERT INTO chunk (chunk_id, doc_id, base_id, idx, text, search_text, heading, context, embedding, embedding_model, embedding_text_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(chunk_id) DO UPDATE SET
         doc_id = excluded.doc_id, base_id = excluded.base_id, idx = excluded.idx,
         text = excluded.text, search_text = excluded.search_text, heading = excluded.heading,
         context = excluded.context, embedding = excluded.embedding,
         embedding_model = excluded.embedding_model, embedding_text_hash = excluded.embedding_text_hash`
    );
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const chunk of chunks) {
        const searchText = searchTextOf(chunk);
        upsert.run(
          chunk.id,
          chunk.docId,
          chunk.baseId,
          chunk.index,
          chunk.text,
          searchText,
          chunk.heading ?? null,
          chunk.context ?? null,
          chunk.embedding !== void 0 ? encodeEmbedding(chunk.embedding) : null,
          chunk.embeddingModel ?? null,
          chunk.embedding !== void 0 ? hashEmbeddingText(searchText) : null
        );
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    for (const chunk of chunks) this.upsertVectorCache(chunk);
  }
  async deleteChunks(docId, baseId) {
    const where = baseId !== void 0 ? "doc_id = ? AND base_id = ?" : "doc_id = ?";
    const keyParams = baseId !== void 0 ? [docId, baseId] : [docId];
    const stmt = this.db.prepare(
      `DELETE FROM chunk WHERE rowid IN (SELECT rowid FROM chunk WHERE ${where} ORDER BY rowid LIMIT ?)`
    );
    let started = Date.now();
    for (; ; ) {
      const changed = stmt.run(...keyParams, DELETE_BATCH_SIZE).changes;
      if (changed === 0) break;
      if (Date.now() - started >= DELETE_YIELD_BUDGET_MS) {
        await new Promise((resolve4) => setImmediate(resolve4));
        started = Date.now();
      }
    }
    this.dropVectorCacheByDoc(docId);
  }
  async deleteChunksByBase(baseId) {
    const stmt = this.db.prepare(
      "DELETE FROM chunk WHERE rowid IN (SELECT rowid FROM chunk WHERE base_id = ? ORDER BY rowid LIMIT ?)"
    );
    let started = Date.now();
    for (; ; ) {
      const changed = stmt.run(baseId, DELETE_BATCH_SIZE).changes;
      if (changed === 0) break;
      if (Date.now() - started >= DELETE_YIELD_BUDGET_MS) {
        await new Promise((resolve4) => setImmediate(resolve4));
        started = Date.now();
      }
    }
    this.vectorCache.delete(baseId);
  }
  /**
   * Return space a large delete freed back to the OS (Cherry's
   * `KnowledgeIndexStore.reclaimSpace` + driver thresholds). Best-effort:
   * - Checkpoint first — cheap, and folds the delete's committed frees into
   *   the main file so `freelist_count` reflects them.
   * - VACUUM only when the freelist is a large share of the file AND a
   *   meaningful byte count; below either bound it just truncates the WAL.
   * - The external-content FTS only TOMBSTONES its trigram rows on delete (via
   *   the chunk delete trigger); the dead segment blobs linger in the shadow
   *   table, which VACUUM cannot reclaim on its own. 'optimize' merges and
   *   drops them, gated behind the same threshold so a small delete never pays
   *   the whole-index segment merge.
   * - VACUUM rewrites into the WAL, so checkpoint again to release it.
   */
  reclaimSpace() {
    this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    const pageSize = this.readPragmaInt("page_size");
    const pageCount = this.readPragmaInt("page_count");
    const freelist = this.readPragmaInt("freelist_count");
    const ratio = pageCount > 0 ? freelist / pageCount : 0;
    if (ratio < VACUUM_MIN_FREELIST_RATIO || freelist * pageSize < VACUUM_MIN_FREED_BYTES) {
      return { vacuumed: false, reclaimedBytes: 0 };
    }
    this.db.exec(`INSERT INTO chunk_fts(chunk_fts) VALUES('optimize')`);
    this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    this.db.exec("VACUUM");
    this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    const pageCountAfter = this.readPragmaInt("page_count");
    return { vacuumed: true, reclaimedBytes: Math.max(0, pageCount - pageCountAfter) * pageSize };
  }
  readPragmaInt(pragma) {
    const row = this.db.prepare(`PRAGMA ${pragma}`).get();
    if (row === void 0) return 0;
    const value = Object.values(row)[0];
    return typeof value === "number" ? value : Number(value ?? 0);
  }
  /**
   * Library-wide vector reuse (Cherry's `listExistingEmbeddingHashes`, decision
   * A4): for each embedding-text hash already stored under `embeddingModel`,
   * return its vector. The caller embeds only the hashes missing from this
   * map, so a re-embed of unchanged chunk text reuses the stored vector instead
   * of re-spending the embedding API. Matching is (hash, embedding_model) —
   * two bases in one store may use different models, so a hash alone is not a
   * valid reuse key (vectors from another model are not comparable). Rows
   * without a vector (a failed/lexical-only import) never match.
   *
   * Batch size stays well under SQLite's bound-parameter limit (Cherry uses
   * 500 for the same reason).
   */
  listEmbeddingVectorsByHashes(hashes, embeddingModel) {
    const vectors = /* @__PURE__ */ new Map();
    for (let i = 0; i < hashes.length; i += EMBEDDING_HASH_QUERY_BATCH) {
      const batch = hashes.slice(i, i + EMBEDDING_HASH_QUERY_BATCH);
      if (batch.length === 0) continue;
      const placeholders = batch.map(() => "?").join(",");
      const rows = this.db.prepare(
        `SELECT embedding_text_hash, embedding FROM chunk
         WHERE embedding_text_hash IN (${placeholders}) AND embedding_model = ? AND embedding IS NOT NULL`
      ).all(...batch, embeddingModel);
      for (const row of rows) {
        const vector = decodeEmbedding(row.embedding);
        if (vector !== void 0) vectors.set(row.embedding_text_hash, vector);
      }
    }
    return vectors;
  }
  /** Per-doc chunk presence + embedding coverage in one grouped pass (listDocuments). */
  docChunkStatus(baseId) {
    const rows = this.db.prepare(
      "SELECT doc_id, SUM(CASE WHEN embedding IS NULL THEN 1 ELSE 0 END) AS missing FROM chunk WHERE base_id = ? GROUP BY doc_id"
    ).all(baseId);
    const withChunks = /* @__PURE__ */ new Set();
    const missingEmbedding = /* @__PURE__ */ new Set();
    for (const row of rows) {
      withChunks.add(row.doc_id);
      if (row.missing > 0) missingEmbedding.add(row.doc_id);
    }
    return { withChunks, missingEmbedding };
  }
  /** Aggregate chunk stats for `stats()`: counts, embedding presence/dimensions, model tags. */
  chunkStats(baseIds) {
    const scope = [...baseIds];
    const placeholders = scope.map(() => "?").join(",");
    const count = scope.length > 0 ? this.db.prepare(`SELECT COUNT(*) AS c FROM chunk WHERE base_id IN (${placeholders})`).get(...scope).c : 0;
    if (count === 0) return { count, embedded: false, embeddingModelCounts: [] };
    const embedded = scope.length > 0 && this.db.prepare(`SELECT 1 AS one FROM chunk WHERE base_id IN (${placeholders}) AND embedding IS NOT NULL LIMIT 1`).get(...scope) !== void 0;
    let dimensions;
    if (embedded && scope.length > 0) {
      const row = this.db.prepare(`SELECT embedding FROM chunk WHERE base_id IN (${placeholders}) AND embedding IS NOT NULL LIMIT 1`).get(...scope);
      dimensions = row !== void 0 ? decodeEmbedding(row.embedding)?.length : void 0;
    }
    const modelRows = this.db.prepare(
      `SELECT base_id, embedding_model, COUNT(*) AS c FROM chunk WHERE embedding IS NOT NULL AND embedding_model IS NOT NULL AND base_id IN (${placeholders}) GROUP BY base_id, embedding_model`
    ).all(...scope);
    return {
      count,
      embedded,
      ...dimensions !== void 0 ? { dimensions } : {},
      embeddingModelCounts: modelRows.map((row) => ({ baseId: row.base_id, model: row.embedding_model, count: row.c }))
    };
  }
  // ── retrieval lanes ────────────────────────────────────────────────────────
  async lexical(query, baseIds, limit, docIds) {
    const scope = [...baseIds];
    if (scope.length === 0) return { total: 0, hits: [] };
    if (query.trim().length === 0) return { total: 0, hits: [] };
    const docFilter = docFilterSql(docIds, "c.doc_id");
    const placeholders = scope.map(() => "?").join(",");
    const scopeSql = `c.base_id IN (${placeholders})${docFilter?.sql ?? ""}`;
    const params = [...scope, ...docFilter?.params ?? []];
    const total = this.db.prepare(`SELECT COUNT(*) AS c FROM chunk c WHERE ${scopeSql}`).get(...params).c;
    if (total === 0) return { total: 0, hits: [] };
    const shortTerms = extractShortTerms(query);
    const likeFilters = shortTerms.map(() => `(c.search_text LIKE ? ESCAPE '\\')`).join(" AND ");
    if (needsLikeFallback(query)) {
      const tokens = extractFtsTokens(query);
      if (tokens.length === 0) return { total, hits: [] };
      const filters = tokens.map(() => `(c.search_text LIKE ? ESCAPE '\\' OR c.context LIKE ? ESCAPE '\\')`).join(" AND ");
      const sql = `
        SELECT ${_ChunkDatabase.SELECT_COLUMNS}, search_text FROM chunk c
        WHERE ${scopeSql} AND ${filters}
        ORDER BY length(c.search_text) ASC
        LIMIT ?
      `;
      for (const token of tokens) {
        const pattern2 = toLikePattern(token);
        params.push(pattern2, pattern2);
      }
      params.push(limit);
      const rows2 = this.db.prepare(sql).all(...params);
      return { total, hits: rows2.map((row) => ({ ...rowToChunk(row), score: -row.search_text.length })) };
    }
    const matchTerms = extractMatchTerms(query);
    const matchQuery = matchTerms.map((term) => `"${term.replaceAll('"', '""')}"`).join(" OR ");
    const baseSql = `
      SELECT ${_ChunkDatabase.SELECT_COLUMNS}, bm25(chunk_fts) AS fts_score
      FROM chunk_fts JOIN chunk c ON c.fts_rowid = chunk_fts.rowid
      WHERE ${scopeSql} AND chunk_fts MATCH ?
    `;
    const matchSql = likeFilters !== "" ? `${baseSql} AND ${likeFilters} ORDER BY fts_score ASC LIMIT ?` : `${baseSql} ORDER BY fts_score ASC LIMIT ?`;
    const relaxedSql = `${baseSql} ORDER BY fts_score ASC LIMIT ?`;
    params.push(matchQuery);
    const filteredParams = [...params];
    for (const term of shortTerms) filteredParams.push(toLikePattern(term));
    filteredParams.push(limit);
    let rows = this.db.prepare(matchSql).all(...filteredParams);
    if (rows.length === 0 && shortTerms.length > 0) {
      params.push(limit);
      rows = this.db.prepare(relaxedSql).all(...params);
    }
    const hits = rows.map((row) => ({ ...rowToChunk(row), score: normalizeBm252(-row.fts_score) }));
    return { total, hits };
  }
  async vector(embedding, baseIds, limit, docIds) {
    const scope = [...baseIds];
    if (scope.length === 0) return { total: 0, hits: [] };
    const query = embedding.length > 0 ? Float32Array.from(embedding) : null;
    const docFilter = docIds !== void 0 && docIds.length > 0 ? new Set(docIds) : void 0;
    const scored = [];
    let total = 0;
    for (const baseId of scope) {
      for (const entry of this.ensureVectorCache(baseId)) {
        if (docFilter !== void 0 && !docFilter.has(entry.docId)) continue;
        total += 1;
        if (query === null || entry.vector.length !== query.length) continue;
        scored.push({ ...rowToChunk(entry.row), score: cosineFloat32(query, entry.vector) });
      }
    }
    scored.sort((a, b) => b.score - a.score);
    return { total, hits: scored.slice(0, limit) };
  }
  /** Lazy-load a base's vectors into the cache (SQL once, then in-memory). */
  ensureVectorCache(baseId) {
    const cached = this.vectorCache.get(baseId);
    if (cached !== void 0) return cached;
    const rows = this.db.prepare(
      `SELECT ${_ChunkDatabase.SELECT_COLUMNS} FROM chunk WHERE base_id = ? AND embedding IS NOT NULL`
    ).all(baseId);
    const entries = rows.map((row) => {
      const vector = decodeEmbeddingFloat32(row.embedding);
      return vector !== void 0 ? { id: row.chunk_id, docId: row.doc_id, vector, row } : void 0;
    }).filter((entry) => entry !== void 0);
    this.vectorCache.set(baseId, entries);
    return entries;
  }
  /** Rebuild one base's cache entry for a chunk after a write. */
  upsertVectorCache(chunk) {
    const list = this.vectorCache.get(chunk.baseId);
    if (list === void 0) return;
    const index = list.findIndex((entry2) => entry2.id === chunk.id);
    if (chunk.embedding === void 0) {
      if (index >= 0) list.splice(index, 1);
      return;
    }
    const entry = { id: chunk.id, docId: chunk.docId, vector: Float32Array.from(chunk.embedding), row: toChunkRow(chunk) };
    if (index >= 0) list[index] = entry;
    else list.push(entry);
  }
  /** Drop a document's cached vectors (delete path). */
  dropVectorCacheByDoc(docId) {
    for (const list of this.vectorCache.values()) {
      for (let i = list.length - 1; i >= 0; i -= 1) {
        if (list[i].docId === docId) list.splice(i, 1);
      }
    }
  }
  close() {
    this.db.close();
  }
};
function rowToChunk(row) {
  const chunk = {
    id: row.chunk_id,
    docId: row.doc_id,
    baseId: row.base_id,
    index: row.idx,
    text: row.text,
    ...row.heading !== null ? { heading: row.heading } : {},
    ...row.context !== null ? { context: row.context } : {}
  };
  const embedding = decodeEmbedding(row.embedding);
  return {
    ...chunk,
    ...embedding !== void 0 ? { embedding } : {},
    ...row.embedding_model !== null ? { embeddingModel: row.embedding_model } : {}
  };
}
function searchTextOf(chunk) {
  return chunk.context !== void 0 && chunk.context.length > 0 ? `${chunk.context}
${chunk.text}` : chunk.text;
}
function normalizeBm252(raw) {
  return raw / (raw + 1);
}
async function migrateLegacyChunkFile(jsonPath, db, log) {
  if (db.size > 0) return 0;
  let raw;
  try {
    raw = await readFile(jsonPath, "utf8");
  } catch {
    return 0;
  }
  let document;
  try {
    document = JSON.parse(raw);
  } catch (error) {
    log(`dsh-knowledge: legacy chunk file is not valid JSON, skipping migration: ${error instanceof Error ? error.message : String(error)}`);
    return 0;
  }
  const chunks = document.tables?.chunks;
  if (typeof chunks !== "object" || chunks === null || Array.isArray(chunks)) return 0;
  const byDoc = /* @__PURE__ */ new Map();
  for (const [key, value] of Object.entries(chunks)) {
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      byDoc.set(key, [...byDoc.get(key) ?? [], ...value]);
    } else if (typeof value === "object" && value !== null) {
      const chunk = value;
      const list = byDoc.get(chunk.docId) ?? [];
      list.push(chunk);
      byDoc.set(chunk.docId, list);
    }
  }
  for (const [docId, list] of byDoc) {
    const byId = /* @__PURE__ */ new Map();
    for (const chunk of list) byId.set(chunk.id, chunk);
    db.putChunks([...byId.values()].sort((a, b) => a.index - b.index));
  }
  if (byDoc.size > 0) log(`dsh-knowledge: migrated ${byDoc.size} documents' chunks to the SQLite store`);
  return byDoc.size;
}

// src/knowledge/store.ts
import { mkdir as mkdir2, readFile as readFile2, rm as rm3, writeFile as writeFile2 } from "node:fs/promises";
import { dirname as dirname3, join as join4 } from "node:path";

// src/knowledge/domain.ts
import { z } from "zod";
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";
var baseConfigSchema = z.object({
  embeddingProvider: z.enum(["openai", "ollama", "local", "none"]).optional(),
  embeddingBaseUrl: z.string().optional(),
  embeddingModel: z.string().optional(),
  embeddingApiKey: z.string().optional(),
  rerankModel: z.string().optional(),
  rerankBaseUrl: z.string().optional(),
  rerankApiKey: z.string().optional(),
  smartChunk: z.boolean().optional(),
  chunkSeparator: z.string().optional(),
  chunkSize: z.number().int().gt(0).optional(),
  chunkOverlap: z.number().int().gte(0).optional(),
  topK: z.number().int().gt(0).optional(),
  searchMode: z.enum(["auto", "hybrid", "vector", "lexical"]).optional(),
  similarityThreshold: z.number().gte(0).lte(1).optional(),
  mmrDiversity: z.number().gte(0).lte(1).optional(),
  rrfVectorWeight: z.number().gte(0.1).lte(5).optional(),
  embeddingBatchSize: z.number().int().gt(0).optional(),
  siblingChunks: z.number().int().gte(0).lte(3).optional(),
  // Mirrors BaseConfig: every base-settable field must survive the durable
  // boundary — a missing key here makes zod strip the override on save.
  documentProcessorProvider: z.enum(["builtin", "mineru"]).optional(),
  mineruApiKey: z.string().optional(),
  mineruApiHost: z.string().optional(),
  semanticChunk: z.boolean().optional(),
  semanticChunkThreshold: z.number().gte(0).lte(1).optional(),
  chunkTokenLimit: z.number().int().gte(0).optional(),
  conflictStrategy: z.enum(["keep", "replace", "rename"]).optional(),
  urlRefreshHours: z.number().int().gte(0).optional(),
  imageCaptionProvider: z.enum(["off", "openai", "ollama"]).optional(),
  imageCaptionModel: z.string().optional(),
  imageCaptionBaseUrl: z.string().optional(),
  imageCaptionApiKey: z.string().optional(),
  /** Re-run interrupted imports (re-embedding the missing batches) on startup; off = mark them failed instead (Cherry's posture). */
  resumeInterruptedOnStartup: z.boolean().optional()
});
var baseSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  group: z.string().optional(),
  config: baseConfigSchema.optional(),
  createdAt: z.number(),
  updatedAt: z.number()
});
var documentSchema = z.object({
  id: z.string(),
  baseId: z.string(),
  title: z.string(),
  sourceType: z.enum(["text", "file", "url", "directory"]),
  fileName: z.string().optional(),
  mimeType: z.string().optional(),
  url: z.string().optional(),
  parentDirectoryId: z.string().optional(),
  /** Absolute path of the source directory this container was imported from
   *  (Cherry's pathStorage): reindexing the container rescans the path and
   *  picks up new/removed files. Absent on legacy/created containers. */
  sourcePath: z.string().optional(),
  contentHash: z.string().optional(),
  rawFilePath: z.string().optional(),
  rawText: z.string().optional(),
  charCount: z.number().int().gte(0),
  tokenCount: z.number().int().gte(0).optional(),
  chunkCount: z.number().int().gte(0),
  incomplete: z.boolean().optional(),
  embeddingError: z.string().optional(),
  errorCode: z.enum(["interrupted", "dimension_mismatch", "parse_failed", "embedding_provider"]).optional(),
  createdAt: z.number(),
  updatedAt: z.number().optional()
});
var configOverridesSchema = z.object({
  embeddingProvider: z.enum(["openai", "ollama", "local", "none"]).optional(),
  embeddingBaseUrl: z.string().optional(),
  embeddingModel: z.string().optional(),
  embeddingApiKey: z.string().optional(),
  rerankModel: z.string().optional(),
  rerankBaseUrl: z.string().optional(),
  rerankApiKey: z.string().optional(),
  smartChunk: z.boolean().optional(),
  chunkSeparator: z.string().optional(),
  chunkSize: z.number().int().gt(0).optional(),
  chunkOverlap: z.number().int().gte(0).optional(),
  topK: z.number().int().gt(0).optional(),
  searchMode: z.enum(["auto", "hybrid", "vector", "lexical"]).optional(),
  similarityThreshold: z.number().gte(0).lte(1).optional(),
  mmrDiversity: z.number().gte(0).lte(1).optional(),
  rrfVectorWeight: z.number().gte(0.1).lte(5).optional(),
  embeddingBatchSize: z.number().int().gt(0).optional(),
  siblingChunks: z.number().int().gte(0).lte(3).optional(),
  hfEndpoint: z.string().optional(),
  documentProcessorProvider: z.enum(["builtin", "mineru"]).optional(),
  mineruApiKey: z.string().optional(),
  mineruApiHost: z.string().optional(),
  semanticChunk: z.boolean().optional(),
  semanticChunkThreshold: z.number().gte(0).lte(1).optional(),
  chunkTokenLimit: z.number().int().gte(0).optional(),
  conflictStrategy: z.enum(["keep", "replace", "rename"]).optional(),
  urlRefreshHours: z.number().int().gte(0).optional(),
  imageCaptionProvider: z.enum(["off", "openai", "ollama"]).optional(),
  imageCaptionModel: z.string().optional(),
  imageCaptionBaseUrl: z.string().optional(),
  imageCaptionApiKey: z.string().optional(),
  localModelCacheDir: z.string().optional()
});
var knowledgeDomainSpec = defineDomain({
  name: "knowledge",
  version: 0,
  global: {
    schema: z.object({
      overrides: configOverridesSchema,
      groups: z.array(z.string()).optional(),
      enabled: z.boolean().optional(),
      enabledBaseIds: z.array(z.string()).optional()
    }),
    initial: { overrides: {}, enabled: true, enabledBaseIds: [] }
  },
  tables: {
    bases: domainTable(baseSchema),
    documents: domainTable(documentSchema)
  }
});
var TABLES = {
  bases: "bases",
  documents: "documents",
  chunks: "chunks"
};

// src/knowledge/store.ts
var RawFileStorage = class {
  constructor(root) {
    this.root = root;
  }
  pathOf(relativePath) {
    const resolved = join4(this.root, relativePath);
    const rel = relativePath.replace(/\\/g, "/");
    if (rel === ".." || rel.startsWith("../") || rel.includes("/../") || resolved.startsWith(this.root) === false) {
      throw new Error(`unsafe raw file path: ${relativePath}`);
    }
    return resolved;
  }
  async write(baseId, docId, ext, bytes) {
    const relativePath = `${baseId}/${docId}${ext}`;
    const full = this.pathOf(relativePath);
    await mkdir2(dirname3(full), { recursive: true });
    await writeFile2(full, bytes);
    return relativePath;
  }
  async writeRel(baseId, relativePath, bytes) {
    const full = this.pathOf(`${baseId}/${relativePath.replace(/\\/g, "/")}`);
    await mkdir2(dirname3(full), { recursive: true });
    await writeFile2(full, bytes);
    return `${baseId}/${relativePath.replace(/\\/g, "/")}`;
  }
  async read(relativePath) {
    try {
      return await readFile2(this.pathOf(relativePath));
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }
  async delete(relativePath) {
    await rm3(this.pathOf(relativePath), { force: true });
  }
  async deleteBase(baseId) {
    await rm3(this.pathOf(baseId), { recursive: true, force: true });
  }
};
async function openStore(facility, options) {
  if (facility !== void 0) {
    try {
      const domain = await facility.open(knowledgeDomainSpec);
      const chunkStorePath = resolveChunkStorePath(options?.chunkStorePath);
      const chunkDb = new ChunkDatabase(chunkStorePath);
      await migrateLegacyChunkFile(options?.legacyJsonPath ?? legacyChunkFilePath(), chunkDb, (message) => console.warn(message));
      const raw = new RawFileStorage(join4(dirname3(chunkStorePath), "knowledge-raw"));
      const store = new DomainStore(domain, chunkDb, raw);
      const recovery = await store.recoverInterruptedImports(Date.now());
      if (recovery.removed > 0) console.warn(`dsh-knowledge: removed ${recovery.removed} incomplete import(s) left by an interrupted run`);
      await store.reconcileChunkCounts();
      return store;
    } catch (error) {
      console.warn(`dsh-knowledge: storage domain unavailable, using in-memory store: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return new MemoryStore();
}
var DomainStore = class {
  constructor(domain, chunkDb, rawStore) {
    this.domain = domain;
    this.chunkDb = chunkDb;
    this.rawStore = rawStore;
  }
  get bases() {
    return this.domain.table(TABLES.bases);
  }
  get documents() {
    return this.domain.table(TABLES.documents);
  }
  listBases() {
    return [...this.bases.entries()].map(([, value]) => value);
  }
  getBase(id) {
    return this.bases.get(id);
  }
  putBase(base) {
    return this.bases.put(base.id, base);
  }
  deleteBase(id) {
    return this.bases.delete(id).then(() => {
    });
  }
  listDocuments(baseId) {
    return [...this.documents.entries()].map(([, value]) => value).filter((doc) => doc.baseId === baseId);
  }
  getDocument(id) {
    return this.documents.get(id);
  }
  putDocument(doc) {
    return this.documents.put(doc.id, doc);
  }
  deleteDocument(id) {
    return this.documents.delete(id).then(() => {
    });
  }
  listChunks(baseId) {
    return this.chunkDb.listChunks(baseId);
  }
  listChunksByDoc(docId, limit, offset) {
    return this.chunkDb.listChunksByDoc(docId, limit, offset);
  }
  listChunksByIndexRange(docId, fromIdx, toIdx) {
    return this.chunkDb.listChunksByIndexRange(docId, fromIdx, toIdx);
  }
  async putChunks(chunks) {
    this.chunkDb.putChunks(chunks);
  }
  async putChunkBatch(chunks) {
    this.chunkDb.putChunkBatch(chunks);
  }
  async deleteChunks(docId, baseId) {
    this.chunkDb.deleteChunks(docId, baseId);
  }
  async deleteChunksByBase(baseId) {
    this.chunkDb.deleteChunksByBase(baseId);
  }
  listEmbeddingVectorsByHashes(hashes, embeddingModel) {
    return this.chunkDb.listEmbeddingVectorsByHashes(hashes, embeddingModel);
  }
  chunkCountsByDoc(baseIds) {
    return this.chunkDb.chunkCountsByDoc(baseIds);
  }
  async recoverInterruptedImports(startedAt) {
    const withChunks = /* @__PURE__ */ new Set();
    for (const base of this.listBases()) {
      for (const docId of this.chunkDb.docChunkStatus(base.id).withChunks) withChunks.add(docId);
    }
    let removed = 0;
    const resume = [];
    for (const [id, doc] of [...this.documents.entries()]) {
      if (doc.sourceType === "directory") continue;
      if (doc.incomplete === true) {
        if (doc.rawText !== void 0 || doc.rawFilePath !== void 0) resume.push(id);
        continue;
      }
      if (withChunks.has(id)) {
        continue;
      }
      if (doc.rawText !== void 0 || doc.rawFilePath !== void 0) {
        if ((doc.updatedAt ?? doc.createdAt) < startedAt) resume.push(id);
        continue;
      }
      if ((doc.updatedAt ?? doc.createdAt) >= startedAt) continue;
      await this.chunkDb.deleteChunks(id);
      await this.documents.delete(id);
      removed += 1;
    }
    return { removed, resume };
  }
  /**
   * Write back the actual chunk count onto document records whose `chunkCount`
   * drifted from the chunk store (historical stale metadata). Also the first
   * domain write after a legacy-format upgrade, which trims the JSON unit file.
   */
  async reconcileChunkCounts() {
    const actual = this.chunkCountsByDoc(this.listBases().map((base) => base.id));
    for (const [id, doc] of [...this.documents.entries()]) {
      if ((doc.chunkCount ?? 0) !== (actual.get(id) ?? 0)) {
        await this.documents.put(id, { ...doc, chunkCount: actual.get(id) ?? 0 });
      }
    }
  }
  docChunkStatus(baseId) {
    return this.chunkDb.docChunkStatus(baseId);
  }
  chunkStats(baseIds) {
    return this.chunkDb.chunkStats(baseIds);
  }
  get retrievalLane() {
    return this.chunkDb;
  }
  get raw() {
    return this.rawStore;
  }
  reclaimSpace() {
    return this.chunkDb.reclaimSpace();
  }
  getConfigOverrides() {
    return this.readGlobal().overrides;
  }
  async setConfigOverrides(overrides) {
    await this.writeGlobal({ overrides: { ...this.readGlobal().overrides, ...overrides } });
  }
  getGroups() {
    return this.readGlobal().groups;
  }
  async setGroups(groups) {
    await this.writeGlobal({ groups });
  }
  getEnabled() {
    return this.readGlobal().enabled;
  }
  async setEnabled(enabled) {
    await this.writeGlobal({ enabled });
  }
  getEnabledBaseIds() {
    return this.readGlobal().enabledBaseIds;
  }
  async setEnabledBaseIds(ids) {
    await this.writeGlobal({ enabledBaseIds: ids });
  }
  readGlobal() {
    const global = this.domain.global.get();
    return {
      overrides: global.overrides ?? {},
      groups: global.groups ?? [],
      enabled: global.enabled ?? true,
      enabledBaseIds: global.enabledBaseIds ?? []
    };
  }
  async writeGlobal(patch) {
    const current = this.readGlobal();
    await this.domain.global.set({ ...current, ...patch });
  }
  async close() {
    this.chunkDb.close();
    await this.domain.close();
  }
};
var MemoryStore = class {
  bases = /* @__PURE__ */ new Map();
  documents = /* @__PURE__ */ new Map();
  chunks = /* @__PURE__ */ new Map();
  overrides = {};
  groups = [];
  enabled = true;
  enabledBaseIds = [];
  listBases() {
    return [...this.bases.values()];
  }
  getBase(id) {
    return this.bases.get(id);
  }
  async putBase(base) {
    this.bases.set(base.id, base);
  }
  async deleteBase(id) {
    this.bases.delete(id);
  }
  listDocuments(baseId) {
    return [...this.documents.values()].filter((doc) => doc.baseId === baseId);
  }
  getDocument(id) {
    return this.documents.get(id);
  }
  async putDocument(doc) {
    this.documents.set(doc.id, doc);
  }
  async deleteDocument(id) {
    this.documents.delete(id);
  }
  listChunks(baseId) {
    return [...this.chunks.values()].filter((chunk) => chunk.baseId === baseId);
  }
  listChunksByDoc(docId, limit, offset) {
    const chunks = [...this.chunks.values()].filter((chunk) => chunk.docId === docId).sort((a, b) => a.index - b.index);
    const start = offset ?? 0;
    const count = limit ?? chunks.length;
    return chunks.slice(start, start + count);
  }
  listChunksByIndexRange(docId, fromIdx, toIdx) {
    return [...this.chunks.values()].filter((chunk) => chunk.docId === docId && chunk.index >= fromIdx && chunk.index <= toIdx).sort((a, b) => a.index - b.index);
  }
  async putChunks(chunks) {
    const docId = chunks.length > 0 ? chunks[0].docId : void 0;
    if (docId !== void 0) await this.deleteChunks(docId);
    for (const chunk of chunks) this.chunks.set(chunk.id, chunk);
  }
  async putChunkBatch(chunks) {
    for (const chunk of chunks) this.chunks.set(chunk.id, chunk);
  }
  async deleteChunks(docId, baseId) {
    for (const [id, chunk] of this.chunks) {
      if (chunk.docId === docId && (baseId === void 0 || chunk.baseId === baseId)) this.chunks.delete(id);
    }
  }
  async deleteChunksByBase(baseId) {
    for (const [id, chunk] of this.chunks) {
      if (chunk.baseId === baseId) this.chunks.delete(id);
    }
  }
  listEmbeddingVectorsByHashes(hashes, embeddingModel) {
    const wanted = new Set(hashes);
    const vectors = /* @__PURE__ */ new Map();
    for (const chunk of this.chunks.values()) {
      if (chunk.embedding === void 0 || chunk.embeddingModel !== embeddingModel) continue;
      const hash = hashEmbeddingText(searchTextOf(chunk));
      if (wanted.has(hash)) vectors.set(hash, chunk.embedding);
    }
    return vectors;
  }
  chunkCountsByDoc(baseIds) {
    const scope = new Set(baseIds);
    const counts = /* @__PURE__ */ new Map();
    for (const chunk of this.chunks.values()) {
      if (!scope.has(chunk.baseId)) continue;
      counts.set(chunk.docId, (counts.get(chunk.docId) ?? 0) + 1);
    }
    return counts;
  }
  async recoverInterruptedImports(startedAt) {
    const withChunks = /* @__PURE__ */ new Set();
    for (const chunk of this.chunks.values()) withChunks.add(chunk.docId);
    let removed = 0;
    const resume = [];
    for (const [id, doc] of [...this.documents.entries()]) {
      if (doc.sourceType === "directory") continue;
      if (doc.incomplete === true) {
        if (doc.rawText !== void 0 || doc.rawFilePath !== void 0) resume.push(id);
        continue;
      }
      if (withChunks.has(id)) continue;
      if (doc.rawText !== void 0 || doc.rawFilePath !== void 0) {
        if ((doc.updatedAt ?? doc.createdAt) < startedAt) resume.push(id);
        continue;
      }
      if ((doc.updatedAt ?? doc.createdAt) >= startedAt) continue;
      this.documents.delete(id);
      removed += 1;
    }
    return { removed, resume };
  }
  docChunkStatus(baseId) {
    const withChunks = /* @__PURE__ */ new Set();
    const missingEmbedding = /* @__PURE__ */ new Set();
    for (const chunk of this.chunks.values()) {
      if (chunk.baseId !== baseId) continue;
      withChunks.add(chunk.docId);
      if (chunk.embedding === void 0) missingEmbedding.add(chunk.docId);
    }
    return { withChunks, missingEmbedding };
  }
  chunkStats(baseIds) {
    const scope = new Set(baseIds);
    const modelCounts = /* @__PURE__ */ new Map();
    let count = 0;
    let embedded = false;
    let dimensions;
    for (const chunk of this.chunks.values()) {
      if (!scope.has(chunk.baseId)) continue;
      count += 1;
      if (chunk.embedding === void 0) continue;
      embedded = true;
      if (dimensions === void 0) dimensions = chunk.embedding.length;
      if (chunk.embeddingModel !== void 0) {
        const key = `${chunk.baseId}\0${chunk.embeddingModel}`;
        modelCounts.set(key, (modelCounts.get(key) ?? 0) + 1);
      }
    }
    return {
      count,
      embedded,
      ...dimensions !== void 0 ? { dimensions } : {},
      embeddingModelCounts: [...modelCounts.entries()].map(([key, countValue]) => {
        const [baseId, model] = key.split("\0");
        return { baseId, model, count: countValue };
      })
    };
  }
  getConfigOverrides() {
    return { ...this.overrides };
  }
  async setConfigOverrides(overrides) {
    this.overrides = { ...this.overrides, ...overrides };
  }
  getGroups() {
    return [...this.groups];
  }
  async setGroups(groups) {
    this.groups = [...groups];
  }
  getEnabled() {
    return this.enabled;
  }
  async setEnabled(enabled) {
    this.enabled = enabled;
  }
  getEnabledBaseIds() {
    return [...this.enabledBaseIds];
  }
  async setEnabledBaseIds(ids) {
    this.enabledBaseIds = [...ids];
  }
  async close() {
  }
};

// src/knowledge/ollama.ts
init_net();
var ollamaPullStatus = /* @__PURE__ */ new Map();
var ollamaPullInFlight = /* @__PURE__ */ new Map();
var ollamaPullAborts = /* @__PURE__ */ new Map();
var PULL_TIMEOUT_MS = 6 * 60 * 6e4;
function getOllamaPullStatus(model) {
  return ollamaPullStatus.get(model) ?? { status: "idle", progress: 0, message: "" };
}
function ollamaBase(baseUrl) {
  return (baseUrl.trim() === "" ? "http://127.0.0.1:11434" : baseUrl.trim()).replace(/\/+$/, "");
}
async function listOllamaModels(baseUrl) {
  const response = await httpFetch(`${ollamaBase(baseUrl)}/api/tags`, { timeoutMs: 3e4 });
  if (!response.ok) throw new Error(`ollama tags failed: HTTP ${response.status}`);
  const json = await response.json();
  return (json.models ?? []).map((model) => ({
    name: model.name ?? "",
    ...typeof model.size === "number" && model.size > 0 ? { size: model.size } : {}
  })).filter((model) => model.name !== "");
}
async function deleteOllamaModel(model, baseUrl) {
  const response = await httpFetch(`${ollamaBase(baseUrl)}/api/delete`, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model }),
    timeoutMs: 12e4
  });
  if (!response.ok) {
    throw new Error(`ollama delete failed: HTTP ${response.status} ${(await response.text()).slice(0, 200)}`);
  }
}
async function pullOllamaModel(model, baseUrl) {
  const existing = ollamaPullInFlight.get(model);
  if (existing !== void 0) return existing;
  const run = (async () => {
    ollamaPullStatus.set(model, { status: "pulling", progress: 0, message: "" });
    const controller = new AbortController();
    ollamaPullAborts.set(model, controller);
    let timedOut = false;
    const watchdog = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, PULL_TIMEOUT_MS);
    try {
      const response = await fetch(`${ollamaBase(baseUrl)}/api/pull`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, stream: true }),
        signal: controller.signal
      });
      if (!response.ok) {
        throw new Error(`ollama pull failed: HTTP ${response.status} ${(await response.text()).slice(0, 200)}`);
      }
      const decoder = new TextDecoder();
      let buffer = "";
      for await (const chunk of response.body) {
        buffer += decoder.decode(chunk, { stream: true });
        if (buffer.length > 1e6) buffer = buffer.slice(-65536);
        let newline = buffer.indexOf("\n");
        while (newline >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (line === "") {
            newline = buffer.indexOf("\n");
            continue;
          }
          try {
            const event = JSON.parse(line);
            if (event.status === "success" || event.status === "ready") {
              ollamaPullStatus.set(model, { status: "ready", progress: 100, message: "" });
            } else if (typeof event.total === "number" && event.total > 0) {
              const progress = Math.min(100, Math.round((event.completed ?? 0) / event.total * 100));
              ollamaPullStatus.set(model, { status: "pulling", progress, message: event.status ?? "" });
            } else if (event.status !== void 0) {
              ollamaPullStatus.set(model, { status: "pulling", progress: 0, message: event.status });
            }
          } catch {
          }
          newline = buffer.indexOf("\n");
        }
      }
      const current = ollamaPullStatus.get(model);
      if (current?.status !== "ready") {
        ollamaPullStatus.set(model, { status: "ready", progress: 100, message: "" });
      }
    } catch (error) {
      const aborted = controller.signal.aborted;
      ollamaPullStatus.set(model, {
        status: timedOut ? "error" : aborted ? "idle" : "error",
        progress: 0,
        message: timedOut ? "pull timed out" : aborted ? "" : error instanceof Error ? error.message : String(error)
      });
      if (aborted || timedOut) return;
      throw error;
    } finally {
      clearTimeout(watchdog);
      ollamaPullAborts.delete(model);
    }
  })();
  ollamaPullInFlight.set(model, run);
  void run.finally(() => {
    ollamaPullInFlight.delete(model);
  }).catch(() => {
  });
  return run;
}
function cancelOllamaPull(model) {
  const controller = ollamaPullAborts.get(model);
  ollamaPullStatus.set(model, { status: "idle", progress: 0, message: "" });
  controller?.abort();
}
function activeOllamaPulls() {
  const pulls = [];
  for (const [model, status] of ollamaPullStatus) {
    if (status.status === "pulling") pulls.push({ model, ...status });
  }
  return pulls;
}

// src/knowledge/index.ts
init_embed();
var MODEL_SUGGESTIONS = {
  embedding: [
    "text-embedding-3-small",
    "text-embedding-3-large",
    "text-embedding-ada-002",
    "bge-m3",
    "bge-large-zh-v1.5",
    "bge-small-zh-v1.5",
    "nomic-embed-text",
    "mxbai-embed-large",
    "snowflake-arctic-embed2"
  ],
  // Local models mirror the shipped registry (localModels.ts) — every entry is
  // a real, downloadable transformers.js ONNX repo with a known pooling rule.
  local: LOCAL_MODELS.map((model) => model.id),
  rerank: [
    "jina-reranker-v2-base-multilingual",
    "BAAI/bge-reranker-v2-m3",
    "bge-reranker-base",
    "bce-reranker-base_v1",
    // Local cross-encoder: download it in Settings → Local Models, then use
    // the `local:` prefix (e.g. `local:Xenova/bge-reranker-base`).
    "local:Xenova/bge-reranker-base"
  ],
  // Ollama registry recommendations (embedding + vision), mirroring the local
  // model registry posture: real, downloadable model names for the Ollama API.
  ollamaEmbedding: [
    "nomic-embed-text",
    "bge-m3",
    "qwen3-embedding:0.6b",
    "mxbai-embed-large",
    "snowflake-arctic-embed"
  ],
  ollamaVision: [
    "llava",
    "qwen2.5vl:7b",
    "llama3.2-vision:11b",
    "minicpm-v:8b"
  ]
};
var LANE_CANDIDATE_CAP = 200;
var CONCEPT_READ_MAX_CHARS = 2e4;
var CONCEPT_GREP_SNIPPET_PAD = 60;
var CONCEPT_GREP_MAX_LINE_CHARS = 2e3;
var PROGRESS_LINGER_TTL_MS = 6e4;
var EMBED_MAX_ATTEMPTS = 3;
var EMBED_RETRY_BASE_DELAY_MS = 1e3;
var EMBED_RETRY_MAX_DELAY_MS = 3e4;
var ConflictError = class extends Error {
  code = "conflict";
};
var KnowledgeService = class _KnowledgeService extends Service {
  static inject = ["webServer"];
  static Config = Config;
  baseConfig;
  store;
  storeReady;
  resolveStore = () => {
  };
  jobs = /* @__PURE__ */ new Map();
  indexing = /* @__PURE__ */ new Map();
  /**
   * Progress values that linger after a job exits (Cherry's 60s TTL), so the
   * list keeps showing the final percentage until the poll observes the
   * terminal status instead of blanking mid-frame. Purely a display aid —
   * every guard still consults {@link indexing}, never this map.
   */
  progressLinger = /* @__PURE__ */ new Map();
  // Cherry Studio parity: per-base worker pool (Cherry's knowledge jobs run at
  // defaultConcurrency 5 on a per-base queue). Rows are created up front and
  // flip status as the queued parse+ingest tasks run in the background.
  ingestQueues = /* @__PURE__ */ new Map();
  // Per-base write chain guarding dedup-check + first persist (read-then-write),
  // so two concurrent imports of identical content cannot both pass the check.
  baseWriteChains = /* @__PURE__ */ new Map();
  constructor(ctx, config) {
    super(ctx, "knowledge");
    this.baseConfig = config;
    this.storeReady = new Promise((resolve4) => {
      this.resolveStore = resolve4;
    });
    ctx.effect(() => ctx.webServer.register(knowledgeRoute(this)), "knowledge: /knowledge route");
  }
  async [Service.init]() {
    setLocalModelCacheDir(this.baseConfig.localModelCacheDir);
    setHfEndpoint(this.baseConfig.hfEndpoint);
    const facility = this.ctx.get("storageDomain");
    this.store = await openStore(facility, { chunkStorePath: this.baseConfig.chunkStorePath });
    this.resolveStore();
    const store = this.store;
    const resolved = this.getConfig();
    setHfEndpoint(resolved.hfEndpoint);
    setLocalModelCacheDir(resolved.localModelCacheDir);
    this.ctx.effect(() => async () => {
      await store.close();
    }, "knowledge: close store");
    this.ctx.effect(() => () => {
      void disposeLocalModelWorker();
    }, "knowledge: dispose local model worker");
    this.ctx.effect(() => () => {
      void disposeOcrWorker();
    }, "knowledge: dispose OCR worker");
    const resume = store.recoverInterruptedImports(Date.now()).then(async ({ resume: resumeIds }) => {
      if (resumeIds.length === 0) return;
      if (!this.getConfig().resumeInterruptedOnStartup) {
        const reason = "import was interrupted by a shutdown; reindex to resume";
        for (const id of resumeIds) {
          const doc = store.getDocument(id);
          if (doc !== void 0) {
            await store.putDocument({ ...doc, embeddingError: reason, errorCode: "interrupted", updatedAt: Date.now() });
          }
        }
        this.ctx.logger.info(`knowledge: marked ${resumeIds.length} interrupted import(s) failed (auto-resume disabled)`);
        return;
      }
      this.ctx.logger.info(`knowledge: resuming ${resumeIds.length} interrupted import(s)`);
      void this.resumeInterruptedDocuments(resumeIds);
    });
    void resume.catch((error) => this.ctx.logger.warn(`knowledge: interrupted-import recovery failed: ${error instanceof Error ? error.message : String(error)}`));
    this.armUrlRefreshTimer();
  }
  // ── scheduled URL refresh (Cherry's snapshot + manual refresh, automated) ──
  urlRefreshTimer = null;
  urlRefreshing = false;
  /** Arm the hourly sweep that refreshes URL documents older than `urlRefreshHours`. */
  armUrlRefreshTimer() {
    const hours = this.getConfigFor(void 0).urlRefreshHours;
    if (hours <= 0) return;
    const run = () => {
      if (this.urlRefreshing) return;
      this.urlRefreshing = true;
      void this.refreshStaleUrls(hours).catch((error) => {
        this.ctx.logger.warn(`knowledge: URL refresh sweep failed: ${error instanceof Error ? error.message : String(error)}`);
      }).finally(() => {
        this.urlRefreshing = false;
      });
    };
    const first = setTimeout(run, 5 * 6e4);
    first.unref?.();
    this.urlRefreshTimer = setInterval(run, 60 * 6e4);
    this.urlRefreshTimer.unref?.();
    this.ctx.effect(() => () => {
      clearTimeout(first);
      if (this.urlRefreshTimer !== null) clearInterval(this.urlRefreshTimer);
    }, "knowledge: URL refresh timer");
  }
  /** Re-fetch every URL document whose last update predates `hours`; failures are logged, never thrown. */
  async refreshStaleUrls(hours) {
    const store = this.requireStore();
    const cutoff = Date.now() - hours * 36e5;
    const stale = [];
    for (const base of store.listBases()) {
      for (const doc of store.listDocuments(base.id)) {
        if (doc.sourceType === "url" && doc.url !== void 0 && (doc.updatedAt ?? 0) < cutoff) stale.push(doc.id);
      }
    }
    for (const id of stale) {
      try {
        const result = await this.refreshUrlDocument(id);
        if (result.changed) this.ctx.logger.info(`knowledge: URL auto-refreshed: ${result.title}`);
      } catch (error) {
        this.ctx.logger.warn(`knowledge: URL auto-refresh failed for ${id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  /**
   * Re-index documents a crash left mid-import. Each document holds rawText
   * and/or a persisted raw source file; hash reuse (decision A4) makes the
   * re-embed re-embed only missing batches. A placeholder that only has the
   * raw file (crash before/during parse) is re-parsed from source. Runs in
   * the background so startup is not blocked.
   */
  async resumeInterruptedDocuments(ids) {
    const store = this.requireStore();
    for (const id of ids) {
      const doc = store.getDocument(id);
      if (doc === void 0 || doc.sourceType === "directory") continue;
      try {
        if (doc.rawFilePath !== void 0 && doc.rawText === void 0) {
          const bytes = await store.raw?.read(doc.rawFilePath);
          if (bytes === null || bytes === void 0 || bytes.byteLength === 0) {
            this.ctx.logger.warn(`knowledge: raw source missing for interrupted import "${doc.title}", dropping it`);
            await store.deleteDocument(id);
            continue;
          }
          const text = await parseDocumentBuffer(bytes, doc.fileName ?? doc.title, doc.mimeType);
          if (text.trim().length === 0) throw new Error("parsed document is empty");
          await this.ingestDocument({
            baseId: doc.baseId,
            title: doc.title,
            sourceType: "file",
            ...doc.fileName !== void 0 ? { fileName: doc.fileName } : {},
            ...doc.mimeType !== void 0 ? { mimeType: doc.mimeType } : {},
            ...doc.parentDirectoryId !== void 0 ? { parentDirectoryId: doc.parentDirectoryId } : {},
            placeholderId: doc.id,
            rawFilePath: doc.rawFilePath,
            text
          });
        } else {
          await this.reindexDocument(id);
        }
      } catch (error) {
        this.ctx.logger.warn(`knowledge: resume of interrupted import failed for "${doc.title}": ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  /** Wait until the durable store is ready; the HTTP route awaits this. */
  async whenReady() {
    await this.storeReady;
  }
  // ── configuration ─────────────────────────────────────────────────────────
  getConfig() {
    return resolveConfig(this.baseConfig, this.requireStore().getConfigOverrides());
  }
  /** Static model-id suggestions for the settings comboboxes. */
  modelSuggestions() {
    return MODEL_SUGGESTIONS;
  }
  /** Resolve one base's effective config (global + that base's overrides). */
  getConfigFor(baseId) {
    const store = this.requireStore();
    if (baseId !== void 0) {
      const base = store.getBase(baseId);
      if (base !== void 0) {
        return resolveConfigFor(this.baseConfig, store.getConfigOverrides(), base.config);
      }
    }
    return this.getConfig();
  }
  async setConfig(overrides) {
    await this.requireStore().setConfigOverrides(overrides);
    const resolved = this.getConfig();
    setHfEndpoint(resolved.hfEndpoint);
    setLocalModelCacheDir(resolved.localModelCacheDir);
    return resolved;
  }
  // ── invocation toggle ─────────────────────────────────────────────────────
  isEnabled() {
    return this.requireStore().getEnabled();
  }
  async setEnabled(enabled) {
    await this.requireStore().setEnabled(enabled);
  }
  getEnabledBaseIds() {
    return this.requireStore().getEnabledBaseIds();
  }
  async setEnabledBaseIds(ids) {
    await this.requireStore().setEnabledBaseIds([...new Set(ids)]);
  }
  /**
   * Resolve the effective search scope for a model call: the enabled base ids,
   * or `undefined` when none are pinned (meaning "every base", Cherry's no-binding case).
   */
  enabledScope() {
    const store = this.requireStore();
    const ids = store.getEnabledBaseIds();
    if (ids.length === 0) return void 0;
    const existing = new Set(store.listBases().map((base) => base.id));
    const valid = ids.filter((id) => existing.has(id));
    return valid.length > 0 ? valid : void 0;
  }
  // ── bases ─────────────────────────────────────────────────────────────────
  async createBase(request) {
    const name = request.name.trim();
    if (name.length === 0) throw new Error("base name is required");
    const now = Date.now();
    const store = this.requireStore();
    const group = request.group?.trim();
    if (group !== void 0 && group.length > 0 && !store.getGroups().includes(group)) {
      await store.setGroups([...store.getGroups(), group]);
    }
    const base = {
      id: crypto.randomUUID(),
      name,
      description: request.description?.trim() ?? "",
      ...group !== void 0 && group.length > 0 ? { group } : {},
      ...request.config !== void 0 ? { config: compactBaseConfig(request.config) } : {},
      createdAt: now,
      updatedAt: now
    };
    await store.putBase(base);
    return base;
  }
  /** Cherry-style restore: re-embed every source document into a fresh base
   *  (with the source's current config), returning the new base. Raw source
   *  files are copied across so the restored base keeps the rebuild source. */
  async restoreBase(sourceBaseId, name, config) {
    const store = this.requireStore();
    const source = store.getBase(sourceBaseId);
    if (source === void 0) throw new Error(`knowledge base not found: ${sourceBaseId}`);
    const base = await this.createBase({
      name: name.trim() || `${source.name} (\u6062\u590D)`,
      description: source.description,
      group: source.group,
      config: config ?? source.config
    });
    for (const doc of store.listDocuments(sourceBaseId)) {
      if (doc.sourceType === "directory") continue;
      const text = doc.rawText ?? reconstructFromChunks(store.listChunksByDoc(doc.id));
      if (text.trim().length === 0) continue;
      let rawFilePath;
      if (store.raw !== void 0 && doc.rawFilePath !== void 0) {
        const raw = await store.raw.read(doc.rawFilePath);
        if (raw !== null) {
          const ext = rawExtensionOf(doc.rawFilePath);
          rawFilePath = await store.raw.write(base.id, crypto.randomUUID(), ext, raw);
        }
      }
      await this.ingestDocument({
        baseId: base.id,
        title: doc.title,
        sourceType: doc.sourceType,
        ...doc.fileName !== void 0 ? { fileName: doc.fileName } : {},
        ...doc.mimeType !== void 0 ? { mimeType: doc.mimeType } : {},
        ...doc.url !== void 0 ? { url: doc.url } : {},
        ...rawFilePath !== void 0 ? { rawFilePath } : {},
        text
      });
    }
    return base;
  }
  async deleteBase(id) {
    const store = this.requireStore();
    if (store.getBase(id) === void 0) throw new Error(`knowledge base not found: ${id}`);
    for (const [docId, active] of [...this.indexing]) {
      if (active.baseId === id) {
        active.controller?.abort();
        this.indexing.delete(docId);
      }
    }
    await store.deleteChunksByBase(id);
    await store.raw?.deleteBase(id);
    await store.deleteBase(id);
    this.reclaimAfterDelete();
    const enabled = store.getEnabledBaseIds();
    if (enabled.includes(id)) await store.setEnabledBaseIds(enabled.filter((x) => x !== id));
  }
  async renameBase(id, request) {
    const store = this.requireStore();
    const existing = store.getBase(id);
    if (existing === void 0) throw new Error(`knowledge base not found: ${id}`);
    const next = {
      ...existing,
      name: request.name?.trim() || existing.name,
      description: request.description?.trim() ?? existing.description,
      ...request.group !== void 0 && request.group !== null ? { group: request.group.trim().length > 0 ? request.group.trim() : void 0 } : {},
      ...request.config !== void 0 ? { config: mergeBaseConfig(existing.config, request.config) } : {},
      updatedAt: Date.now()
    };
    const nextGroup = next.group;
    if (nextGroup !== void 0 && !store.getGroups().includes(nextGroup)) {
      await store.setGroups([...store.getGroups(), nextGroup]);
    }
    const patch = request.config;
    if (patch !== void 0) {
      const oldConfig = this.getConfigFor(id);
      const newConfig = resolveConfigFor(this.baseConfig, store.getConfigOverrides(), next.config);
      const modelChanged = newConfig.embeddingProvider !== oldConfig.embeddingProvider || newConfig.embeddingModel !== oldConfig.embeddingModel;
      if (modelChanged && store.listDocuments(id).length > 0) {
        const hadModel = oldConfig.embeddingProvider !== "none" && oldConfig.embeddingModel.trim() !== "";
        if (hadModel) {
          throw new Error("\u5207\u6362\u5D4C\u5165\u6A21\u578B\u4F1A\u4F7F\u5DF2\u6709\u5411\u91CF\u5168\u90E8\u5931\u6548\u2014\u2014\u8BF7\u4F7F\u7528\u300C\u91CD\u5EFA\u77E5\u8BC6\u5E93\u300D\u4EE5\u65B0\u6A21\u578B\u91CD\u5EFA\uFF08Cherry Studio \u8BED\u4E49\uFF09");
        }
        if (this.indexing.size > 0) {
          throw new Error("\u6709\u6587\u6863\u6B63\u5728\u5904\u7406\u4E2D\u2014\u2014\u8BF7\u7B49\u5F85\u5BFC\u5165/\u91CD\u5EFA\u5B8C\u6210\u540E\u518D\u542F\u7528\u5D4C\u5165\u6A21\u578B\uFF08Cherry Studio \u8BED\u4E49\uFF09");
        }
        const documents = store.listDocuments(id);
        const sourceLess = documents.some((doc) => doc.sourceType !== "directory" && doc.rawText === void 0 && doc.rawFilePath === void 0);
        if (sourceLess) {
          throw new Error("\u5B58\u5728\u65E0\u6E90\u6587\u672C\u7684\u6587\u6863\uFF0C\u65E0\u6CD5\u56DE\u586B\u5411\u91CF\u2014\u2014\u8BF7\u5220\u9664\u540E\u91CD\u65B0\u6DFB\u52A0\uFF08Cherry Studio \u8BED\u4E49\uFF09");
        }
        await store.putBase(next);
        const baseId = id;
        void this.reindexBase(baseId).catch((error) => {
          this.ctx.logger.warn(`knowledge: in-place embedding backfill failed: ${error instanceof Error ? error.message : String(error)}`);
        });
        return next;
      }
    }
    await store.putBase(next);
    return next;
  }
  listBases() {
    const store = this.requireStore();
    return store.listBases().map((base) => {
      const documents = store.listDocuments(base.id);
      const chunkCount = documents.reduce((sum, doc) => sum + doc.chunkCount, 0);
      const charCount = documents.reduce((sum, doc) => sum + doc.charCount, 0);
      const tokenCount = documents.reduce((sum, doc) => sum + (doc.tokenCount ?? 0), 0);
      return {
        id: base.id,
        name: base.name,
        description: base.description,
        ...base.group !== void 0 ? { group: base.group } : {},
        documentCount: documents.length,
        chunkCount,
        charCount,
        tokenCount,
        ...base.config !== void 0 ? { config: base.config } : {},
        createdAt: base.createdAt,
        updatedAt: base.updatedAt
      };
    });
  }
  // ── groups ────────────────────────────────────────────────────────────────
  listGroups() {
    return [...this.requireStore().getGroups()].sort((a, b) => a.localeCompare(b));
  }
  async createGroup(name) {
    const store = this.requireStore();
    const trimmed = name.trim();
    if (trimmed.length === 0) throw new Error("group name is required");
    const groups = new Set(store.getGroups());
    if (groups.has(trimmed)) throw new Error(`group "${trimmed}" already exists`);
    groups.add(trimmed);
    await store.setGroups([...groups]);
    return [...groups].sort((a, b) => a.localeCompare(b));
  }
  async renameGroup(from2, to) {
    const store = this.requireStore();
    const trimmed = to.trim();
    if (trimmed.length === 0) throw new Error("group name is required");
    const groups = new Set(store.getGroups());
    if (!groups.has(from2)) throw new Error(`group "${from2}" does not exist`);
    if (groups.has(trimmed) && from2 !== trimmed) throw new Error(`group "${trimmed}" already exists`);
    groups.delete(from2);
    groups.add(trimmed);
    for (const base of store.listBases()) {
      if (base.group === from2) await store.putBase({ ...base, group: trimmed, updatedAt: Date.now() });
    }
    await store.setGroups([...groups]);
    return [...groups].sort((a, b) => a.localeCompare(b));
  }
  async deleteGroup(name) {
    const store = this.requireStore();
    const groups = store.getGroups().filter((group) => group !== name);
    await store.setGroups(groups);
    for (const base of store.listBases()) {
      if (base.group === name) await store.putBase({ ...base, group: void 0, updatedAt: Date.now() });
    }
  }
  // ── documents ─────────────────────────────────────────────────────────────
  async addTextDocument(request) {
    const store = this.requireStore();
    if (store.getBase(request.baseId) === void 0) throw new Error(`knowledge base not found: ${request.baseId}`);
    if (request.content.trim().length === 0) throw new Error("document content is empty");
    return this.ingestDocument({
      baseId: request.baseId,
      title: request.title.trim(),
      sourceType: "text",
      ...request.parentDirectoryId !== void 0 ? { parentDirectoryId: request.parentDirectoryId } : {},
      text: request.content
    });
  }
  async addFileDocument(request) {
    const store = this.requireStore();
    if (store.getBase(request.baseId) === void 0) throw new Error(`knowledge base not found: ${request.baseId}`);
    if (!SUPPORTED_DOCUMENT_EXTENSION_SET.has(extensionOf(request.fileName))) {
      throw new Error(`Unsupported knowledge file type: ${request.fileName}`);
    }
    let fileName = request.fileName;
    let title = request.title?.trim() || request.fileName;
    const lockResult = await this.withBaseWriteLock(request.baseId, async () => {
      const conflictStrategyNow = request.conflict ?? this.getConfigFor(request.baseId).conflictStrategy;
      if (conflictStrategyNow === "keep") {
        const existing = store.listDocuments(request.baseId).find((doc) => doc.fileName === request.fileName);
        if (existing !== void 0) {
          return { skippedDoc: existing };
        }
      } else {
        const existing = store.listDocuments(request.baseId).find((doc) => doc.fileName === request.fileName);
        if (existing !== void 0) {
          if (conflictStrategyNow === "replace") {
            await store.deleteChunks(existing.id, request.baseId);
            if (existing.rawFilePath !== void 0) await store.raw?.delete(existing.rawFilePath);
            await store.deleteDocument(existing.id);
          } else if (conflictStrategyNow === "detect") {
            throw new ConflictError(`same-name document exists: ${request.fileName} (id ${existing.id}) \u2014 re-upload with conflict=replace or conflict=rename`);
          }
        }
      }
      let resolvedFileName2 = request.fileName;
      let resolvedTitle2 = request.title?.trim() || request.fileName;
      if (conflictStrategyNow === "rename") {
        const taken = new Set(store.listDocuments(request.baseId).map((doc) => doc.fileName));
        let candidate = resolvedFileName2;
        let counter = 1;
        while (taken.has(candidate)) {
          const dot = resolvedFileName2.lastIndexOf(".");
          const base = dot > 0 ? resolvedFileName2.slice(0, dot) : resolvedFileName2;
          const ext = dot > 0 ? resolvedFileName2.slice(dot) : "";
          candidate = `${base}_${counter}${ext}`;
          counter += 1;
        }
        if (candidate !== resolvedFileName2) {
          resolvedFileName2 = candidate;
          resolvedTitle2 = request.title !== void 0 ? `${request.title.trim()}_${counter - 1}` : candidate;
        }
      }
      const newDocId = crypto.randomUUID();
      const placeholder = {
        id: newDocId,
        baseId: request.baseId,
        title: resolvedTitle2,
        sourceType: "file",
        fileName: resolvedFileName2,
        ...request.mimeType !== void 0 ? { mimeType: request.mimeType } : {},
        ...request.parentDirectoryId !== void 0 ? { parentDirectoryId: request.parentDirectoryId } : {},
        charCount: 0,
        chunkCount: 0,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      const newRawFilePath = store.raw !== void 0 ? await store.raw.write(request.baseId, newDocId, safeRawExtension(resolvedFileName2), decodeBase64(request.contentBase64)) : void 0;
      const storedDoc = { ...placeholder, ...newRawFilePath !== void 0 ? { rawFilePath: newRawFilePath } : {} };
      await store.putDocument(storedDoc);
      return { fileName: resolvedFileName2, title: resolvedTitle2, docId: newDocId, rawFilePath: newRawFilePath, stored: storedDoc };
    });
    if ("skippedDoc" in lockResult) {
      const skipped = lockResult.skippedDoc;
      return { ...skipped, skipped: true };
    }
    const { fileName: resolvedFileName, title: resolvedTitle, docId, rawFilePath, stored } = lockResult;
    fileName = resolvedFileName;
    title = resolvedTitle;
    const taskController = new AbortController();
    this.indexing.set(docId, { baseId: request.baseId, title, phase: "parsing", total: 0, progress: 0, controller: taskController });
    const fallbackPayload = rawFilePath !== void 0 ? void 0 : request.contentBase64;
    this.enqueueIngest(request.baseId, async () => {
      try {
        let bytes = rawFilePath !== void 0 ? await store.raw?.read(rawFilePath) ?? null : null;
        if (bytes === null && fallbackPayload !== void 0) bytes = decodeBase64(fallbackPayload);
        if (bytes === null) throw new Error("raw copy is missing \u2014 cannot parse the file");
        const config = this.getConfigFor(request.baseId);
        let text = null;
        if (config.documentProcessorProvider === "mineru" && config.mineruApiKey.trim() !== "" && extensionOf(fileName) === "pdf") {
          try {
            const { extractPdfWithMineru: extractPdfWithMineru2 } = await Promise.resolve().then(() => (init_mineru(), mineru_exports));
            text = await extractPdfWithMineru2(bytes, fileName, {
              apiKey: config.mineruApiKey,
              apiHost: config.mineruApiHost
            }, taskController.signal);
          } catch (error) {
            this.ctx.logger.warn(`knowledge: mineru extract failed, falling back to local: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
        if (text === null) {
          text = await parseDocumentBuffer(bytes, fileName, request.mimeType);
        }
        if (text.trim().length === 0) throw new Error("parsed document is empty");
        if (extensionOf(fileName) === "pdf" && config.imageCaptionProvider !== "off") {
          try {
            const { captionPdfImages: captionPdfImages2 } = await Promise.resolve().then(() => (init_caption(), caption_exports));
            const captioned = await captionPdfImages2(bytes, {
              provider: config.imageCaptionProvider,
              model: config.imageCaptionModel,
              baseUrl: config.imageCaptionBaseUrl,
              apiKey: config.imageCaptionApiKey,
              embeddingBaseUrl: config.embeddingBaseUrl
            });
            if (captioned !== "") text = `${text}
${captioned}`;
          } catch (error) {
            this.ctx.logger.warn(`knowledge: captioning failed, importing text only: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
        await this.ingestDocument({
          baseId: request.baseId,
          title,
          sourceType: "file",
          fileName,
          ...request.mimeType !== void 0 ? { mimeType: request.mimeType } : {},
          ...request.parentDirectoryId !== void 0 ? { parentDirectoryId: request.parentDirectoryId } : {},
          placeholderId: docId,
          rawFilePath,
          text
        }, taskController.signal);
      } catch (error) {
        this.indexing.delete(docId);
        taskController.abort();
        const message = error instanceof Error ? error.message : String(error);
        const current = store.getDocument(docId);
        if (current === void 0 || store.getBase(request.baseId) === void 0) return;
        try {
          await store.putDocument({ ...current, embeddingError: message, errorCode: "parse_failed", updatedAt: Date.now() });
        } catch {
        }
      }
    });
    return stored;
  }
  /**
   * Batch file add with Cherry's server-authoritative conflict detection:
   * `conflict: 'detect'` reports every same-name collision (against existing
   * documents AND within the batch) without adding anything; `rename`/`replace`
   * add the whole batch under that strategy. The detect round may omit file
   * contents (names alone suffice); a clean detect returns `clean` so the
   * caller re-submits with contents under the rename strategy.
   */
  async addFiles(request) {
    const store = this.requireStore();
    if (store.getBase(request.baseId) === void 0) throw new Error(`knowledge base not found: ${request.baseId}`);
    for (const file of request.files) {
      if (!SUPPORTED_DOCUMENT_EXTENSION_SET.has(extensionOf(file.fileName))) {
        throw new Error(`Unsupported knowledge file type: ${file.fileName}`);
      }
    }
    const existingNames = new Set(
      store.listDocuments(request.baseId).filter((doc) => doc.sourceType === "file").map((doc) => doc.fileName)
    );
    const seen = /* @__PURE__ */ new Set();
    const conflicts = [];
    for (const file of request.files) {
      const name = file.fileName;
      if (existingNames.has(name) || seen.has(name)) conflicts.push(name);
      seen.add(name);
    }
    const uniqueConflicts = [...new Set(conflicts)];
    if (request.conflict === "detect") {
      if (uniqueConflicts.length > 0) return { status: "conflicts", conflicts: uniqueConflicts };
      if (request.files.some((file) => file.contentBase64 === void 0)) return { status: "clean" };
    }
    const strategy = request.conflict === "detect" ? "rename" : request.conflict;
    const accepted = [];
    for (const file of request.files) {
      const doc = await this.addFileDocument({
        baseId: request.baseId,
        fileName: file.fileName,
        ...file.mimeType !== void 0 ? { mimeType: file.mimeType } : {},
        ...request.parentDirectoryId !== void 0 ? { parentDirectoryId: request.parentDirectoryId } : {},
        contentBase64: file.contentBase64 ?? "",
        ...strategy !== void 0 ? { conflict: strategy } : {}
      });
      accepted.push({
        id: doc.id,
        title: doc.title,
        fileName: doc.fileName ?? doc.title,
        ...doc.skipped === true ? { skipped: true } : {}
      });
    }
    return { status: "added", accepted };
  }
  /** Start importing a local directory as a cancellable background job. */
  async importDirectory(request) {
    const store = this.requireStore();
    if (store.getBase(request.baseId) === void 0) throw new Error(`knowledge base not found: ${request.baseId}`);
    const files = await scanDirectory(request.path);
    const jobId = crypto.randomUUID();
    this.pruneJobs();
    this.jobs.set(jobId, {
      baseId: request.baseId,
      kind: "directory",
      cancelled: false,
      imported: 0,
      skipped: 0,
      total: files.length,
      current: "",
      errors: [],
      done: false
    });
    void this.runDirectoryImport(jobId, files);
    return { jobId, total: files.length };
  }
  /** Progress snapshot of an active (or just-finished) directory import. */
  directoryImportStatus(jobId) {
    return this.jobs.get(jobId);
  }
  cancelDirectoryImport(jobId) {
    const job = this.jobs.get(jobId);
    if (job !== void 0 && !job.done) job.cancelled = true;
  }
  async runDirectoryImport(jobId, files) {
    const job = this.jobs.get(jobId);
    if (job === void 0) return;
    for (const file of files) {
      if (job.cancelled) break;
      job.current = file;
      try {
        const buffer = await readFile3(file);
        const text = await parseDocumentBuffer(buffer, basename(file));
        if (text.trim().length === 0) {
          job.skipped += 1;
          continue;
        }
        let rawFilePath;
        const store = this.requireStore();
        if (store.raw !== void 0) {
          rawFilePath = await store.raw.writeRel(job.baseId, basename(file), buffer);
        }
        await this.ingestDocument({
          baseId: job.baseId,
          title: basename(file),
          sourceType: "file",
          fileName: basename(file),
          rawFilePath,
          text
        });
        job.imported += 1;
      } catch (error) {
        job.errors.push({ file, error: error instanceof Error ? error.message : String(error) });
      }
    }
    job.done = true;
    job.current = "";
  }
  pruneJobs() {
    if (this.jobs.size < 50) return;
    for (const [id, job] of this.jobs) {
      if (job.done) this.jobs.delete(id);
    }
  }
  /** Create a directory container item (no chunks) under an optional parent. */
  async createDirectory(baseId, title, parentDirectoryId) {
    const store = this.requireStore();
    const document = {
      id: crypto.randomUUID(),
      baseId,
      title: title.trim() || "directory",
      sourceType: "directory",
      ...parentDirectoryId !== void 0 ? { parentDirectoryId } : {},
      charCount: 0,
      chunkCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    await store.putDocument(document);
    await this.touchBase(baseId);
    return document;
  }
  /** Import a local directory as a nested tree of directory containers + file items. */
  async importDirectoryTree(baseId, path, parentDirectoryId) {
    const store = this.requireStore();
    const rootName = basename(path);
    const rootId = parentDirectoryId ?? (await this.createDirectory(baseId, rootName)).id;
    let imported = 0;
    let directories = 1;
    const errors = [];
    const recordSourcePath = async (containerId, source) => {
      const current = store.getDocument(containerId);
      if (current !== void 0) await store.putDocument({ ...current, sourcePath: source, updatedAt: Date.now() });
    };
    await recordSourcePath(rootId, path);
    const walk = async (dir, parentId, depth) => {
      if (depth > DIRECTORY_MAX_DEPTH) return;
      let entries;
      try {
        entries = await readdir2(dir, { withFileTypes: true });
      } catch (error) {
        errors.push({ file: dir, error: error instanceof Error ? error.message : String(error) });
        return;
      }
      for (const entry of entries) {
        const full = join5(dir, entry.name);
        if (entry.isDirectory()) {
          const child = await this.createDirectory(baseId, entry.name, parentId);
          await recordSourcePath(child.id, full);
          directories += 1;
          await walk(full, child.id, depth + 1);
        } else if (entry.isFile() && DIRECTORY_EXTENSIONS.has(extname2(entry.name).toLowerCase())) {
          try {
            const buffer = await readFile3(full);
            const text = await parseDocumentBuffer(buffer, basename(full));
            if (text.trim().length === 0) continue;
            let rawFilePath;
            if (store.raw !== void 0) {
              const relPath = relative(path, full).replace(/\\/g, "/");
              rawFilePath = await store.raw.writeRel(baseId, relPath, buffer);
            }
            await this.ingestDocument({
              baseId,
              title: basename(full),
              sourceType: "file",
              fileName: basename(full),
              parentDirectoryId: parentId,
              rawFilePath,
              text
            });
            imported += 1;
          } catch (error) {
            errors.push({ file: full, error: error instanceof Error ? error.message : String(error) });
          }
        }
      }
    };
    await walk(path, rootId, 0);
    return { imported, directories, errors };
  }
  async addUrlDocument(request) {
    const store = this.requireStore();
    if (store.getBase(request.baseId) === void 0) throw new Error(`knowledge base not found: ${request.baseId}`);
    const html = await fetchHtml(request.url);
    const extracted = await extractHtmlDocument(html);
    if (extracted.text.trim().length === 0) throw new Error("URL returned no extractable text");
    const docId = crypto.randomUUID();
    const title = request.title?.trim() || extracted.title || request.url;
    let rawFilePath;
    if (store.raw !== void 0) {
      rawFilePath = await store.raw.write(request.baseId, docId, ".md", encodeUtf8(extracted.text));
    }
    return this.ingestDocument({
      baseId: request.baseId,
      title,
      sourceType: "url",
      url: request.url,
      ...request.parentDirectoryId !== void 0 ? { parentDirectoryId: request.parentDirectoryId } : {},
      rawFilePath,
      text: extracted.text
    });
  }
  /**
   * Cherry-style URL refresh: re-fetch the page, and when its text changed,
   * overwrite the snapshot and re-index the document (hash reuse re-embeds
   * only the chunks that changed). A failed fetch or an unchanged page leaves
   * the current snapshot and index untouched — refresh never degrades.
   */
  async refreshUrlDocument(id) {
    const store = this.requireStore();
    const document = store.getDocument(id);
    if (document === void 0) throw new Error(`document not found: ${id}`);
    if (document.sourceType !== "url" || document.url === void 0) {
      throw new Error(`document "${document.title}" is not a URL document`);
    }
    const html = await fetchHtml(document.url);
    const extracted = await extractHtmlDocument(html);
    if (extracted.text.trim().length === 0) throw new Error("URL returned no extractable text");
    const title = extracted.title.trim().length > 0 ? extracted.title.trim() : document.title;
    if (extracted.text === document.rawText && title === document.title) {
      return { changed: false, title: document.title, chunkCount: document.chunkCount };
    }
    let rawFilePath = document.rawFilePath;
    if (store.raw !== void 0) {
      const ext = rawFilePath !== void 0 ? rawExtensionOf(rawFilePath) : ".md";
      rawFilePath = await store.raw.write(document.baseId, document.id, ext, encodeUtf8(extracted.text));
    }
    const refreshed = await this.ingestDocument({
      baseId: document.baseId,
      title,
      sourceType: "url",
      url: document.url,
      rawFilePath,
      text: extracted.text,
      placeholderId: document.id
    });
    return { changed: true, title: refreshed.title, chunkCount: refreshed.chunkCount };
  }
  async deleteDocument(id) {
    const store = this.requireStore();
    const existing = store.getDocument(id);
    if (existing === void 0) throw new Error(`document not found: ${id}`);
    await this.deleteDocumentRecursive(id);
    await this.touchBase(existing.baseId);
    this.reclaimAfterDelete();
  }
  /** Threshold-gated space reclamation after a delete (Cherry's reclaimSpace). */
  reclaimAfterDelete() {
    const store = this.requireStore();
    const outcome = store.reclaimSpace?.();
    if (outcome !== void 0 && outcome.vacuumed) {
      this.ctx.logger.info(`knowledge: reclaimed ${outcome.reclaimedBytes} bytes after delete`);
    }
  }
  /** Delete one document (recursing into directory containers), one write per item. */
  async deleteDocumentRecursive(id) {
    const store = this.requireStore();
    const existing = store.getDocument(id);
    if (existing === void 0) return;
    const active = this.indexing.get(id);
    active?.controller?.abort();
    this.indexing.delete(id);
    if (existing.sourceType === "directory") {
      for (const child of store.listDocuments(existing.baseId)) {
        if (child.parentDirectoryId === id) await this.deleteDocumentRecursive(child.id);
      }
    }
    if (existing.rawFilePath !== void 0) await store.raw?.delete(existing.rawFilePath);
    await store.deleteChunks(id, existing.baseId);
    await store.deleteDocument(id);
  }
  /**
   * Throw when the document (or its base) vanished while indexing was in
   * flight — Cherry's deleting-guard: a delete that lands mid-import or
   * mid-reindex must never be resurrected by the finishing writes, and chunks
   * must never land under a deleted base.
   */
  assertIndexTargetAlive(docId, baseId) {
    const store = this.requireStore();
    if (store.getDocument(docId) === void 0 || store.getBase(baseId) === void 0) {
      throw new Error("indexing target no longer exists (deleted while indexing)");
    }
  }
  async renameDocument(id, title) {
    const store = this.requireStore();
    const existing = store.getDocument(id);
    if (existing === void 0) throw new Error(`document not found: ${id}`);
    const next = { ...existing, title: title.trim() || existing.title, updatedAt: Date.now() };
    await store.putDocument(next);
    return next;
  }
  async reindexDocument(id) {
    const store = this.requireStore();
    const document = store.getDocument(id);
    if (document === void 0) throw new Error(`document not found: ${id}`);
    if (document.sourceType === "directory") {
      if (document.sourcePath !== void 0) {
        return await this.rescanDirectory(document);
      }
      let failed = 0;
      let firstError = "";
      for (const child of store.listDocuments(document.baseId)) {
        if (child.parentDirectoryId !== document.id) continue;
        if (this.indexing.has(child.id)) continue;
        try {
          await this.reindexDocument(child.id);
        } catch (error) {
          failed += 1;
          if (firstError === "") firstError = error instanceof Error ? error.message : String(error);
        }
      }
      if (failed > 0) {
        throw new Error(`directory reindex finished with ${failed} failed item(s): ${firstError}`);
      }
      await store.putDocument({ ...document, updatedAt: Date.now() });
      return document;
    }
    if (this.indexing.has(id)) {
      throw new Error(`"${document.title}" is still being indexed \u2014 try again when it finishes`);
    }
    const text = await this.sourceTextOf(document);
    const config = this.getConfigFor(document.baseId);
    await store.putDocument({ ...document, incomplete: true, updatedAt: Date.now() });
    const { chunks, embeddingError, embeddingErrorCode } = await this.buildChunks(document.baseId, document.id, document.title, text, config, void 0, (batch) => store.putChunkBatch(batch));
    const { embeddingError: _staleError, errorCode: _staleCode, incomplete: _staleIncomplete, contentHash: _staleHash, ...rest } = document;
    const next = {
      ...rest,
      rawText: text,
      contentHash: sha256(text),
      charCount: text.length,
      tokenCount: estimateTokens2(text),
      chunkCount: chunks.length,
      ...embeddingError !== void 0 ? { embeddingError, ...embeddingErrorCode !== void 0 ? { errorCode: embeddingErrorCode } : {} } : {},
      updatedAt: Date.now()
    };
    if (store.getDocument(document.id) === void 0 || store.getBase(document.baseId) === void 0) {
      return document;
    }
    await store.putChunks(chunks);
    await store.putDocument(next);
    await this.touchBase(document.baseId);
    return next;
  }
  /** Rebuild source text of a document: raw file first, then persisted text, then chunks. */
  async sourceTextOf(document) {
    if (document.rawFilePath !== void 0) {
      const store = this.requireStore();
      const raw = await store.raw?.read(document.rawFilePath);
      if (raw !== null && raw !== void 0 && raw.byteLength > 0) {
        try {
          const text2 = await parseDocumentBuffer(raw, document.fileName ?? document.title, document.mimeType);
          if (text2.trim().length > 0) return text2;
        } catch (error) {
          this.ctx.logger.warn(`knowledge: re-parsing raw source failed, falling back to stored text: ${error instanceof Error ? error.message : String(error)}`);
        }
      } else {
        this.ctx.logger.warn(`knowledge: raw source file missing for "${document.title}", falling back to stored text`);
      }
    }
    const text = document.rawText ?? reconstructFromChunks(this.requireStore().listChunksByDoc(document.id));
    if (text.trim().length === 0) throw new Error(`document "${document.title}" has no source text to reindex`);
    return text;
  }
  /**
   * Cherry's prepare-root rescan: re-read the container's remembered source
   * directory and sync the base's children with the disk —
   * - files/directories removed from disk are deleted from the base,
   * - new supported files are parsed and ingested (raw copy persisted),
   * - new subdirectories become containers (with their own sourcePath),
   * - existing items are re-indexed (re-chunk + hash-reuse re-embed).
   * A missing/unreadable source keeps the existing subtree untouched (Cherry
   * skips roots whose source cannot be rebuilt). Failures are isolated per
   * entry and summarized at the end.
   */
  async rescanDirectory(document) {
    const store = this.requireStore();
    const source = document.sourcePath;
    this.indexing.set(document.id, { baseId: document.baseId, title: document.title, phase: "parsing", total: 0, progress: 0 });
    try {
      const result = await this.rescanDirectoryInner(document, source);
      const current = store.getDocument(document.id);
      if (current !== void 0) {
        await store.putDocument({ ...current, updatedAt: Date.now() });
      }
      return result;
    } finally {
      this.indexing.delete(document.id);
    }
  }
  async rescanDirectoryInner(document, source) {
    const store = this.requireStore();
    let entries;
    try {
      entries = await readdir2(source, { withFileTypes: true });
    } catch {
      this.ctx.logger.warn(`knowledge: source directory unreadable, keeping existing subtree: ${source}`);
      return document;
    }
    const children = store.listDocuments(document.baseId).filter((child) => child.parentDirectoryId === document.id);
    const onDisk = new Set(entries.map((entry) => entry.name));
    let failures = 0;
    let firstError = "";
    const fail = (error) => {
      failures += 1;
      if (firstError === "") firstError = error instanceof Error ? error.message : String(error);
    };
    for (const child of children) {
      const name = child.sourceType === "directory" ? child.title : child.fileName ?? child.title;
      if (!onDisk.has(name)) {
        try {
          await this.deleteDocumentRecursive(child.id);
        } catch (error) {
          fail(error);
        }
      }
    }
    const remaining = store.listDocuments(document.baseId).filter((child) => child.parentDirectoryId === document.id);
    for (const entry of entries) {
      const full = join5(source, entry.name);
      if (entry.isDirectory()) {
        const existing = remaining.find((child) => child.sourceType === "directory" && child.title === entry.name);
        try {
          if (existing !== void 0) {
            const withSource = existing.sourcePath === full ? existing : { ...existing, sourcePath: full };
            await this.rescanDirectory(withSource);
          } else {
            const created = await this.createDirectory(document.baseId, entry.name, document.id);
            await this.rescanDirectory({ ...created, sourcePath: full });
          }
        } catch (error) {
          fail(error);
        }
      } else if (entry.isFile() && DIRECTORY_EXTENSIONS.has(extname2(entry.name).toLowerCase())) {
        const existing = remaining.find((child) => child.fileName === entry.name);
        try {
          if (existing !== void 0) {
            if (this.indexing.has(existing.id)) continue;
            await this.reindexDocument(existing.id);
          } else {
            const buffer = await readFile3(full);
            const text = await parseDocumentBuffer(buffer, entry.name);
            if (text.trim().length === 0) continue;
            let rawFilePath;
            if (store.raw !== void 0) {
              let root = document;
              while (root.parentDirectoryId !== void 0) {
                const parent = store.getDocument(root.parentDirectoryId);
                if (parent === void 0 || parent.sourceType !== "directory") break;
                root = parent;
              }
              const relPath = relative(root.sourcePath ?? source, full).replace(/\\/g, "/");
              rawFilePath = await store.raw.writeRel(document.baseId, relPath, buffer);
              await this.ingestDocument({
                baseId: document.baseId,
                title: entry.name,
                sourceType: "file",
                fileName: entry.name,
                parentDirectoryId: document.id,
                rawFilePath,
                text
              });
            } else {
              await this.ingestDocument({
                baseId: document.baseId,
                title: entry.name,
                sourceType: "file",
                fileName: entry.name,
                parentDirectoryId: document.id,
                text
              });
            }
          }
        } catch (error) {
          fail(error);
        }
      }
    }
    await this.touchBase(document.baseId);
    if (failures > 0) {
      throw new Error(`directory rescan finished with ${failures} failed item(s): ${firstError}`);
    }
    return document;
  }
  async reindexBase(baseId) {
    const store = this.requireStore();
    const ids = store.listDocuments(baseId).map((doc) => doc.id);
    let reindexed = 0;
    for (const id of this.outermostSelectedIds(ids)) {
      if (this.indexing.has(id)) continue;
      await this.reindexDocument(id);
      reindexed += 1;
    }
    return { reindexed };
  }
  /** Start re-embedding a whole base as a cancellable background job. */
  async startReindexBase(baseId) {
    const store = this.requireStore();
    if (store.getBase(baseId) === void 0) throw new Error(`knowledge base not found: ${baseId}`);
    const documents = store.listDocuments(baseId);
    const jobId = crypto.randomUUID();
    this.pruneJobs();
    this.jobs.set(jobId, {
      baseId,
      kind: "reindex",
      cancelled: false,
      imported: 0,
      skipped: 0,
      total: documents.length,
      current: "",
      errors: [],
      done: false
    });
    void this.runReindexJob(jobId, baseId);
    return { jobId, total: documents.length };
  }
  /** Progress snapshot of an active (or just-finished) reindex job. */
  reindexJobStatus(jobId) {
    return this.jobs.get(jobId);
  }
  cancelReindexJob(jobId) {
    const job = this.jobs.get(jobId);
    if (job !== void 0 && !job.done) job.cancelled = true;
  }
  async runReindexJob(jobId, baseId) {
    const job = this.jobs.get(jobId);
    if (job === void 0) return;
    const documents = this.requireStore().listDocuments(baseId);
    for (const doc of documents) {
      if (job.cancelled) break;
      job.current = doc.title;
      if (doc.sourceType === "directory") {
        job.skipped += 1;
        continue;
      }
      try {
        await this.reindexDocument(doc.id);
        job.imported += 1;
      } catch (error) {
        job.errors.push({ file: doc.title, error: error instanceof Error ? error.message : String(error) });
      }
    }
    job.done = true;
    job.current = "";
  }
  async reindexDocuments(ids) {
    const store = this.requireStore();
    let reindexed = 0;
    let skipped = 0;
    for (const id of this.outermostSelectedIds(ids)) {
      if (store.getDocument(id) === void 0) continue;
      if (this.indexing.has(id)) {
        skipped += 1;
        continue;
      }
      await this.reindexDocument(id);
      reindexed += 1;
    }
    return { reindexed, skipped };
  }
  async deleteDocuments(ids) {
    const store = this.requireStore();
    const touched = /* @__PURE__ */ new Set();
    let deleted = 0;
    for (const id of this.outermostSelectedIds(ids)) {
      const document = store.getDocument(id);
      if (document === void 0) continue;
      await this.deleteDocumentRecursive(id);
      touched.add(document.baseId);
      deleted += 1;
    }
    for (const baseId of touched) await this.touchBase(baseId);
    this.reclaimAfterDelete();
    return { deleted };
  }
  /**
   * Resolve the request's metadata filter into a document-id allow-list, or
   * `undefined` when no filter is present (unrestricted search). A filter that
   * matches nothing yields an empty set, so the caller returns no hits.
   */
  resolveSearchFilter(request) {
    const filter = request.filter;
    if (filter === void 0) return void 0;
    const { docIds, titleIncludes, sourceTypes, updatedAfter, updatedBefore } = filter;
    const hasDocIds = docIds !== void 0 && docIds.length > 0;
    const hasTitle = titleIncludes !== void 0 && titleIncludes.trim().length > 0;
    const hasTypes = sourceTypes !== void 0 && sourceTypes.length > 0;
    const hasTime = updatedAfter !== void 0 || updatedBefore !== void 0;
    if (!hasDocIds && !hasTitle && !hasTypes && !hasTime) return void 0;
    const store = this.requireStore();
    const scope = request.baseId !== void 0 ? [request.baseId] : request.baseIds !== void 0 && request.baseIds.length > 0 ? [...request.baseIds] : store.listBases().map((base) => base.id);
    const title = hasTitle ? filter.titleIncludes.trim().toLowerCase() : void 0;
    const allowed = /* @__PURE__ */ new Set();
    for (const baseId of scope) {
      for (const doc of store.listDocuments(baseId)) {
        if (hasDocIds && !docIds.includes(doc.id)) continue;
        if (title !== void 0 && !doc.title.toLowerCase().includes(title)) continue;
        if (hasTypes && !sourceTypes.includes(doc.sourceType)) continue;
        if (updatedAfter !== void 0 && (doc.updatedAt ?? doc.createdAt) < updatedAfter) continue;
        if (updatedBefore !== void 0 && (doc.updatedAt ?? doc.createdAt) > updatedBefore) continue;
        allowed.add(doc.id);
      }
    }
    return allowed;
  }
  /**
   * Fold a set of selected document ids to its outermost roots (Cherry's
   * `getOutermostSelectedItemIds`): ids that are descendants of another
   * selected id are dropped, so a directory plus one of its children in the
   * same batch resolves to just the directory — the subtree is then handled
   * once by the recursive operations.
   */
  outermostSelectedIds(ids) {
    const store = this.requireStore();
    const selected = new Set(ids.filter((id) => store.getDocument(id) !== void 0));
    if (selected.size === 0) return [];
    const childrenOf = /* @__PURE__ */ new Map();
    for (const base of store.listBases()) {
      for (const doc of store.listDocuments(base.id)) {
        const parent = doc.parentDirectoryId;
        if (parent === void 0) continue;
        const list = childrenOf.get(parent) ?? [];
        list.push(doc.id);
        childrenOf.set(parent, list);
      }
    }
    const inner = /* @__PURE__ */ new Set();
    const walk = (docId, depth) => {
      if (depth > 0 && selected.has(docId)) inner.add(docId);
      for (const child of childrenOf.get(docId) ?? []) walk(child, depth + 1);
    };
    for (const id of selected) walk(id, 0);
    return [...selected].filter((id) => !inner.has(id));
  }
  listDocuments(baseId) {
    const store = this.requireStore();
    const { withChunks, missingEmbedding } = store.docChunkStatus(baseId);
    const allDocs = store.listDocuments(baseId);
    const childCount = /* @__PURE__ */ new Map();
    for (const doc of allDocs) {
      if (doc.parentDirectoryId !== void 0) {
        childCount.set(doc.parentDirectoryId, (childCount.get(doc.parentDirectoryId) ?? 0) + 1);
      }
    }
    return allDocs.map((doc) => {
      const embedded = withChunks.has(doc.id) && !missingEmbedding.has(doc.id);
      const active = this.indexing.get(doc.id);
      let status = "pending";
      if (doc.sourceType !== "directory") {
        if (doc.embeddingError !== void 0) status = "failed";
        else if (active !== void 0) status = "processing";
        else if (embedded) status = "completed";
      }
      return {
        id: doc.id,
        baseId: doc.baseId,
        title: doc.title,
        sourceType: doc.sourceType,
        fileName: doc.fileName,
        url: doc.url,
        ...doc.parentDirectoryId !== void 0 ? { parentDirectoryId: doc.parentDirectoryId } : {},
        charCount: doc.charCount,
        tokenCount: doc.tokenCount,
        chunkCount: doc.chunkCount,
        ...doc.sourceType === "directory" ? { childCount: childCount.get(doc.id) ?? 0 } : {},
        embedded,
        ...doc.embeddingError !== void 0 ? { embeddingError: doc.embeddingError } : {},
        ...doc.errorCode !== void 0 ? { errorCode: doc.errorCode } : {},
        ...doc.sourceType !== "directory" ? { status } : {},
        ...active !== void 0 ? { indexingProgress: active.progress, indexingPhase: active.phase } : {},
        createdAt: doc.createdAt,
        ...doc.updatedAt !== void 0 ? { updatedAt: doc.updatedAt } : {}
      };
    });
  }
  /** Pre-order DFS outline of one base's directory tree (kb_list outline mode). */
  listBaseOutline(baseId) {
    const summaries = this.listDocuments(baseId);
    const children = /* @__PURE__ */ new Map();
    const roots = [];
    for (const doc of summaries) {
      if (doc.parentDirectoryId === void 0) roots.push(doc);
      else {
        const list = children.get(doc.parentDirectoryId) ?? [];
        list.push(doc);
        children.set(doc.parentDirectoryId, list);
      }
    }
    const byTitle = (a, b) => a.title.localeCompare(b.title);
    roots.sort(byTitle);
    for (const list of children.values()) list.sort(byTitle);
    const nodes = [];
    const walk = (doc, depth) => {
      nodes.push({
        depth,
        docId: doc.id,
        title: doc.title,
        type: doc.sourceType,
        status: doc.status ?? "completed"
      });
      for (const child of children.get(doc.id) ?? []) walk(child, depth + 1);
    };
    for (const root of roots) walk(root, 0);
    return { baseId, totalItems: summaries.length, nodes };
  }
  /** Live import/embedding progress for every document currently being indexed. */
  indexingStatus() {
    const now = Date.now();
    const out = [];
    for (const [docId, entry] of this.indexing) {
      out.push({ docId, baseId: entry.baseId, title: entry.title, phase: entry.phase, progress: entry.progress });
    }
    for (const [docId, entry] of [...this.progressLinger]) {
      if (entry.expireAt <= now) {
        this.progressLinger.delete(docId);
        continue;
      }
      out.push({ docId, baseId: entry.baseId, title: entry.title, phase: entry.phase, progress: entry.progress });
    }
    return out;
  }
  /** Current download/load state of an in-process embedding model. */
  async getLocalModelStatus(modelId) {
    const id = modelId?.trim() || DEFAULT_LOCAL_MODEL;
    const live = getLocalModelStatus(id);
    if (live.status !== "idle") return live;
    if (await isLocalModelDownloaded(id)) {
      return { model: id, status: "ready", progress: 100, message: "" };
    }
    return live;
  }
  /**
   * Embed one probe text through the given (or current) embedding config and
   * return the vector width — Cherry's `useEmbeddingDimensions` probe, run
   * before a config save so a wrong-dimension model is caught up front.
   * Local models answer from the catalog without loading the ~600MB pipeline.
   */
  async probeEmbeddingDimensions(options = {}) {
    const config = this.getConfig();
    const provider = options.provider ?? config.embeddingProvider;
    if (provider === "none") throw new Error("no embedding provider configured");
    const model = options.model ?? config.embeddingModel;
    if (provider === "local") {
      const descriptor = LOCAL_MODELS.find((entry) => entry.kind === "embedding" && entry.id === model);
      if (descriptor?.dimensions !== void 0) return descriptor.dimensions;
    }
    const [vector] = await embedTexts(
      provider,
      options.baseUrl ?? config.embeddingBaseUrl,
      model,
      options.apiKey ?? config.embeddingApiKey,
      ["test"]
    );
    if (vector === void 0 || vector.length === 0) throw new Error("embedding returned an empty vector");
    return vector.length;
  }
  // ── local model manager (settings "本地模型") ──────────────────────────────
  listLocalModels() {
    return listLocalModels();
  }
  downloadLocalModel(id) {
    return downloadLocalModel(id);
  }
  cancelLocalModel(id) {
    return cancelLocalModelDownload(id);
  }
  deleteLocalModel(id) {
    return deleteLocalModel(id);
  }
  // ── local OCR (scanned-PDF recognition, Cherry's local-document posture) ──
  getOcrStatus() {
    return getOcrModelStatus();
  }
  downloadOcr() {
    return downloadOcrModels(this.baseConfig.hfEndpoint);
  }
  deleteOcr() {
    return removeOcrModels().then(() => ({ deleted: true }));
  }
  // ── Ollama model management (pull + installed list for the settings page) ──
  listOllamaModels(baseUrl) {
    return listOllamaModels(baseUrl);
  }
  deleteOllamaModel(model, baseUrl) {
    return deleteOllamaModel(model, baseUrl);
  }
  pullOllamaModel(model, baseUrl) {
    return pullOllamaModel(model, baseUrl);
  }
  cancelOllamaPull(model) {
    cancelOllamaPull(model);
  }
  getOllamaPullStatus(model) {
    return getOllamaPullStatus(model);
  }
  /** In-flight pulls (the panel restores its progress cards from this on open). */
  activeOllamaPulls() {
    return activeOllamaPulls();
  }
  /**
   * Migrate downloaded local models (and OCR files) from the current cache
   * directory to `to`, then point the config there. Loaded models are
   * released first so file locks (Windows) cannot block the move; moves fall
   * back to copy+delete across drives. The directory may be empty — the
   * config still switches, so future downloads land in the new location.
   */
  async migrateLocalModels(to) {
    const store = this.requireStore();
    const target = resolve3(expandHomePath(to.trim() === "" ? "~/.dsh/cache/dsh-knowledge/local-models" : to.trim()));
    const from2 = localModelCacheDir();
    const samePath = process.platform === "win32" ? from2.toLowerCase() === target.toLowerCase() : from2 === target;
    if (samePath) return { moved: 0, from: from2, to: target };
    if (hasActiveLocalModelDownload()) {
      throw new Error("\u6A21\u578B\u6B63\u5728\u4E0B\u8F7D\uFF0C\u8BF7\u5148\u7B49\u5F85\u4E0B\u8F7D\u5B8C\u6210\u6216\u53D6\u6D88\u540E\u518D\u8FC1\u79FB");
    }
    await disposeLocalModelWorker();
    await disposeOcrWorker();
    const entries = await readdir2(from2).catch(() => []);
    let moved = 0;
    await mkdir3(target, { recursive: true });
    for (const entry of entries) {
      if (entry.startsWith(".")) continue;
      const source = join5(from2, entry);
      const dest = join5(target, entry);
      const info = await stat(source).catch(() => null);
      if (info === null || !info.isDirectory()) continue;
      const src = process.platform === "win32" ? source.toLowerCase() : source;
      const dst = process.platform === "win32" ? dest.toLowerCase() : dest;
      const rel = relative(src, dst);
      if (rel === "" || !rel.startsWith("..") && !isAbsolute(rel)) continue;
      if (await stat(dest).then(() => true).catch(() => false)) continue;
      try {
        await rename2(source, dest);
      } catch {
        await cp(source, dest, { recursive: true });
        await rm4(source, { recursive: true, force: true });
      }
      moved += 1;
    }
    await store.setConfigOverrides({ localModelCacheDir: target });
    setLocalModelCacheDir(target);
    return { moved, from: from2, to: target };
  }
  listChunks(documentId, limit, offset) {
    const start = clampInt2(offset ?? 0, 0, Number.MAX_SAFE_INTEGER, 0);
    const count = limit === void 0 ? void 0 : clampInt2(limit, 0, Number.MAX_SAFE_INTEGER, 0);
    return this.requireStore().listChunksByDoc(documentId, count, start);
  }
  getDocument(id, opts) {
    const store = this.requireStore();
    const doc = store.getDocument(id);
    if (doc === void 0) throw new Error(`document not found: ${id}`);
    const rawText = doc.rawText;
    const rawTextLimit = opts?.rawTextLimit;
    const truncated = rawText !== void 0 && rawTextLimit !== void 0 && rawText.length > rawTextLimit;
    return {
      id: doc.id,
      baseId: doc.baseId,
      title: doc.title,
      sourceType: doc.sourceType,
      ...doc.fileName !== void 0 ? { fileName: doc.fileName } : {},
      ...doc.url !== void 0 ? { url: doc.url } : {},
      ...doc.rawFilePath !== void 0 ? { rawFilePath: doc.rawFilePath } : {},
      rawText: truncated ? rawText.slice(0, rawTextLimit) : rawText,
      ...truncated ? { rawTextTruncated: true } : {},
      charCount: doc.charCount,
      ...doc.tokenCount !== void 0 ? { tokenCount: doc.tokenCount } : {},
      chunkCount: doc.chunkCount,
      createdAt: doc.createdAt,
      ...opts?.includeChunks === false ? {} : { chunks: store.listChunksByDoc(id) }
    };
  }
  /** Original source bytes of a file document (for the download route). */
  async getRawFile(id) {
    const store = this.requireStore();
    const doc = store.getDocument(id);
    if (doc === void 0 || doc.rawFilePath === void 0) return void 0;
    const bytes = await store.raw?.read(doc.rawFilePath);
    if (bytes === null || bytes === void 0) return void 0;
    return { bytes, fileName: doc.fileName ?? doc.title, mimeType: doc.mimeType };
  }
  /** Read one document's source text as a `[charStart, charEnd)` slice (kb_read read mode). */
  readDocumentText(id, charStart, charEnd) {
    const store = this.requireStore();
    const doc = store.getDocument(id);
    if (doc === void 0) throw new Error(`document not found: ${id}`);
    const text = doc.rawText ?? reconstructFromChunks(store.listChunksByDoc(id));
    const total = text.length;
    const start = clampInt2(charStart ?? 0, 0, total, 0);
    const naturalEnd = clampInt2(charEnd ?? total, start, total, total);
    const end = Math.max(start, Math.min(naturalEnd, start + CONCEPT_READ_MAX_CHARS));
    return {
      id: doc.id,
      baseId: doc.baseId,
      title: doc.title,
      sourceType: doc.sourceType,
      totalChars: total,
      charStart: start,
      charEnd: end,
      content: text.slice(start, end),
      // "There is more to read" — true both when the 20k cap cut the slice
      // short and when the caller stopped before the document end.
      truncated: end < total
    };
  }
  /** Grep one document's source text for a regular expression (kb_read grep mode). */
  grepDocument(id, pattern2, maxMatches, ignoreCase = true) {
    const store = this.requireStore();
    const doc = store.getDocument(id);
    if (doc === void 0) throw new Error(`document not found: ${id}`);
    const text = doc.rawText ?? reconstructFromChunks(store.listChunksByDoc(id));
    let regex;
    try {
      regex = new RegExp(pattern2, `g${ignoreCase ? "i" : ""}`);
    } catch (error) {
      throw new Error(`invalid regex: ${error instanceof Error ? error.message : String(error)}`);
    }
    const cap = clampInt2(maxMatches ?? 50, 1, 200, 50);
    const matches = [];
    let totalMatches = 0;
    let lineNumber = 0;
    let lineStart = 0;
    while (lineStart <= text.length) {
      lineNumber += 1;
      const newlineIndex = text.indexOf("\n", lineStart);
      const lineEnd = newlineIndex === -1 ? text.length : newlineIndex;
      const line = text.slice(lineStart, Math.min(lineEnd, lineStart + CONCEPT_GREP_MAX_LINE_CHARS));
      regex.lastIndex = 0;
      for (let match = regex.exec(line); match !== null; match = regex.exec(line)) {
        totalMatches += 1;
        const matchLength = match[0].length;
        const matchStart = lineStart + match.index;
        const matchEnd = matchStart + matchLength;
        if (matches.length < cap) {
          const snippetStart = Math.max(0, matchStart - CONCEPT_GREP_SNIPPET_PAD);
          const snippetEnd = Math.min(text.length, matchEnd + CONCEPT_GREP_SNIPPET_PAD);
          matches.push({
            line: lineNumber,
            charStart: matchStart,
            charEnd: matchEnd,
            snippet: `${snippetStart > 0 ? "\u2026" : ""}${text.slice(snippetStart, snippetEnd)}${snippetEnd < text.length ? "\u2026" : ""}`
          });
        }
        if (matchLength === 0) regex.lastIndex = match.index + 1;
      }
      lineStart = lineEnd + 1;
    }
    return { id: doc.id, baseId: doc.baseId, title: doc.title, totalMatches, matches };
  }
  // ── statistics ────────────────────────────────────────────────────────────
  stats(baseId) {
    const store = this.requireStore();
    const bases = baseId !== void 0 ? store.listBases().filter((base) => base.id === baseId) : store.listBases();
    const documents = bases.flatMap((base) => store.listDocuments(base.id));
    const charCount = documents.reduce((sum, doc) => sum + doc.charCount, 0);
    const tokenCount = documents.reduce((sum, doc) => sum + (doc.tokenCount ?? 0), 0);
    const chunkStats = store.chunkStats(bases.map((base) => base.id));
    let staleChunkCount = 0;
    let hasCurrentKey = false;
    for (const base of bases) {
      const key = embeddingKey(this.getConfigFor(base.id));
      if (key === void 0) continue;
      hasCurrentKey = true;
      for (const entry of chunkStats.embeddingModelCounts) {
        if (entry.baseId === base.id && entry.model !== key) staleChunkCount += entry.count;
      }
    }
    return {
      ...baseId !== void 0 ? { baseId } : {},
      documentCount: documents.length,
      chunkCount: chunkStats.count,
      charCount,
      tokenCount,
      embedded: chunkStats.embedded,
      ...chunkStats.dimensions !== void 0 ? { embeddingDimensions: chunkStats.dimensions } : {},
      ...hasCurrentKey && staleChunkCount > 0 ? { staleEmbeddings: true, staleChunkCount } : {}
    };
  }
  // ── retrieval ─────────────────────────────────────────────────────────────
  async search(request) {
    const startedAt = Date.now();
    const store = this.requireStore();
    const config = this.getConfigFor(request.baseId);
    const query = request.query.trim();
    if (query.length === 0) return { query, mode: "lexical", total: 0, reranked: false, elapsedMs: 0, hits: [] };
    const requestedMode = request.mode ?? config.searchMode;
    const topK = clampInt2(request.topK ?? config.topK, 1, 50, 6);
    if (request.queries !== void 0 && request.queries.length > 0) {
      const variants = [query, ...request.queries.map((variant) => variant.trim()).filter((variant) => variant.length > 0)];
      const subTopK = Math.min(50, topK * 2);
      const results = await Promise.all(variants.map((variant) => this.search({ ...request, query: variant, queries: void 0, topK: subTopK })));
      const byId2 = /* @__PURE__ */ new Map();
      let total = 0;
      for (const result of results) {
        total += result.total;
        for (const hit of result.hits) {
          const prev = byId2.get(hit.chunkId);
          if (prev === void 0 || hit.score > prev.score) byId2.set(hit.chunkId, hit);
        }
      }
      const hits = [...byId2.values()].sort((a, b) => b.score - a.score).slice(0, topK);
      return {
        query,
        mode: requestedMode,
        total,
        reranked: results.some((result) => result.reranked),
        elapsedMs: Date.now() - startedAt,
        hits
      };
    }
    if (request.baseId !== void 0 && store.getBase(request.baseId) === void 0) {
      return { query, mode: "lexical", total: 0, reranked: false, elapsedMs: 0, hits: [] };
    }
    const threshold = request.threshold ?? config.similarityThreshold;
    const filterDocIds = this.resolveSearchFilter(request);
    const lane = store.retrievalLane;
    if (lane !== void 0) {
      const scope = request.baseId !== void 0 ? [request.baseId] : request.baseIds !== void 0 && request.baseIds.length > 0 ? [...request.baseIds] : store.listBases().map((base) => base.id);
      const poolSize2 = Math.min(Math.max(topK * 4, 20), LANE_CANDIDATE_CAP);
      let queryVector2;
      if ((requestedMode === "vector" || requestedMode === "hybrid" || requestedMode === "auto") && config.embeddingProvider !== "none") {
        try {
          const [vector] = await embedTexts(
            config.embeddingProvider,
            config.embeddingBaseUrl,
            config.embeddingModel,
            config.embeddingApiKey,
            [query]
          );
          queryVector2 = vector;
        } catch (error) {
          if (config.embeddingProvider === "local") {
            throw new Error(
              `local embedding model is unavailable (${error instanceof Error ? error.message : String(error)}); download it in Settings \u2192 Local Models, or switch the embedding provider`
            );
          }
          this.ctx.logger.warn(`knowledge: embedding failed, using lexical retrieval: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      const useVector = queryVector2 !== void 0 && requestedMode !== "lexical";
      const filterList = filterDocIds !== void 0 ? [...filterDocIds] : void 0;
      let ranked2 = [];
      const byId2 = /* @__PURE__ */ new Map();
      let total = 0;
      if (useVector) {
        const vec = await lane.vector(queryVector2, scope, poolSize2, filterList);
        total = Math.max(total, vec.total);
        for (const hit of vec.hits) byId2.set(hit.id, hit);
        if (requestedMode === "vector") {
          ranked2 = vec.hits.map((hit) => ({ id: hit.id, score: hit.score, vectorScore: hit.score }));
        } else {
          const lex = await lane.lexical(query, scope, poolSize2, filterList);
          total = Math.max(total, lex.total);
          for (const hit of lex.hits) if (!byId2.has(hit.id)) byId2.set(hit.id, hit);
          const vectorOrder = vec.hits.map((hit) => hit.id);
          const lexicalOrder = lex.hits.map((hit) => hit.id);
          const vectorWeight = config.rrfVectorWeight;
          const fused = reciprocalRankFusion([vectorOrder, lexicalOrder], [vectorWeight, 1]);
          const maxFused = (vectorWeight + 1) / (RRF_K + 1);
          const vectorScores = new Map(vec.hits.map((hit) => [hit.id, hit.score]));
          const lexicalScores = new Map(lex.hits.map((hit) => [hit.id, hit.score]));
          ranked2 = [.../* @__PURE__ */ new Set([...vectorOrder, ...lexicalOrder])].map((id) => ({
            id,
            score: (fused.get(id) ?? 0) / maxFused,
            vectorScore: vectorScores.get(id),
            lexicalScore: lexicalScores.get(id)
          }));
        }
      } else {
        const lex = await lane.lexical(query, scope, poolSize2, filterList);
        total = lex.total;
        for (const hit of lex.hits) byId2.set(hit.id, hit);
        ranked2 = lex.hits.map((hit) => ({ id: hit.id, score: hit.score, lexicalScore: hit.score }));
      }
      ranked2.sort((a, b) => b.score - a.score);
      if (request.mmr ?? config.mmrDiversity > 0) {
        if (config.mmrDiversity > 0 && queryVector2 !== void 0) {
          ranked2 = maximalMarginalRelevance(ranked2, byId2, queryVector2, config.mmrDiversity, Math.max(topK * 3, 12));
        }
      }
      return this.finishSearch(store, config, query, requestedMode, ranked2, byId2, topK, threshold, total, startedAt);
    }
    const chunks = (request.baseId !== void 0 ? store.listChunks(request.baseId) : request.baseIds !== void 0 && request.baseIds.length > 0 ? request.baseIds.flatMap((id) => store.listChunks(id)) : store.listBases().flatMap((base) => store.listChunks(base.id))).filter((chunk) => filterDocIds === void 0 || filterDocIds.has(chunk.docId));
    if (chunks.length === 0) return { query, mode: "lexical", total: 0, reranked: false, elapsedMs: 0, hits: [] };
    const byId = new Map(chunks.map((chunk) => [chunk.id, chunk]));
    const candidates = chunks.map((chunk) => ({
      id: chunk.id,
      text: chunkSearchText(chunk),
      embedding: chunk.embedding
    }));
    let queryVector;
    if (requestedMode !== "lexical" && config.embeddingProvider !== "none") {
      try {
        const [vector] = await embedTexts(
          config.embeddingProvider,
          config.embeddingBaseUrl,
          config.embeddingModel,
          config.embeddingApiKey,
          [query]
        );
        queryVector = vector;
      } catch (error) {
        if (config.embeddingProvider === "local") {
          throw new Error(
            `local embedding model is unavailable (${error instanceof Error ? error.message : String(error)}); download it in Settings \u2192 Local Models, or switch the embedding provider`
          );
        }
        this.ctx.logger.warn(`knowledge: embedding failed, using lexical retrieval: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const poolSize = Math.min(chunks.length, Math.max(topK * 4, 20));
    const ranked = rank(query, candidates, {
      mode: requestedMode,
      topK: poolSize,
      threshold: 0,
      mmr: request.mmr ?? config.mmrDiversity > 0,
      mmrLambda: config.mmrDiversity,
      queryVector
    });
    return this.finishSearch(store, config, query, requestedMode, ranked, byId, topK, threshold, chunks.length, startedAt);
  }
  /** Shared tail: rerank (optional), threshold + top-K cut, and hit mapping. */
  async finishSearch(store, config, query, requestedMode, initial, byId, topK, threshold, total, startedAt) {
    let ranked = initial;
    let reranked = false;
    if (config.rerankModel.trim() !== "" && ranked.length > 1) {
      try {
        const pool = ranked.map((hit) => ({ id: hit.id, text: chunkSearchText(byId.get(hit.id)) }));
        const scores = await rerankCandidates(
          config.rerankBaseUrl,
          config.rerankModel,
          config.rerankApiKey,
          query,
          pool,
          topK
        );
        const rescored = ranked.filter((hit) => scores.has(hit.id)).map((hit) => ({ ...hit, score: scores.get(hit.id) }));
        if (rescored.length > 0) {
          ranked = rescored.sort((a, b) => b.score - a.score);
          reranked = true;
        }
      } catch (error) {
        const status = error.status;
        const level = status === 401 || status === 403 || status === 404 ? "error" : "warn";
        this.ctx.logger[level](`knowledge: rerank failed, keeping retrieval order: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const relevanceScores = reranked || requestedMode === "vector";
    const hits = ranked.filter((hit) => relevanceScores ? hit.score >= threshold : true).slice(0, topK).map((hit) => {
      const chunk = byId.get(hit.id);
      if (chunk === void 0) return void 0;
      return {
        chunkId: chunk.id,
        docId: chunk.docId,
        baseId: chunk.baseId,
        documentTitle: store.getDocument(chunk.docId)?.title ?? chunk.docId,
        ...chunk.heading !== void 0 ? { heading: chunk.heading } : {},
        index: chunk.index,
        text: chunk.text,
        ...config.siblingChunks > 0 ? { siblingContext: siblingContextOf(store, chunk, config.siblingChunks) } : {},
        score: hit.score,
        ...hit.vectorScore !== void 0 ? { vectorScore: hit.vectorScore } : {},
        ...hit.lexicalScore !== void 0 ? { lexicalScore: hit.lexicalScore } : {}
      };
    }).filter((hit) => hit !== void 0);
    return {
      query,
      mode: effectiveMode(requestedMode, ranked),
      total,
      reranked,
      elapsedMs: Date.now() - startedAt,
      hits
    };
  }
  // ── internal ──────────────────────────────────────────────────────────────
  /**
   * How many parse+ingest tasks may run concurrently per base (Cherry Studio:
   * 5, on a per-base queue). Local-model inference no longer constrains this:
   * it runs in a dedicated worker thread (see embed.ts), exactly like Cherry's
   * own-worker embedding service.
   */
  static INGEST_CONCURRENCY = 5;
  ingestConcurrency() {
    return _KnowledgeService.INGEST_CONCURRENCY;
  }
  /** Queue one parse+ingest task behind a per-base worker pool (Cherry's job queue). */
  enqueueIngest(baseId, task) {
    let entry = this.ingestQueues.get(baseId);
    if (entry === void 0) {
      entry = { pending: [], running: 0 };
      this.ingestQueues.set(baseId, entry);
    }
    entry.pending.push(task);
    this.pumpIngestQueue(baseId);
  }
  pumpIngestQueue(baseId) {
    const entry = this.ingestQueues.get(baseId);
    if (entry === void 0) return;
    const concurrency = this.ingestConcurrency();
    while (entry.running < concurrency && entry.pending.length > 0) {
      const task = entry.pending.shift();
      if (task === void 0) break;
      entry.running += 1;
      void task().finally(() => {
        entry.running -= 1;
        this.pumpIngestQueue(baseId);
      }).catch((error) => {
        this.ctx.logger.warn(`knowledge: ingest task failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    }
    if (entry.running === 0 && entry.pending.length === 0) this.ingestQueues.delete(baseId);
  }
  /** Serialize a read-then-write section per base (dedup check + first persist). */
  withBaseWriteLock(baseId, fn) {
    const prev = this.baseWriteChains.get(baseId) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    this.baseWriteChains.set(baseId, run.then(() => void 0, () => void 0));
    return run;
  }
  /**
   * Resolve once every queued/active ingest task has settled (all bases).
   * Pipeline/test helper — the HTTP surface never needs it because the client
   * polls /indexing-status. Throws when the tasks do not drain in time.
   * The initial 25ms tick lets a fire-and-forget task (e.g. the in-place
   * backfill after a model change) reach its first indexing entry before the
   * first busy() probe, avoiding a false "idle".
   */
  async waitForIdle(timeoutMs = 15e3) {
    const deadline = Date.now() + timeoutMs;
    await new Promise((resolve4) => setTimeout(resolve4, 25));
    const busy = () => this.indexing.size > 0 || [...this.ingestQueues.values()].some((entry) => entry.running > 0 || entry.pending.length > 0);
    while (busy()) {
      if (Date.now() > deadline) throw new Error("knowledge: ingest tasks did not settle in time");
      await new Promise((resolve4) => setTimeout(resolve4, 25));
    }
  }
  async ingestDocument(input, signal) {
    const store = this.requireStore();
    const config = this.getConfigFor(input.baseId);
    const contentHash = sha256(input.text);
    const half = await this.withBaseWriteLock(input.baseId, async () => {
      if (store.getBase(input.baseId) === void 0) {
        throw new Error("knowledge base no longer exists (deleted while indexing)");
      }
      if (input.placeholderId !== void 0 && store.getDocument(input.placeholderId) === void 0) {
        throw new Error("document no longer exists (deleted while indexing)");
      }
      for (const doc of store.listDocuments(input.baseId)) {
        if (doc.id === input.placeholderId) continue;
        if (doc.contentHash === contentHash) {
          throw new Error(`duplicate document: "${doc.title}" already contains identical content`);
        }
      }
      const docId = input.placeholderId ?? crypto.randomUUID();
      const prior = input.placeholderId !== void 0 ? store.getDocument(docId) : void 0;
      const createdAt = prior?.createdAt ?? Date.now();
      const halfDoc = {
        id: docId,
        baseId: input.baseId,
        title: input.title,
        sourceType: input.sourceType,
        ...input.fileName !== void 0 ? { fileName: input.fileName } : {},
        ...input.mimeType !== void 0 ? { mimeType: input.mimeType } : {},
        ...input.url !== void 0 ? { url: input.url } : {},
        ...input.parentDirectoryId !== void 0 ? { parentDirectoryId: input.parentDirectoryId } : {},
        ...input.rawFilePath !== void 0 ? { rawFilePath: input.rawFilePath } : {},
        contentHash,
        rawText: input.text,
        charCount: input.text.length,
        tokenCount: estimateTokens2(input.text),
        chunkCount: 0,
        incomplete: true,
        createdAt,
        updatedAt: Date.now()
      };
      await store.putDocument(halfDoc);
      return halfDoc;
    });
    const { chunks, embeddingError, embeddingErrorCode } = await this.buildChunks(input.baseId, half.id, input.title, input.text, config, void 0, (batch) => store.putChunkBatch(batch), signal);
    if (store.getDocument(half.id) === void 0 || store.getBase(input.baseId) === void 0) {
      this.indexing.delete(half.id);
      return half;
    }
    const document = {
      ...half,
      chunkCount: chunks.length,
      ...embeddingError !== void 0 ? { embeddingError, ...embeddingErrorCode !== void 0 ? { errorCode: embeddingErrorCode } : {} } : {},
      updatedAt: Date.now()
    };
    await store.putDocument(document);
    await store.putChunks(chunks);
    this.indexing.delete(half.id);
    await this.touchBase(input.baseId);
    return document;
  }
  async buildChunks(baseId, docId, title, text, config, pieces, onBatch, signal) {
    const _fs = await import("node:fs");
    const _skipEmbed = _fs.existsSync((process.env.USERPROFILE || process.env.HOME || "") + "/.dsh/storages/.skip-embed");
    let slices;
    if (pieces !== void 0) {
      slices = pieces;
    } else if (config.semanticChunk) {
      const segments = splitSemanticSegments(text, { separator: config.chunkSeparator });
      let merged = null;
      if (segments.length > 0 && config.embeddingProvider !== "none" && !_skipEmbed) {
        try {
          const vectors = [];
          const batchSize = Math.max(1, config.embeddingBatchSize);
          for (let i = 0; i < segments.length; i += batchSize) {
            const batch = segments.slice(i, i + batchSize);
            const embedded = await this.embedTextsOnce(config, batch.map((segment) => segment.text));
            for (const vector of embedded) vectors.push(vector);
          }
          merged = mergeSemanticSegments(segments, vectors, config.chunkSize, config.semanticChunkThreshold);
        } catch (error) {
          this.ctx.logger.warn(`knowledge: semantic chunking embedding failed, using regular chunker: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      slices = merged !== null && merged.length > 0 ? merged : chunkText(text, config.chunkSize, config.chunkOverlap, {
        smartChunk: config.smartChunk,
        separator: config.chunkSeparator
      });
    } else {
      slices = chunkText(text, config.chunkSize, config.chunkOverlap, {
        smartChunk: config.smartChunk,
        separator: config.chunkSeparator
      });
    }
    if (config.chunkTokenLimit > 0) {
      slices = refineChunksByTokenLimit(slices, config.chunkTokenLimit, estimateTokens2);
    }
    const guardedOnBatch = onBatch !== void 0 ? (batch) => {
      this.assertIndexTargetAlive(docId, baseId);
      return onBatch(batch);
    } : void 0;
    const chunks = slices.map((piece, index) => ({
      id: crypto.randomUUID(),
      docId,
      baseId,
      index,
      text: piece.text,
      ...piece.heading !== void 0 ? { heading: piece.heading } : {},
      ...piece.embedding !== void 0 ? { embedding: piece.embedding } : {},
      context: piece.heading !== void 0 ? `${title} > ${piece.heading}` : title
    }));
    let embeddingError;
    let embeddingErrorCode;
    if (config.embeddingProvider !== "none" && chunks.length > 0 && !_skipEmbed) {
      const key = embeddingKey(config);
      this.indexing.set(docId, { baseId, title, phase: "embedding", total: chunks.length, progress: 0 });
      try {
        const hashes = chunks.map((chunk) => hashEmbeddingText(chunkSearchText(chunk)));
        const stored = key !== void 0 ? this.requireStore().listEmbeddingVectorsByHashes(hashes, key) : /* @__PURE__ */ new Map();
        const storedDimension = [...stored.values()][0]?.length;
        const need = [];
        const needTexts = [];
        for (let i = 0; i < chunks.length; i += 1) {
          if (chunks[i].embedding !== void 0 && key !== void 0) {
            chunks[i] = { ...chunks[i], embeddingModel: key };
            continue;
          }
          const cached = stored.get(hashes[i]);
          if (cached !== void 0) {
            chunks[i] = { ...chunks[i], embedding: cached, ...key !== void 0 ? { embeddingModel: key } : {} };
          } else {
            need.push(i);
            needTexts.push(chunkSearchText(chunks[i]));
          }
        }
        const batchSize = config.embeddingProvider === "local" ? Math.min(config.embeddingBatchSize, 8) : config.embeddingBatchSize;
        for (let i = 0; i < need.length; i += batchSize) {
          const batch = need.slice(i, i + batchSize);
          const batchTexts = needTexts.slice(i, i + batchSize);
          const vectors = await this.embedWithRetry(config, batchTexts, signal);
          const widths = new Set(vectors.map((vector) => vector.length));
          if (widths.size > 1) {
            throw new Error(`embedding returned mixed vector dimensions: ${[...widths].join(", ")}`);
          }
          const width = vectors[0]?.length ?? 0;
          if (width === 0) throw new Error("embedding returned empty vectors");
          if (storedDimension !== void 0 && storedDimension !== width) {
            embeddingErrorCode = "dimension_mismatch";
            throw new Error(`embedding vector dimension ${width} does not match the ${storedDimension} already stored for model "${key}" \u2014 switch back or reindex the base`);
          }
          const done = [];
          for (let j = 0; j < batch.length; j += 1) {
            const index = batch[j];
            chunks[index] = { ...chunks[index], embedding: vectors[j], ...key !== void 0 ? { embeddingModel: key } : {} };
            done.push(chunks[index]);
          }
          if (guardedOnBatch !== void 0) await guardedOnBatch(done);
          this.indexing.set(docId, { baseId, title, phase: "embedding", total: need.length, progress: Math.round(Math.min(i + batch.length, need.length) / need.length * 100) });
        }
      } catch (error) {
        embeddingError = error instanceof Error ? error.message : String(error);
        embeddingErrorCode ??= "embedding_provider";
        this.ctx.logger.warn(`knowledge: embedding during import failed, storing lexical-only chunks: ${embeddingError}`);
      } finally {
        const active = this.indexing.get(docId);
        this.indexing.delete(docId);
        if (active !== void 0) {
          this.progressLinger.set(docId, {
            baseId,
            title,
            phase: active.phase,
            progress: active.progress,
            expireAt: Date.now() + PROGRESS_LINGER_TTL_MS
          });
        }
      }
    }
    return { chunks, embeddingError, embeddingErrorCode };
  }
  /** Embed one batch through the configured provider (empty input → empty output). */
  async embedTextsOnce(config, texts, signal) {
    if (texts.length === 0) return [];
    return embedTexts(
      config.embeddingProvider,
      config.embeddingBaseUrl,
      config.embeddingModel,
      config.embeddingApiKey,
      texts,
      signal
    );
  }
  /**
   * Embed with Cherry's job retry policy: 3 attempts, exponential backoff
   * (1s → 30s), so a transient provider/network failure self-heals instead of
   * degrading a whole import to lexical-only. An external abort (delete)
   * interrupts the request chain immediately.
   */
  async embedWithRetry(config, texts, signal) {
    let attempt = 1;
    for (; ; ) {
      if (signal?.aborted === true) throw new Error("embedding aborted (document was deleted)");
      try {
        return await this.embedTextsOnce(config, texts, signal);
      } catch (error) {
        if (attempt >= EMBED_MAX_ATTEMPTS) throw error;
        const delay = Math.min(EMBED_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1), EMBED_RETRY_MAX_DELAY_MS);
        attempt += 1;
        this.ctx.logger.warn(`knowledge: embedding attempt ${attempt - 1}/${EMBED_MAX_ATTEMPTS} failed, retrying in ${delay}ms: ${error instanceof Error ? error.message : String(error)}`);
        await new Promise((resolve4) => setTimeout(resolve4, delay));
      }
    }
  }
  /** Bump the base's updatedAt so the data view's "更新于" stays meaningful. */
  async touchBase(baseId) {
    const store = this.requireStore();
    const base = store.getBase(baseId);
    if (base !== void 0) await store.putBase({ ...base, updatedAt: Date.now() });
  }
  requireStore() {
    if (this.store === void 0) throw new Error("knowledge store is not ready");
    return this.store;
  }
};
function chunkSearchText(chunk) {
  return chunk.context !== void 0 && chunk.context.length > 0 ? `${chunk.context}
${chunk.text}` : chunk.text;
}
function embeddingKey(config) {
  if (config.embeddingProvider === "none") return void 0;
  const model = config.embeddingModel.trim() === "" && config.embeddingProvider === "local" ? DEFAULT_LOCAL_MODEL : config.embeddingModel.trim();
  if (model === "") return void 0;
  return `${config.embeddingProvider}:${model}`;
}
function effectiveMode(requested, ranked) {
  if (requested === "vector" || requested === "lexical") return requested;
  const hybrid = ranked.some((hit) => hit.vectorScore !== void 0 && hit.lexicalScore !== void 0);
  if (requested === "hybrid") return hybrid ? "hybrid" : "lexical";
  return hybrid ? "hybrid" : "lexical";
}
function sha256(text) {
  return createHash2("sha256").update(text, "utf8").digest("hex");
}
function estimateTokens2(text) {
  const cjk = (text.match(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/g) ?? []).length;
  const latin = text.length - cjk;
  return Math.max(1, Math.ceil(cjk / 1.5 + latin / 4));
}
function reconstructFromChunks(chunks) {
  return chunks.slice().sort((a, b) => a.index - b.index).map((chunk) => chunk.text).join("\n\n");
}
function siblingContextOf(store, chunk, radius) {
  const neighbours = store.listChunksByIndexRange(chunk.docId, chunk.index - radius, chunk.index + radius);
  const parts = [];
  for (const sibling of neighbours) {
    if (sibling.id === chunk.id) continue;
    const heading = sibling.heading !== void 0 ? `[${sibling.heading}] ` : "";
    parts.push(`${heading}${sibling.text}`);
  }
  return parts.join("\n\n");
}
function clampInt2(value, min, max, fallback) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
function compactBaseConfig(config) {
  const next = {};
  for (const [key, value] of Object.entries(config)) {
    if (typeof value === "string") {
      if (value.trim().length > 0) next[key] = value;
    } else if (typeof value === "boolean") {
      next[key] = value;
    } else if (value !== void 0 && Number.isFinite(value)) {
      next[key] = value;
    }
  }
  return next;
}
function mergeBaseConfig(existing, patch) {
  const merged = { ...existing ?? {} };
  for (const [key, value] of Object.entries(patch)) {
    if (typeof value === "string" && value.trim() === "") {
      delete merged[key];
    } else {
      merged[key] = value;
    }
  }
  return merged;
}
function decodeBase64(value) {
  if (typeof Buffer !== "undefined") return Buffer.from(value, "base64");
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
function encodeUtf8(text) {
  return new TextEncoder().encode(text);
}
function safeRawExtension(fileName) {
  const ext = extname2(fileName).toLowerCase();
  return /^\.[a-z0-9]{1,10}$/.test(ext) ? ext : ".bin";
}
function rawExtensionOf(relativePath) {
  const ext = extname2(relativePath).toLowerCase();
  return /^\.[a-z0-9]{1,10}$/.test(ext) ? ext : ".bin";
}
var BLOCKED_URL_HOSTS = /* @__PURE__ */ new Set([
  "localhost",
  "127.0.0.1",
  "[::1]",
  "[::]",
  "0.0.0.0",
  "169.254.169.254",
  "metadata.google.internal"
]);
function isBlockedUrlHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (BLOCKED_URL_HOSTS.has(host)) return true;
  if (/^127\./.test(host)) return true;
  if (/^(10\.|192\.168\.)/.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  if (/^169\.254\./.test(host)) return true;
  if (/^0\./.test(host)) return true;
  return false;
}
async function fetchHtml(url) {
  let current = url;
  for (let hop = 0; hop <= 5; hop += 1) {
    let parsed;
    try {
      parsed = new URL(current);
    } catch {
      throw new Error(`invalid URL: ${current}`);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(`URL protocol not allowed: ${parsed.protocol}`);
    }
    if (isBlockedUrlHost(parsed.hostname)) {
      throw new Error(`URL host not allowed: ${parsed.hostname}`);
    }
    const response = await httpFetch(parsed.toString(), {
      method: "GET",
      headers: { "user-agent": "dsh-knowledge/0.1 (+knowledge-base-import)" },
      timeoutMs: 3e4,
      redirect: "manual"
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (location === null) throw new Error(`URL redirect without Location (HTTP ${response.status})`);
      current = new URL(location, parsed).toString();
      continue;
    }
    if (!response.ok) throw new Error(`URL fetch failed: HTTP ${response.status}`);
    const contentType = (response.headers.get("content-type") ?? "").split(";", 1)[0]?.trim().toLowerCase();
    if (contentType !== "" && contentType !== "text/html" && contentType !== "application/xhtml+xml") {
      throw new Error(`URL did not return HTML (content-type: ${contentType || "unknown"})`);
    }
    return response.text();
  }
  throw new Error("URL redirect limit exceeded");
}
var SUPPORTED_DOCUMENT_EXTENSION_SET = new Set(SUPPORTED_DOCUMENT_EXTENSIONS);
var DIRECTORY_EXTENSIONS = new Set(SUPPORTED_DOCUMENT_EXTENSIONS.map((ext) => `.${ext}`));
var DIRECTORY_MAX_FILES = 500;
var DIRECTORY_MAX_DEPTH = 8;
async function scanDirectory(root) {
  const found = [];
  async function walk(dir, depth) {
    if (depth > DIRECTORY_MAX_DEPTH || found.length >= DIRECTORY_MAX_FILES) return;
    let entries;
    try {
      entries = await readdir2(dir, { withFileTypes: true });
    } catch (error) {
      throw new Error(`cannot read directory ${root}: ${error instanceof Error ? error.message : String(error)}`);
    }
    for (const entry of entries) {
      if (found.length >= DIRECTORY_MAX_FILES) return;
      const full = join5(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
      } else if (entry.isFile() && DIRECTORY_EXTENSIONS.has(extname2(entry.name).toLowerCase())) {
        found.push(full);
      }
    }
  }
  await walk(root, 0);
  return found;
}
var index_default = KnowledgeService;
export {
  Config,
  ConflictError,
  DEFAULT_LOCAL_MODEL,
  KnowledgeService,
  MODEL_SUGGESTIONS,
  chunkText,
  cosineSimilarity2 as cosineSimilarity,
  index_default as default,
  embedTexts,
  getLocalModelStatus,
  knowledgeDomainSpec,
  rank,
  tokenize
};
//# sourceMappingURL=index.js.map
