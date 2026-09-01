/**
 * Local model inference worker — Cherry Studio's "in its own worker" model:
 * transformers.js / onnxruntime run off the main process, so the ~600MB
 * embedding model (and any local reranker) plus every inference intermediate
 * tensor lives in this worker's heap and can never freeze the host process.
 *
 * Wire protocol (JSON messages over parentPort):
 *   main → worker:  { id, type: 'embed'|'load'|'rerank', modelId, cacheDir, hfEndpoint?, texts?, query?, pooling?, task? }
 *                    { type: 'cancel'|'release', modelId }
 *                    { type: 'shutdown' }
 *   worker → main:  { id, ok: true, vectors? | scores? } | { id, ok: false, error }
 *                    { type: 'progress', modelId, status, progress, message }
 *
 * Inference is serialized inside the worker (Cherry's inference queue has
 * concurrency 1 for the same reason: transformers.js gives no concurrency
 * guarantee for parallel runs on one pipeline instance).
 * @module dsh-knowledge/knowledge/embed-worker
 */
export {};
//# sourceMappingURL=embed-worker.d.ts.map