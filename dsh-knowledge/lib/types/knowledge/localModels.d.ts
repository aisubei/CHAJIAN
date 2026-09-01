/**
 * Local (in-process) model registry — the download/remove manager backing the
 * settings "本地模型" section, mirroring Cherry Studio's Local Models cards.
 * @module dsh-knowledge/knowledge/localModels
 */
export interface LocalModelDescriptor {
    readonly id: string;
    readonly name: string;
    readonly kind: 'embedding' | 'reranking';
    readonly subtitle: string;
    /** Embedding width the model produces (embedding models only). */
    readonly dimensions?: number;
    /** Practical max input length in tokens (model context window). */
    readonly maxTokens?: number;
}
export interface LocalModelSummary extends LocalModelDescriptor {
    readonly status: 'ready' | 'not_downloaded' | 'downloading' | 'error';
    readonly progress: number;
    readonly message: string;
}
/**
 * The shipped in-process models (transformers.js ONNX). All are real,
 * downloadable ONNX repos; a model's pooling strategy lives in embed.ts
 * (`poolingFor`), keyed by the same ids.
 */
export declare const LOCAL_MODELS: readonly LocalModelDescriptor[];
export declare function listLocalModels(): Promise<LocalModelSummary[]>;
export declare function downloadLocalModel(id: string): Promise<LocalModelSummary>;
export declare function cancelLocalModelDownload(id: string): Promise<LocalModelSummary>;
export declare function deleteLocalModel(id: string): Promise<LocalModelSummary>;
//# sourceMappingURL=localModels.d.ts.map