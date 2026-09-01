// src/knowledge/embed-worker.ts
import { parentPort } from "node:worker_threads";
import { join } from "node:path";
import { readdir } from "node:fs/promises";

// src/knowledge/net.ts
import { EnvHttpProxyAgent, setGlobalDispatcher } from "undici";
var proxyApplied = false;
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
var NETWORK_HINT = "\u82E5\u65E0\u6CD5\u8BBF\u95EE huggingface.co\uFF1A\u5728\u300C\u672C\u5730\u6A21\u578B\u300D\u9875\u9762\u8BBE\u7F6E\u955C\u50CF\u7AD9\uFF08\u5982 https://hf-mirror.com\uFF09\uFF0C\u6216\u914D\u7F6E HTTP(S)_PROXY \u4EE3\u7406\u540E\u91CD\u542F\u670D\u52A1\u3002";

// src/knowledge/embed-worker.ts
applyGlobalProxy();
function sigmoid(value) {
  return 1 / (1 + Math.exp(-value));
}
var transformers = null;
var runners = /* @__PURE__ */ new Map();
var cancelledModels = /* @__PURE__ */ new Set();
var inferenceChain = Promise.resolve();
function post(message) {
  parentPort?.postMessage(message);
}
async function loadTransformers() {
  if (transformers !== null) return transformers;
  transformers = await import("@huggingface/transformers");
  return transformers;
}
function applyEndpoint(tf, hfEndpoint) {
  if (hfEndpoint !== void 0 && hfEndpoint.trim() !== "") {
    tf.env.remoteHost = hfEndpoint.trim().replace(/\/+$/, "");
  }
}
async function isDownloaded(modelId, cacheDir) {
  try {
    const entries = await readdir(join(cacheDir, modelId, "onnx"));
    return entries.some((name) => name.endsWith(".onnx"));
  } catch {
    return false;
  }
}
async function createRunner(task, modelId, cacheDir, hfEndpoint) {
  const tf = await loadTransformers();
  applyEndpoint(tf, hfEndpoint);
  tf.env.cacheDir = cacheDir;
  let lastProgressAt = 0;
  if (!await isDownloaded(modelId, cacheDir)) {
    post({ type: "progress", modelId, status: "downloading", progress: 0, message: "" });
    const progressCallback = (info) => {
      if (cancelledModels.has(modelId)) throw new Error("download cancelled");
      if (info.status === "progress" && typeof info.progress === "number") {
        const now = Date.now();
        if (now - lastProgressAt >= 250) {
          lastProgressAt = now;
          post({ type: "progress", modelId, status: "downloading", progress: info.progress, message: "" });
        }
      }
    };
    try {
      if (task === "reranking") {
        await tf.AutoModel.from_pretrained(modelId, { dtype: "q8", progress_callback: progressCallback });
        await tf.AutoTokenizer.from_pretrained(modelId, { progress_callback: progressCallback });
      } else {
        await tf.pipeline(task, modelId, {
          dtype: "q8",
          progress_callback: progressCallback
        });
      }
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      const cancelled = cancelledModels.has(modelId);
      post({
        type: "progress",
        modelId,
        status: cancelled ? "idle" : "error",
        progress: 0,
        message: cancelled ? "" : `${raw} \xB7 ${NETWORK_HINT}`
      });
      if (cancelled) post({ type: "cancelled", modelId });
      throw error;
    }
  }
  post({ type: "progress", modelId, status: "ready", progress: 100, message: "" });
  if (task === "reranking") {
    const model = await tf.AutoModel.from_pretrained(join(cacheDir, modelId), { dtype: "q8" });
    const tokenizer = await tf.AutoTokenizer.from_pretrained(join(cacheDir, modelId));
    return {
      // Cross-encoder relevance scoring, hand-rolled for transformers.js
      // versions without the `reranking` pipeline: tokenize [query, doc]
      // pairs, run the model, sigmoid the logits (the reference pipeline's
      // exact math). Batched so a large pool never allocates one giant tensor.
      rerank: async (query, texts) => {
        if (texts.length === 0) return [];
        const scores = [];
        const BATCH = 16;
        for (let i = 0; i < texts.length; i += BATCH) {
          const batch = texts.slice(i, i + BATCH);
          const inputs = await tokenizer(batch.map((doc) => [query, doc]), { padding: true, truncation: true });
          const outputs = await model(inputs);
          const logits = outputs.logits;
          if (logits === void 0 || logits.data === void 0) {
            throw new Error("rerank model returned no logits");
          }
          for (let j = 0; j < batch.length; j += 1) {
            scores.push(sigmoid(logits.data[j] ?? 0));
          }
        }
        return scores;
      }
    };
  }
  const pipeline = await tf.pipeline(task, join(cacheDir, modelId), { dtype: "q8" });
  const embed = pipeline;
  return {
    embed: async (texts, pooling) => {
      const output = await embed(texts, { pooling, normalize: true });
      return output.tolist();
    }
  };
}
function getRunner(task, modelId, cacheDir, hfEndpoint) {
  const key = `${task}:${modelId}`;
  const cached = runners.get(key);
  if (cached !== void 0) return cached;
  const pending = createRunner(task, modelId, cacheDir, hfEndpoint);
  runners.set(key, pending);
  pending.catch(() => {
    if (runners.get(key) === pending) runners.delete(key);
  });
  return pending;
}
function dropRunners(modelId) {
  cancelledModels.delete(modelId);
  runners.delete(`feature-extraction:${modelId}`);
  runners.delete(`reranking:${modelId}`);
}
parentPort?.on("message", (message) => {
  if (message.type === "shutdown") {
    process.exit(0);
    return;
  }
  if (message.type === "cancel") {
    cancelledModels.add(message.modelId);
    setTimeout(() => {
      cancelledModels.delete(message.modelId);
    }, 3e4).unref?.();
    return;
  }
  if (message.type === "release") {
    dropRunners(message.modelId);
    post({ type: "released", modelId: message.modelId });
    return;
  }
  const { id, type, modelId, cacheDir, hfEndpoint } = message;
  const task = message.task ?? "feature-extraction";
  void getRunner(task, modelId, cacheDir, hfEndpoint).then(async (runner) => {
    if (type === "load") {
      post({ id, ok: true });
      return;
    }
    if (type === "rerank") {
      const run2 = inferenceChain.then(() => runner.rerank(message.query ?? "", message.texts ?? []));
      inferenceChain = run2.then(() => void 0, () => void 0);
      post({ id, ok: true, scores: await run2 });
      return;
    }
    const run = inferenceChain.then(() => runner.embed(message.texts ?? [], message.pooling ?? "mean"));
    inferenceChain = run.then(() => void 0, () => void 0);
    post({ id, ok: true, vectors: await run });
  }).catch((error) => {
    post({ id, ok: false, error: error instanceof Error ? error.message : String(error) });
  });
});
//# sourceMappingURL=embed-worker.mjs.map
