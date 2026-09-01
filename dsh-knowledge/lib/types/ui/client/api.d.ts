/**
 * Browser fetch client for the knowledge host service. Same-origin JSON calls
 * against `/knowledge/*`, with local types mirroring the host vocabulary (the
 * client bundle never imports host modules).
 * @module dsh-knowledge/client/api
 */
export type EmbeddingProvider = 'openai' | 'ollama' | 'local' | 'none';
export type SearchMode = 'auto' | 'hybrid' | 'vector' | 'lexical';
export interface BaseConfig {
    embeddingProvider?: EmbeddingProvider;
    embeddingBaseUrl?: string;
    embeddingModel?: string;
    embeddingApiKey?: string;
    rerankModel?: string;
    rerankBaseUrl?: string;
    rerankApiKey?: string;
    smartChunk?: boolean;
    chunkSeparator?: string;
    chunkSize?: number;
    chunkOverlap?: number;
    topK?: number;
    searchMode?: SearchMode;
    similarityThreshold?: number;
    mmrDiversity?: number;
    rrfVectorWeight?: number;
    embeddingBatchSize?: number;
    siblingChunks?: number;
    semanticChunk?: boolean;
    semanticChunkThreshold?: number;
    chunkTokenLimit?: number;
    conflictStrategy?: 'keep' | 'replace' | 'rename';
    urlRefreshHours?: number;
    imageCaptionProvider?: 'off' | 'openai' | 'ollama';
    imageCaptionModel?: string;
    imageCaptionBaseUrl?: string;
    imageCaptionApiKey?: string;
}
export interface BaseSummary {
    id: string;
    name: string;
    description: string;
    group?: string;
    documentCount: number;
    chunkCount: number;
    charCount: number;
    tokenCount: number;
    config?: BaseConfig;
    createdAt: number;
    updatedAt: number;
}
export interface DocumentSummary {
    id: string;
    baseId: string;
    title: string;
    sourceType: 'text' | 'file' | 'url' | 'directory';
    fileName?: string;
    url?: string;
    parentDirectoryId?: string;
    charCount: number;
    tokenCount?: number;
    chunkCount: number;
    childCount?: number;
    embedded: boolean;
    embeddingError?: string;
    errorCode?: 'interrupted' | 'dimension_mismatch' | 'parse_failed' | 'embedding_provider';
    status?: 'pending' | 'processing' | 'completed' | 'failed';
    indexingProgress?: number;
    indexingPhase?: 'parsing' | 'embedding';
    createdAt: number;
    updatedAt?: number;
}
export interface LocalModelStatus {
    model: string;
    status: 'idle' | 'downloading' | 'ready' | 'error';
    progress: number;
    message: string;
}
export interface ModelSuggestions {
    embedding: string[];
    local: string[];
    rerank: string[];
    /** Ollama registry embedding recommendations (for provider `ollama`). */
    ollamaEmbedding: string[];
    /** Ollama registry vision-model recommendations (for image captioning). */
    ollamaVision: string[];
}
export interface LocalModelSummary {
    id: string;
    name: string;
    kind: 'embedding';
    subtitle: string;
    status: 'ready' | 'not_downloaded' | 'downloading' | 'error';
    progress: number;
    message: string;
}
export interface ChunkView {
    id: string;
    docId: string;
    baseId: string;
    index: number;
    text: string;
    heading?: string;
    context?: string;
}
export interface KnowledgeConfig {
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
    rrfVectorWeight: number;
    embeddingBatchSize: number;
    semanticChunk: boolean;
    semanticChunkThreshold: number;
    chunkTokenLimit: number;
    conflictStrategy: 'keep' | 'replace' | 'rename';
    urlRefreshHours: number;
    imageCaptionProvider: 'off' | 'openai' | 'ollama';
    imageCaptionModel: string;
    imageCaptionBaseUrl: string;
    imageCaptionApiKey: string;
    localModelCacheDir: string;
    siblingChunks: number;
    hfEndpoint: string;
    documentProcessorProvider: 'builtin' | 'mineru';
    mineruApiKey: string;
    mineruApiHost: string;
    resumeInterruptedOnStartup: boolean;
}
export interface SearchHit {
    chunkId: string;
    docId: string;
    baseId: string;
    documentTitle: string;
    heading?: string;
    index: number;
    text: string;
    siblingContext?: string;
    score: number;
    vectorScore?: number;
    lexicalScore?: number;
}
export interface SearchResult {
    query: string;
    mode: SearchMode;
    total: number;
    reranked: boolean;
    elapsedMs: number;
    hits: SearchHit[];
}
export interface BaseStats {
    baseId?: string;
    documentCount: number;
    chunkCount: number;
    charCount: number;
    tokenCount: number;
    embedded: boolean;
    embeddingDimensions?: number;
    staleEmbeddings?: boolean;
    staleChunkCount?: number;
}
export interface DocumentDetail {
    id: string;
    baseId: string;
    title: string;
    sourceType: 'text' | 'file' | 'url' | 'directory';
    fileName?: string;
    url?: string;
    rawText?: string;
    rawTextTruncated?: boolean;
    charCount: number;
    tokenCount?: number;
    chunkCount: number;
    createdAt: number;
    chunks?: ChunkView[];
}
export interface DirectoryImportStatus {
    baseId: string;
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
export declare class KnowledgeApi {
    private call;
    getConfig(): Promise<KnowledgeConfig>;
    getLocalModelStatus(model?: string): Promise<LocalModelStatus>;
    getModelSuggestions(): Promise<ModelSuggestions>;
    listLocalModels(): Promise<LocalModelSummary[]>;
    downloadLocalModel(id: string): Promise<LocalModelSummary>;
    cancelLocalModel(id: string): Promise<LocalModelSummary>;
    removeLocalModel(id: string): Promise<LocalModelSummary>;
    getOcrStatus(): Promise<{
        status: string;
        progress: number;
        message: string;
    }>;
    downloadOcr(): Promise<{
        status: string;
        progress: number;
        message: string;
    }>;
    removeOcr(): Promise<{
        deleted: boolean;
    }>;
    migrateLocalModels(to: string): Promise<{
        moved: number;
        from: string;
        to: string;
    }>;
    listOllamaModels(baseUrl: string): Promise<{
        models: Array<{
            name: string;
            size?: number;
        }>;
    }>;
    pullOllamaModel(model: string, baseUrl: string): Promise<{
        started: boolean;
    }>;
    cancelOllamaPull(model: string): Promise<{
        cancelled: boolean;
    }>;
    deleteOllamaModel(model: string, baseUrl: string): Promise<{
        deleted: boolean;
    }>;
    getOllamaPullStatus(model: string): Promise<{
        status: string;
        progress: number;
        message: string;
    }>;
    /** In-flight pulls, so the settings panel restores its cards after close/reopen. */
    listActiveOllamaPulls(): Promise<{
        pulls: Array<{
            model: string;
            status: string;
            progress: number;
            message: string;
        }>;
    }>;
    setConfig(overrides: Partial<KnowledgeConfig>): Promise<KnowledgeConfig>;
    /**
     * Embed one probe text through the given (or current) embedding config and
     * return the vector width (Cherry's dimension probe, run before a save).
     */
    probeEmbeddingDimensions(options?: {
        provider?: EmbeddingProvider;
        baseUrl?: string;
        model?: string;
        apiKey?: string;
    }): Promise<number>;
    listBases(): Promise<BaseSummary[]>;
    createBase(name: string, description: string, group: string, config?: BaseConfig): Promise<{
        id: string;
        name: string;
    }>;
    updateBase(id: string, patch: {
        name?: string;
        description?: string;
        group?: string;
        config?: BaseConfig;
    }): Promise<{
        id: string;
        name: string;
    }>;
    /**
     * Batch file add with server-authoritative conflict detection: 'detect'
     * returns {status:'conflicts'} listing every collision (or 'clean'), and
     * 'rename'/'replace' add the whole batch under that strategy.
     */
    addFiles(baseId: string, files: Array<{
        fileName: string;
        mimeType?: string;
        contentBase64?: string;
    }>, conflict: 'detect' | 'rename' | 'replace', parentDirectoryId?: string): Promise<{
        status: 'conflicts';
        conflicts: string[];
    } | {
        status: 'clean';
    } | {
        status: 'added';
        accepted: Array<{
            id: string;
            title: string;
            fileName: string;
            skipped?: boolean;
        }>;
    }>;
    deleteBase(id: string): Promise<{
        deleted: boolean;
    }>;
    listGroups(): Promise<string[]>;
    createGroup(name: string): Promise<string[]>;
    renameGroup(from: string, to: string): Promise<string[]>;
    deleteGroup(name: string): Promise<{
        deleted: boolean;
    }>;
    getKnowledgeToggle(): Promise<{
        enabled: boolean;
        enabledBaseIds: string[];
    }>;
    setKnowledgeToggle(patch: {
        enabled?: boolean;
        enabledBaseIds?: string[];
    }): Promise<{
        enabled: boolean;
        enabledBaseIds: string[];
    }>;
    stats(baseId?: string): Promise<BaseStats>;
    startReindexBase(baseId: string): Promise<{
        jobId: string;
        total: number;
    }>;
    restoreBase(baseId: string, name: string, config?: BaseConfig): Promise<{
        id: string;
        name: string;
    }>;
    getReindexJob(jobId: string): Promise<DirectoryImportStatus>;
    cancelReindexJob(jobId: string): Promise<{
        cancelled: boolean;
    }>;
    listDocuments(baseId: string): Promise<DocumentSummary[]>;
    addTextDocument(baseId: string, title: string, content: string, parentDirectoryId?: string): Promise<{
        id: string;
        title: string;
        chunkCount: number;
    }>;
    addFileDocument(baseId: string, fileName: string, mimeType: string, contentBase64: string, conflict?: 'keep' | 'replace' | 'rename' | 'detect', parentDirectoryId?: string): Promise<{
        id: string;
        title: string;
        chunkCount: number;
        skipped?: boolean;
    }>;
    createDirectory(baseId: string, title: string, parentDirectoryId?: string): Promise<{
        id: string;
        title: string;
    }>;
    addUrlDocument(baseId: string, url: string, parentDirectoryId?: string): Promise<{
        id: string;
        title: string;
        chunkCount: number;
    }>;
    startDirectoryImport(baseId: string, path: string): Promise<{
        jobId: string;
        total: number;
    }>;
    importDirectoryTree(baseId: string, path: string): Promise<{
        imported: number;
        directories: number;
        errors: Array<{
            file: string;
            error: string;
        }>;
    }>;
    getDirectoryImport(jobId: string): Promise<DirectoryImportStatus>;
    cancelDirectoryImport(jobId: string): Promise<{
        cancelled: boolean;
    }>;
    getIndexingStatus(): Promise<Array<{
        docId: string;
        baseId: string;
        title: string;
        phase: 'parsing' | 'embedding';
        progress: number;
    }>>;
    getDocument(documentId: string, opts?: {
        rawTextLimit?: number;
    }): Promise<DocumentDetail>;
    renameDocument(documentId: string, title: string): Promise<{
        id: string;
        title: string;
    }>;
    reindexDocument(documentId: string): Promise<{
        id: string;
        chunkCount: number;
    }>;
    refreshUrlDocument(documentId: string): Promise<{
        changed: boolean;
        title: string;
        chunkCount: number;
    }>;
    reindexDocuments(ids: string[]): Promise<{
        reindexed: number;
        skipped: number;
    }>;
    deleteDocument(id: string): Promise<{
        deleted: boolean;
    }>;
    deleteDocuments(ids: string[]): Promise<{
        deleted: number;
    }>;
    listChunks(documentId: string, limit?: number): Promise<ChunkView[]>;
    search(request: {
        query: string;
        baseId?: string;
        topK?: number;
        mode?: SearchMode;
        threshold?: number;
        filter?: {
            docIds?: string[];
            titleIncludes?: string;
            sourceTypes?: string[];
            updatedAfter?: number;
            updatedBefore?: number;
        };
    }): Promise<SearchResult>;
}
//# sourceMappingURL=api.d.ts.map