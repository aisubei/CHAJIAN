/**
 * Embedding providers. `openai` targets any OpenAI-compatible `/embeddings`
 * endpoint; `ollama` targets a local Ollama server; `local` runs an embedding
 * model through transformers.js in a DEDICATED WORKER THREAD (Cherry Studio's
 * "in its own worker" model): the ~600MB model and every inference tensor live
 * off the main process, so a large import batch can never freeze the host.
 * Every provider returns one L2-normalized vector per input text.
 * @module dsh-knowledge/knowledge/embed
 */
import type { EmbeddingProvider } from './types.js';
/** Default in-process model — the ONNX repo Cherry Studio ships. */
export declare const DEFAULT_LOCAL_MODEL = "onnx-community/Qwen3-Embedding-0.6B-ONNX";
/**
 * Override the local-model cache root from deployment config. An empty or
 * unset value falls back to DSH's shared home resolution (`$DSH_HOME` → `~/.dsh`).
 */
export declare function setLocalModelCacheDir(dir: string | undefined): void;
/**
 * Override the Hugging Face endpoint from deployment/runtime config — the
 * mirror switch for networks that cannot reach huggingface.co directly
 * (e.g. `https://hf-mirror.com`). An empty value falls back to the
 * `HF_ENDPOINT` environment variable, then to the official hub.
 */
export declare function setHfEndpoint(url: string | undefined): void;
/** The effective HF endpoint override (mirror), or undefined (tests/telemetry). */
export declare function getHfEndpoint(): string | undefined;
export declare function expandHomePath(input: string): string;
/** Persistent cache directory for downloaded local models (mirrors DSH's `resolveDshHome`). */
export declare function localModelCacheDir(): string;
/** Embed many texts into normalized vectors. Throws when the provider is `none` or the call fails. */
export declare function embedTexts(provider: EmbeddingProvider, baseUrl: string, model: string, apiKey: string, texts: readonly string[], signal?: AbortSignal): Promise<number[][]>;
export interface LocalModelStatus {
    model: string;
    status: 'idle' | 'downloading' | 'ready' | 'error';
    /** 0–100 download progress while `downloading`. */
    progress: number;
    message: string;
}
type Pooling = 'last_token' | 'cls' | 'mean';
/**
 * Per-model pooling strategy, mirroring Cherry Studio's `pooling.ts`: the
 * model family decides how the token embeddings are collapsed into one vector.
 * - Qwen3-Embedding → last-token pooling
 * - BGE (small/base, zh/en) → CLS token pooling
 * - GTE / E5 → mean pooling (transformers.js default)
 * Unknown ids fall back to mean pooling, which is the safest general choice.
 */
export declare function poolingFor(modelId: string): Pooling;
export declare function getLocalModelStatus(modelId: string): LocalModelStatus;
/** Surface a background download/load failure so the settings poller can show it (never swallow). */
export declare function markLocalModelError(modelId: string, message: string): void;
/** Whether a model's cached weights are already on disk (a real `.onnx` weight file). */
export declare function isLocalModelDownloaded(modelId: string): Promise<boolean>;
/**
 * Local cross-encoder rerank (bge-reranker family): scores each candidate
 * text against the query, index-aligned. Runs in the same worker thread.
 */
export declare function rerankLocal(modelId: string, query: string, texts: readonly string[]): Promise<number[]>;
/** Download + load a local model in the worker (no inference; progress reports via /local-model-status). */
export declare function loadLocalModel(modelId: string, task?: 'feature-extraction' | 'reranking'): Promise<void>;
/** Cancel an in-flight download; the next progress tick throws and aborts the load. */
export declare function cancelLocalModel(modelId: string): Promise<void>;
/** Drop a loaded extractor (frees its ~600MB in the worker) and delete its cached weights from disk. */
export declare function removeLocalModel(modelId: string): Promise<void>;
/** Terminate the worker (plugin teardown). Idempotent; resolves once the
 *  worker thread has actually exited so callers can then move/delete the
 *  cached weights without a Windows mmap file lock blocking the operation. */
export declare function disposeLocalModelWorker(): Promise<void>;
/** Whether any local model download is currently in flight (migration guard). */
export declare function hasActiveLocalModelDownload(): boolean;
/** L2-normalize a vector in place. */
export declare function normalize(vector: number[]): number[];
export {};
//# sourceMappingURL=embed.d.ts.map