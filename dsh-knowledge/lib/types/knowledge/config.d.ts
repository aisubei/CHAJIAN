/**
 * Plugin configuration (schemastery) and resolved-config merging. The
 * cordis.yml `config:` block supplies deployment defaults; the browser panel
 * can override them at runtime (persisted in the domain global slot), and
 * every base can layer its own per-base config on top.
 * @module dsh-knowledge/knowledge/config
 */
import Schema from '@deepseek-ai/schemastery';
import type { ConfigOverrides } from './domain.js';
import type { BaseConfig, EmbeddingProvider, KnowledgeConfig, SearchMode } from './types.js';
export interface Config {
    embeddingProvider: EmbeddingProvider;
    embeddingBaseUrl: string;
    embeddingModel: string;
    embeddingApiKey: string;
    rerankModel: string;
    rerankBaseUrl: string;
    rerankApiKey: string;
    smartChunk: boolean;
    chunkSeparator: string;
    chunkSize: number;
    chunkOverlap: number;
    topK: number;
    searchMode: SearchMode;
    similarityThreshold: number;
    mmrDiversity: number;
    /** Relative weight of the vector lane in RRF hybrid fusion (0.1–5, 1 = balanced). */
    rrfVectorWeight: number;
    embeddingBatchSize: number;
    /** Neighbouring chunks (±) attached to each search hit as context (0–3). */
    siblingChunks: number;
    /** Local-model cache root; empty = `<DSH_HOME>/cache/dsh-knowledge/local-models`. */
    localModelCacheDir: string;
    /** Hugging Face endpoint override (mirror); empty = official hub / `HF_ENDPOINT` env. */
    hfEndpoint: string;
    /** Chunk SQLite file; empty = `<DSH_HOME>/storages/knowledge-chunks.sqlite`. */
    chunkStorePath: string;
    /** Document processor: `builtin` (local parsers + OCR) or `mineru` (remote MinerU API). */
    documentProcessorProvider: 'builtin' | 'mineru';
    /** MinerU API key (required when provider is `mineru`). */
    mineruApiKey: string;
    /** MinerU API host; empty = https://mineru.net */
    mineruApiHost: string;
    /** Semantic chunking: embed paragraph-level segments and merge similar adjacent ones. */
    semanticChunk: boolean;
    /** Cosine threshold below which adjacent segments start a new chunk (0–1). */
    semanticChunkThreshold: number;
    /** Token budget per chunk (0 = off); oversized chunks split at preferred boundaries. */
    chunkTokenLimit: number;
    /** Same-name conflict strategy for file imports: keep / replace / rename (Cherry's default). */
    conflictStrategy: 'keep' | 'replace' | 'rename';
    /** Auto-refresh URL documents older than this many hours (0 = off). */
    urlRefreshHours: number;
    /** Image/table captioning: `off` / `openai` (vision chat API) / `ollama` (local VLM). */
    imageCaptionProvider: 'off' | 'openai' | 'ollama';
    /** Captioning model id (OpenAI-compatible vision model, or an Ollama VLM like llava / qwen2.5vl). */
    imageCaptionModel: string;
    /** Captioning API root; empty = the embedding base URL (openai) or http://127.0.0.1:11434 (ollama). */
    imageCaptionBaseUrl: string;
    /** Captioning API key (openai provider). */
    imageCaptionApiKey: string;
    /**
     * Re-run interrupted imports on startup (hash reuse re-embeds only the
     * batches that never landed). Off = mark them failed instead — Cherry's
     * posture: a deliberate app quit must not re-spend the embedding API.
     */
    resumeInterruptedOnStartup: boolean;
}
export declare const Config: Schema<Config>;
/** Resolve a full config from deployment defaults plus runtime overrides. */
export declare function resolveConfig(config: Config, overrides: ConfigOverrides): KnowledgeConfig;
/**
 * Resolve one base's effective config: plugin defaults, then global runtime
 * overrides, then that base's own per-base config (highest precedence for
 * the fields it sets).
 */
export declare function resolveConfigFor(config: Config, overrides: ConfigOverrides, baseConfig?: BaseConfig): KnowledgeConfig;
//# sourceMappingURL=config.d.ts.map