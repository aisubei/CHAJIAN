/**
 * The host knowledge service (`ctx.knowledge`): durable bases/documents/chunks
 * over `ctx.storageDomain`, heading-aware chunking with context injection,
 * batched embeddings, hybrid retrieval (BM25 + vector + MMR), deduplication,
 * reindexing, URL import, and statistics — plus a JSON HTTP surface.
 * @module dsh-knowledge/knowledge
 */
import { Context, Service } from '@deepseek-ai/cordis';
import { Config } from './config.js';
import type { ConfigOverrides } from './domain.js';
import type { LocalModelStatus } from './embed.js';
import type { LocalModelSummary } from './localModels.js';
import { type OcrModelStatus } from './ocr.js';
import { type OllamaPullStatus } from './ollama.js';
import type { AddFileDocumentRequest, AddFilesRequest, AddFilesResult, AddTextDocumentRequest, BaseConfig, BaseStats, BaseSummary, CreateBaseRequest, DocumentDetail, DocumentSourceType, DocumentSummary, EmbeddingProvider, ImportDirectoryRequest, ImportUrlRequest, KnowledgeBase, KnowledgeChunk, KnowledgeConfig, KnowledgeDocument, SearchRequest, SearchResult, UpdateBaseRequest } from './types.js';
export type * from './types.js';
export { Config } from './config.js';
export { knowledgeDomainSpec } from './domain.js';
export { chunkText } from './chunk.js';
export { embedTexts, getLocalModelStatus, DEFAULT_LOCAL_MODEL } from './embed.js';
export { tokenize, cosineSimilarity, rank } from './retrieval.js';
declare module '@deepseek-ai/cordis' {
    interface Context {
        knowledge: KnowledgeService;
    }
}
/** Curated model-id suggestions for the settings comboboxes (DSH exposes chat models, not embedding models). */
export declare const MODEL_SUGGESTIONS: {
    readonly embedding: readonly ["text-embedding-3-small", "text-embedding-3-large", "text-embedding-ada-002", "bge-m3", "bge-large-zh-v1.5", "bge-small-zh-v1.5", "nomic-embed-text", "mxbai-embed-large", "snowflake-arctic-embed2"];
    readonly local: string[];
    readonly rerank: readonly ["jina-reranker-v2-base-multilingual", "BAAI/bge-reranker-v2-m3", "bge-reranker-base", "bce-reranker-base_v1", "local:Xenova/bge-reranker-base"];
    readonly ollamaEmbedding: readonly ["nomic-embed-text", "bge-m3", "qwen3-embedding:0.6b", "mxbai-embed-large", "snowflake-arctic-embed"];
    readonly ollamaVision: readonly ["llava", "qwen2.5vl:7b", "llama3.2-vision:11b", "minicpm-v:8b"];
};
interface BackgroundJob {
    readonly baseId: string;
    /** Human label for the unit of work (file name or document title). */
    kind: 'directory' | 'reindex';
    cancelled: boolean;
    imported: number;
    skipped: number;
    total: number;
    current: string;
    errors: Array<{
        file: string;
        error: string;
    }>;
    done: boolean;
}
/** Raised by same-name conflict detection (`conflict: 'detect'`); the HTTP
 *  layer maps it to 409 Conflict so callers can re-submit with a strategy. */
export declare class ConflictError extends Error {
    readonly code = "conflict";
}
export declare class KnowledgeService extends Service {
    static inject: string[];
    static Config: import("@deepseek-ai/schemastery").default<Config>;
    private readonly baseConfig;
    private store;
    private readonly storeReady;
    private resolveStore;
    private readonly jobs;
    private readonly indexing;
    /**
     * Progress values that linger after a job exits (Cherry's 60s TTL), so the
     * list keeps showing the final percentage until the poll observes the
     * terminal status instead of blanking mid-frame. Purely a display aid —
     * every guard still consults {@link indexing}, never this map.
     */
    private readonly progressLinger;
    private readonly ingestQueues;
    private readonly baseWriteChains;
    constructor(ctx: Context, config: Config);
    protected [Service.init](): Promise<void>;
    private urlRefreshTimer;
    private urlRefreshing;
    /** Arm the hourly sweep that refreshes URL documents older than `urlRefreshHours`. */
    private armUrlRefreshTimer;
    /** Re-fetch every URL document whose last update predates `hours`; failures are logged, never thrown. */
    private refreshStaleUrls;
    /**
     * Re-index documents a crash left mid-import. Each document holds rawText
     * and/or a persisted raw source file; hash reuse (decision A4) makes the
     * re-embed re-embed only missing batches. A placeholder that only has the
     * raw file (crash before/during parse) is re-parsed from source. Runs in
     * the background so startup is not blocked.
     */
    private resumeInterruptedDocuments;
    /** Wait until the durable store is ready; the HTTP route awaits this. */
    whenReady(): Promise<void>;
    getConfig(): KnowledgeConfig;
    /** Static model-id suggestions for the settings comboboxes. */
    modelSuggestions(): typeof MODEL_SUGGESTIONS;
    /** Resolve one base's effective config (global + that base's overrides). */
    getConfigFor(baseId?: string): KnowledgeConfig;
    setConfig(overrides: ConfigOverrides): Promise<KnowledgeConfig>;
    isEnabled(): boolean;
    setEnabled(enabled: boolean): Promise<void>;
    getEnabledBaseIds(): string[];
    setEnabledBaseIds(ids: readonly string[]): Promise<void>;
    /**
     * Resolve the effective search scope for a model call: the enabled base ids,
     * or `undefined` when none are pinned (meaning "every base", Cherry's no-binding case).
     */
    enabledScope(): string[] | undefined;
    createBase(request: CreateBaseRequest): Promise<KnowledgeBase>;
    /** Cherry-style restore: re-embed every source document into a fresh base
     *  (with the source's current config), returning the new base. Raw source
     *  files are copied across so the restored base keeps the rebuild source. */
    restoreBase(sourceBaseId: string, name: string, config?: BaseConfig): Promise<KnowledgeBase>;
    deleteBase(id: string): Promise<void>;
    renameBase(id: string, request: UpdateBaseRequest): Promise<KnowledgeBase>;
    listBases(): BaseSummary[];
    listGroups(): string[];
    createGroup(name: string): Promise<string[]>;
    renameGroup(from: string, to: string): Promise<string[]>;
    deleteGroup(name: string): Promise<void>;
    addTextDocument(request: AddTextDocumentRequest): Promise<KnowledgeDocument>;
    addFileDocument(request: AddFileDocumentRequest): Promise<KnowledgeDocument & {
        skipped?: boolean;
    }>;
    /**
     * Batch file add with Cherry's server-authoritative conflict detection:
     * `conflict: 'detect'` reports every same-name collision (against existing
     * documents AND within the batch) without adding anything; `rename`/`replace`
     * add the whole batch under that strategy. The detect round may omit file
     * contents (names alone suffice); a clean detect returns `clean` so the
     * caller re-submits with contents under the rename strategy.
     */
    addFiles(request: AddFilesRequest): Promise<AddFilesResult>;
    /** Start importing a local directory as a cancellable background job. */
    importDirectory(request: ImportDirectoryRequest): Promise<{
        jobId: string;
        total: number;
    }>;
    /** Progress snapshot of an active (or just-finished) directory import. */
    directoryImportStatus(jobId: string): BackgroundJob | undefined;
    cancelDirectoryImport(jobId: string): void;
    private runDirectoryImport;
    private pruneJobs;
    /** Create a directory container item (no chunks) under an optional parent. */
    createDirectory(baseId: string, title: string, parentDirectoryId?: string): Promise<KnowledgeDocument>;
    /** Import a local directory as a nested tree of directory containers + file items. */
    importDirectoryTree(baseId: string, path: string, parentDirectoryId?: string): Promise<{
        imported: number;
        directories: number;
        errors: Array<{
            file: string;
            error: string;
        }>;
    }>;
    addUrlDocument(request: ImportUrlRequest): Promise<KnowledgeDocument>;
    /**
     * Cherry-style URL refresh: re-fetch the page, and when its text changed,
     * overwrite the snapshot and re-index the document (hash reuse re-embeds
     * only the chunks that changed). A failed fetch or an unchanged page leaves
     * the current snapshot and index untouched — refresh never degrades.
     */
    refreshUrlDocument(id: string): Promise<{
        changed: boolean;
        title: string;
        chunkCount: number;
    }>;
    deleteDocument(id: string): Promise<void>;
    /** Threshold-gated space reclamation after a delete (Cherry's reclaimSpace). */
    private reclaimAfterDelete;
    /** Delete one document (recursing into directory containers), one write per item. */
    private deleteDocumentRecursive;
    /**
     * Throw when the document (or its base) vanished while indexing was in
     * flight — Cherry's deleting-guard: a delete that lands mid-import or
     * mid-reindex must never be resurrected by the finishing writes, and chunks
     * must never land under a deleted base.
     */
    private assertIndexTargetAlive;
    renameDocument(id: string, title: string): Promise<KnowledgeDocument>;
    reindexDocument(id: string): Promise<KnowledgeDocument>;
    /** Rebuild source text of a document: raw file first, then persisted text, then chunks. */
    private sourceTextOf;
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
    private rescanDirectory;
    private rescanDirectoryInner;
    reindexBase(baseId: string): Promise<{
        reindexed: number;
    }>;
    /** Start re-embedding a whole base as a cancellable background job. */
    startReindexBase(baseId: string): Promise<{
        jobId: string;
        total: number;
    }>;
    /** Progress snapshot of an active (or just-finished) reindex job. */
    reindexJobStatus(jobId: string): BackgroundJob | undefined;
    cancelReindexJob(jobId: string): void;
    private runReindexJob;
    reindexDocuments(ids: readonly string[]): Promise<{
        reindexed: number;
        skipped: number;
    }>;
    deleteDocuments(ids: readonly string[]): Promise<{
        deleted: number;
    }>;
    /**
     * Resolve the request's metadata filter into a document-id allow-list, or
     * `undefined` when no filter is present (unrestricted search). A filter that
     * matches nothing yields an empty set, so the caller returns no hits.
     */
    private resolveSearchFilter;
    /**
     * Fold a set of selected document ids to its outermost roots (Cherry's
     * `getOutermostSelectedItemIds`): ids that are descendants of another
     * selected id are dropped, so a directory plus one of its children in the
     * same batch resolves to just the directory — the subtree is then handled
     * once by the recursive operations.
     */
    private outermostSelectedIds;
    listDocuments(baseId: string): DocumentSummary[];
    /** Pre-order DFS outline of one base's directory tree (kb_list outline mode). */
    listBaseOutline(baseId: string): {
        baseId: string;
        totalItems: number;
        nodes: Array<{
            depth: number;
            docId: string;
            title: string;
            type: DocumentSourceType;
            status: string;
        }>;
    };
    /** Live import/embedding progress for every document currently being indexed. */
    indexingStatus(): Array<{
        docId: string;
        baseId: string;
        title: string;
        phase: 'parsing' | 'embedding';
        progress: number;
    }>;
    /** Current download/load state of an in-process embedding model. */
    getLocalModelStatus(modelId?: string): Promise<LocalModelStatus>;
    /**
     * Embed one probe text through the given (or current) embedding config and
     * return the vector width — Cherry's `useEmbeddingDimensions` probe, run
     * before a config save so a wrong-dimension model is caught up front.
     * Local models answer from the catalog without loading the ~600MB pipeline.
     */
    probeEmbeddingDimensions(options?: {
        provider?: EmbeddingProvider;
        baseUrl?: string;
        model?: string;
        apiKey?: string;
    }): Promise<number>;
    listLocalModels(): Promise<LocalModelSummary[]>;
    downloadLocalModel(id: string): Promise<LocalModelSummary>;
    cancelLocalModel(id: string): Promise<LocalModelSummary>;
    deleteLocalModel(id: string): Promise<LocalModelSummary>;
    getOcrStatus(): OcrModelStatus;
    downloadOcr(): Promise<OcrModelStatus>;
    deleteOcr(): Promise<{
        deleted: true;
    }>;
    listOllamaModels(baseUrl: string): Promise<Array<{
        name: string;
        size?: number;
    }>>;
    deleteOllamaModel(model: string, baseUrl: string): Promise<void>;
    pullOllamaModel(model: string, baseUrl: string): Promise<void>;
    cancelOllamaPull(model: string): void;
    getOllamaPullStatus(model: string): OllamaPullStatus;
    /** In-flight pulls (the panel restores its progress cards from this on open). */
    activeOllamaPulls(): Array<{
        model: string;
        status: OllamaPullStatus['status'];
        progress: number;
        message: string;
    }>;
    /**
     * Migrate downloaded local models (and OCR files) from the current cache
     * directory to `to`, then point the config there. Loaded models are
     * released first so file locks (Windows) cannot block the move; moves fall
     * back to copy+delete across drives. The directory may be empty — the
     * config still switches, so future downloads land in the new location.
     */
    migrateLocalModels(to: string): Promise<{
        moved: number;
        from: string;
        to: string;
    }>;
    listChunks(documentId: string, limit?: number, offset?: number): KnowledgeChunk[];
    getDocument(id: string, opts?: {
        includeChunks?: boolean;
        rawTextLimit?: number;
    }): DocumentDetail;
    /** Original source bytes of a file document (for the download route). */
    getRawFile(id: string): Promise<{
        bytes: Uint8Array;
        fileName: string;
        mimeType?: string;
    } | undefined>;
    /** Read one document's source text as a `[charStart, charEnd)` slice (kb_read read mode). */
    readDocumentText(id: string, charStart?: number, charEnd?: number): {
        id: string;
        baseId: string;
        title: string;
        sourceType: DocumentSourceType;
        totalChars: number;
        charStart: number;
        charEnd: number;
        content: string;
        truncated: boolean;
    };
    /** Grep one document's source text for a regular expression (kb_read grep mode). */
    grepDocument(id: string, pattern: string, maxMatches?: number, ignoreCase?: boolean): {
        id: string;
        baseId: string;
        title: string;
        totalMatches: number;
        matches: Array<{
            line: number;
            charStart: number;
            charEnd: number;
            snippet: string;
        }>;
    };
    stats(baseId?: string): BaseStats;
    search(request: SearchRequest): Promise<SearchResult>;
    /** Shared tail: rerank (optional), threshold + top-K cut, and hit mapping. */
    private finishSearch;
    /**
     * How many parse+ingest tasks may run concurrently per base (Cherry Studio:
     * 5, on a per-base queue). Local-model inference no longer constrains this:
     * it runs in a dedicated worker thread (see embed.ts), exactly like Cherry's
     * own-worker embedding service.
     */
    private static readonly INGEST_CONCURRENCY;
    private ingestConcurrency;
    /** Queue one parse+ingest task behind a per-base worker pool (Cherry's job queue). */
    private enqueueIngest;
    private pumpIngestQueue;
    /** Serialize a read-then-write section per base (dedup check + first persist). */
    private withBaseWriteLock;
    /**
     * Resolve once every queued/active ingest task has settled (all bases).
     * Pipeline/test helper — the HTTP surface never needs it because the client
     * polls /indexing-status. Throws when the tasks do not drain in time.
     * The initial 25ms tick lets a fire-and-forget task (e.g. the in-place
     * backfill after a model change) reach its first indexing entry before the
     * first busy() probe, avoiding a false "idle".
     */
    waitForIdle(timeoutMs?: number): Promise<void>;
    private ingestDocument;
    private buildChunks;
    /** Embed one batch through the configured provider (empty input → empty output). */
    private embedTextsOnce;
    /**
     * Embed with Cherry's job retry policy: 3 attempts, exponential backoff
     * (1s → 30s), so a transient provider/network failure self-heals instead of
     * degrading a whole import to lexical-only. An external abort (delete)
     * interrupts the request chain immediately.
     */
    private embedWithRetry;
    /** Bump the base's updatedAt so the data view's "更新于" stays meaningful. */
    private touchBase;
    private requireStore;
}
export default KnowledgeService;
//# sourceMappingURL=index.d.ts.map