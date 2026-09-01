/**
 * Store abstraction over the knowledge data. The service reads and writes
 * plain data through one interface; implementations back it:
 * - a durable `DomainStore` — business state (bases, documents, runtime
 *   config) over `ctx.storageDomain`, chunks in a dedicated SQLite file
 *   (`ChunkDatabase`) so writes stay O(1) no matter how much data grows;
 * - an in-memory `MemoryStore` used when the storage backend is unavailable
 *   (e.g. a headless profile without a configured storage route, or tests).
 * @module dsh-knowledge/knowledge/store
 */
import type { Domain, DomainSpec } from '@deepseek-ai/dsh-storage-domain';
import type { ConfigOverrides } from './domain.js';
import type { RetrievalLane } from './chunkdb.js';
import type { KnowledgeBase, KnowledgeChunk, KnowledgeDocument } from './types.js';
export interface ChunkStats {
    count: number;
    embedded: boolean;
    dimensions?: number;
    /** Distinct embedding-model tags on embedded chunks (count per base+model). */
    embeddingModelCounts: Array<{
        baseId: string;
        model: string;
        count: number;
    }>;
}
/**
 * Original source bytes of uploaded documents (Cherry's `raw/` material store):
 * "import means copy" — the base keeps its own stable copy, and reindex can
 * re-read + re-parse the source instead of only reusing the persisted text.
 * Stored under `<chunkStorePath dir>/knowledge-raw/<baseId>/<docId><ext>`.
 */
export interface RawFileStore {
    /** Persist one document's source bytes; returns the base-relative path. */
    write(baseId: string, docId: string, ext: string, bytes: Uint8Array): Promise<string>;
    /**
     * Persist bytes at a caller-chosen base-relative path (e.g. a directory
     * import's `sub/name.pdf`), preserving the on-disk tree. Returns the
     * base-relative path.
     */
    writeRel(baseId: string, relativePath: string, bytes: Uint8Array): Promise<string>;
    /** Read a document's source bytes back (null when absent). */
    read(relativePath: string): Promise<Uint8Array | null>;
    /** Remove one document's source file by its stored relative path (missing = no-op). */
    delete(relativePath: string): Promise<void>;
    /** Remove every source file of a base. */
    deleteBase(baseId: string): Promise<void>;
}
/** Filesystem-backed {@link RawFileStore}. */
export declare class RawFileStorage implements RawFileStore {
    private readonly root;
    constructor(root: string);
    private pathOf;
    write(baseId: string, docId: string, ext: string, bytes: Uint8Array): Promise<string>;
    writeRel(baseId: string, relativePath: string, bytes: Uint8Array): Promise<string>;
    read(relativePath: string): Promise<Uint8Array | null>;
    delete(relativePath: string): Promise<void>;
    deleteBase(baseId: string): Promise<void>;
}
export interface Store {
    listBases(): KnowledgeBase[];
    getBase(id: string): KnowledgeBase | undefined;
    putBase(base: KnowledgeBase): Promise<void>;
    deleteBase(id: string): Promise<void>;
    listDocuments(baseId: string): KnowledgeDocument[];
    getDocument(id: string): KnowledgeDocument | undefined;
    putDocument(doc: KnowledgeDocument): Promise<void>;
    deleteDocument(id: string): Promise<void>;
    listChunks(baseId: string): KnowledgeChunk[];
    listChunksByDoc(docId: string, limit?: number, offset?: number): KnowledgeChunk[];
    /** Chunks of one document whose index falls in `[fromIdx, toIdx]` (sibling context around a search hit). */
    listChunksByIndexRange(docId: string, fromIdx: number, toIdx: number): KnowledgeChunk[];
    putChunks(chunks: KnowledgeChunk[]): Promise<void>;
    /**
     * Incrementally persist a batch of chunks WITHOUT clearing the document's
     * other rows (the crash-recovery write path — each embedded batch lands
     * here, so a mid-embedding crash keeps every completed batch).
     */
    putChunkBatch(chunks: KnowledgeChunk[]): Promise<void>;
    /** Delete a document's chunks; pass `baseId` to scope the delete to one base. */
    deleteChunks(docId: string, baseId?: string): Promise<void>;
    /** Drop every chunk of a base in one operation (used by deleteBase). */
    deleteChunksByBase(baseId: string): Promise<void>;
    /**
     * Library-wide vector reuse: stored vectors for the given embedding-text
     * hashes under one embedding model (Cherry's `listExistingEmbeddingHashes` /
     * decision A4). The caller embeds only the hashes missing from the result,
     * so re-embedding unchanged chunk text reuses the stored vector.
     */
    listEmbeddingVectorsByHashes(hashes: readonly string[], embeddingModel: string): Map<string, number[]>;
    /** Actual chunk count per document, for reconciling stale document metadata. */
    chunkCountsByDoc(baseIds: readonly string[]): Map<string, number>;
    /** Per-doc chunk presence + embedding coverage in one pass (document lists). */
    docChunkStatus(baseId: string): {
        withChunks: Set<string>;
        missingEmbedding: Set<string>;
    };
    /**
     * Startup self-healing, returning:
     * - `removed`: documents a crashed import left behind with nothing to
     *   recover — non-directory items with no chunks, no rawText AND no raw
     *   source file whose last update predates this process's start.
     * - `resume`: documents that hold recoverable material — rawText (crash
     *   mid-embedding, chunks partial) or a persisted raw source file (crash
     *   before/during parse) — re-indexed by the service after startup.
     */
    recoverInterruptedImports(startedAt: number): Promise<{
        removed: number;
        resume: string[];
    }>;
    /** Aggregate chunk stats without loading chunk rows. */
    chunkStats(baseIds: readonly string[]): ChunkStats;
    /** SQL-backed retrieval lanes (FTS5 + vector scan); absent on in-memory stores. */
    readonly retrievalLane?: RetrievalLane;
    /** Original source bytes of uploaded documents (absent on in-memory stores). */
    readonly raw?: RawFileStore;
    /**
     * Return space a large delete freed back to the OS (Cherry's
     * `reclaimSpace`): WAL checkpoint, threshold-gated VACUUM + FTS optimize.
     * Absent on in-memory stores.
     */
    readonly reclaimSpace?: () => {
        vacuumed: boolean;
        reclaimedBytes: number;
    };
    getConfigOverrides(): ConfigOverrides;
    setConfigOverrides(overrides: ConfigOverrides): Promise<void>;
    getGroups(): string[];
    setGroups(groups: string[]): Promise<void>;
    getEnabled(): boolean;
    setEnabled(enabled: boolean): Promise<void>;
    getEnabledBaseIds(): string[];
    setEnabledBaseIds(ids: string[]): Promise<void>;
    close(): Promise<void>;
}
/** Facility surface the store needs — typed locally because the class type is package-private. */
export interface StorageDomainFacility {
    open<S extends DomainSpec>(spec: S): Promise<Domain<S>>;
}
export interface OpenStoreOptions {
    /** Chunk SQLite file; default `<DSH_HOME>/storages/knowledge-chunks.sqlite`. */
    chunkStorePath?: string;
    /** Legacy JSON unit file to migrate chunks from; default `<DSH_HOME>/storages/knowledge.json`. */
    legacyJsonPath?: string;
}
/**
 * Open a durable store. Business state comes from the domain facility; chunks
 * live in a plugin-owned SQLite file (`chunkStorePath`, defaulted under
 * `<DSH_HOME>/storages`). A one-time migration moves any chunks still stored
 * in the legacy JSON unit file into the SQLite store. Falls back to memory
 * when the facility is absent or fails.
 */
export declare function openStore(facility: StorageDomainFacility | undefined, options?: OpenStoreOptions): Promise<Store>;
//# sourceMappingURL=store.d.ts.map