/**
 * The single durable domain for the knowledge store: `bases`, `documents`,
 * and `chunks` tables plus a global slot holding runtime config overrides.
 * Record schemas are zod (validated at the durable boundary by
 * `@deepseek-ai/dsh-storage-domain`); plugin Config stays schemastery.
 * @module dsh-knowledge/knowledge/domain
 */
import { z } from 'zod';
import type { KnowledgeBase, KnowledgeConfig, KnowledgeDocument } from './types.js';
/** Per-base config overrides, validated at the durable boundary. */
export declare const baseConfigSchema: z.ZodObject<{
    embeddingProvider: z.ZodOptional<z.ZodEnum<{
        openai: "openai";
        ollama: "ollama";
        local: "local";
        none: "none";
    }>>;
    embeddingBaseUrl: z.ZodOptional<z.ZodString>;
    embeddingModel: z.ZodOptional<z.ZodString>;
    embeddingApiKey: z.ZodOptional<z.ZodString>;
    rerankModel: z.ZodOptional<z.ZodString>;
    rerankBaseUrl: z.ZodOptional<z.ZodString>;
    rerankApiKey: z.ZodOptional<z.ZodString>;
    smartChunk: z.ZodOptional<z.ZodBoolean>;
    chunkSeparator: z.ZodOptional<z.ZodString>;
    chunkSize: z.ZodOptional<z.ZodNumber>;
    chunkOverlap: z.ZodOptional<z.ZodNumber>;
    topK: z.ZodOptional<z.ZodNumber>;
    searchMode: z.ZodOptional<z.ZodEnum<{
        auto: "auto";
        hybrid: "hybrid";
        vector: "vector";
        lexical: "lexical";
    }>>;
    similarityThreshold: z.ZodOptional<z.ZodNumber>;
    mmrDiversity: z.ZodOptional<z.ZodNumber>;
    rrfVectorWeight: z.ZodOptional<z.ZodNumber>;
    embeddingBatchSize: z.ZodOptional<z.ZodNumber>;
    siblingChunks: z.ZodOptional<z.ZodNumber>;
    documentProcessorProvider: z.ZodOptional<z.ZodEnum<{
        builtin: "builtin";
        mineru: "mineru";
    }>>;
    mineruApiKey: z.ZodOptional<z.ZodString>;
    mineruApiHost: z.ZodOptional<z.ZodString>;
    semanticChunk: z.ZodOptional<z.ZodBoolean>;
    semanticChunkThreshold: z.ZodOptional<z.ZodNumber>;
    chunkTokenLimit: z.ZodOptional<z.ZodNumber>;
    conflictStrategy: z.ZodOptional<z.ZodEnum<{
        keep: "keep";
        replace: "replace";
        rename: "rename";
    }>>;
    urlRefreshHours: z.ZodOptional<z.ZodNumber>;
    imageCaptionProvider: z.ZodOptional<z.ZodEnum<{
        openai: "openai";
        ollama: "ollama";
        off: "off";
    }>>;
    imageCaptionModel: z.ZodOptional<z.ZodString>;
    imageCaptionBaseUrl: z.ZodOptional<z.ZodString>;
    imageCaptionApiKey: z.ZodOptional<z.ZodString>;
    resumeInterruptedOnStartup: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
/** Runtime overrides merged over the plugin Config defaults (user-editable). */
export declare const configOverridesSchema: z.ZodObject<{
    embeddingProvider: z.ZodOptional<z.ZodEnum<{
        openai: "openai";
        ollama: "ollama";
        local: "local";
        none: "none";
    }>>;
    embeddingBaseUrl: z.ZodOptional<z.ZodString>;
    embeddingModel: z.ZodOptional<z.ZodString>;
    embeddingApiKey: z.ZodOptional<z.ZodString>;
    rerankModel: z.ZodOptional<z.ZodString>;
    rerankBaseUrl: z.ZodOptional<z.ZodString>;
    rerankApiKey: z.ZodOptional<z.ZodString>;
    smartChunk: z.ZodOptional<z.ZodBoolean>;
    chunkSeparator: z.ZodOptional<z.ZodString>;
    chunkSize: z.ZodOptional<z.ZodNumber>;
    chunkOverlap: z.ZodOptional<z.ZodNumber>;
    topK: z.ZodOptional<z.ZodNumber>;
    searchMode: z.ZodOptional<z.ZodEnum<{
        auto: "auto";
        hybrid: "hybrid";
        vector: "vector";
        lexical: "lexical";
    }>>;
    similarityThreshold: z.ZodOptional<z.ZodNumber>;
    mmrDiversity: z.ZodOptional<z.ZodNumber>;
    rrfVectorWeight: z.ZodOptional<z.ZodNumber>;
    embeddingBatchSize: z.ZodOptional<z.ZodNumber>;
    siblingChunks: z.ZodOptional<z.ZodNumber>;
    hfEndpoint: z.ZodOptional<z.ZodString>;
    documentProcessorProvider: z.ZodOptional<z.ZodEnum<{
        builtin: "builtin";
        mineru: "mineru";
    }>>;
    mineruApiKey: z.ZodOptional<z.ZodString>;
    mineruApiHost: z.ZodOptional<z.ZodString>;
    semanticChunk: z.ZodOptional<z.ZodBoolean>;
    semanticChunkThreshold: z.ZodOptional<z.ZodNumber>;
    chunkTokenLimit: z.ZodOptional<z.ZodNumber>;
    conflictStrategy: z.ZodOptional<z.ZodEnum<{
        keep: "keep";
        replace: "replace";
        rename: "rename";
    }>>;
    urlRefreshHours: z.ZodOptional<z.ZodNumber>;
    imageCaptionProvider: z.ZodOptional<z.ZodEnum<{
        openai: "openai";
        ollama: "ollama";
        off: "off";
    }>>;
    imageCaptionModel: z.ZodOptional<z.ZodString>;
    imageCaptionBaseUrl: z.ZodOptional<z.ZodString>;
    imageCaptionApiKey: z.ZodOptional<z.ZodString>;
    localModelCacheDir: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
/** Partial runtime config stored in the domain global slot. */
export interface ConfigOverrides {
    embeddingProvider?: KnowledgeConfig['embeddingProvider'];
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
    searchMode?: KnowledgeConfig['searchMode'];
    similarityThreshold?: number;
    mmrDiversity?: number;
    rrfVectorWeight?: number;
    embeddingBatchSize?: number;
    siblingChunks?: number;
    hfEndpoint?: string;
    documentProcessorProvider?: KnowledgeConfig['documentProcessorProvider'];
    mineruApiKey?: string;
    mineruApiHost?: string;
    semanticChunk?: boolean;
    semanticChunkThreshold?: number;
    chunkTokenLimit?: number;
    conflictStrategy?: 'keep' | 'replace' | 'rename';
    urlRefreshHours?: number;
    imageCaptionProvider?: 'off' | 'openai' | 'ollama';
    imageCaptionModel?: string;
    imageCaptionBaseUrl?: string;
    imageCaptionApiKey?: string;
    resumeInterruptedOnStartup?: boolean;
    localModelCacheDir?: string;
}
export declare const knowledgeDomainSpec: {
    name: string;
    version: number;
    global: {
        schema: z.ZodObject<{
            overrides: z.ZodObject<{
                embeddingProvider: z.ZodOptional<z.ZodEnum<{
                    openai: "openai";
                    ollama: "ollama";
                    local: "local";
                    none: "none";
                }>>;
                embeddingBaseUrl: z.ZodOptional<z.ZodString>;
                embeddingModel: z.ZodOptional<z.ZodString>;
                embeddingApiKey: z.ZodOptional<z.ZodString>;
                rerankModel: z.ZodOptional<z.ZodString>;
                rerankBaseUrl: z.ZodOptional<z.ZodString>;
                rerankApiKey: z.ZodOptional<z.ZodString>;
                smartChunk: z.ZodOptional<z.ZodBoolean>;
                chunkSeparator: z.ZodOptional<z.ZodString>;
                chunkSize: z.ZodOptional<z.ZodNumber>;
                chunkOverlap: z.ZodOptional<z.ZodNumber>;
                topK: z.ZodOptional<z.ZodNumber>;
                searchMode: z.ZodOptional<z.ZodEnum<{
                    auto: "auto";
                    hybrid: "hybrid";
                    vector: "vector";
                    lexical: "lexical";
                }>>;
                similarityThreshold: z.ZodOptional<z.ZodNumber>;
                mmrDiversity: z.ZodOptional<z.ZodNumber>;
                rrfVectorWeight: z.ZodOptional<z.ZodNumber>;
                embeddingBatchSize: z.ZodOptional<z.ZodNumber>;
                siblingChunks: z.ZodOptional<z.ZodNumber>;
                hfEndpoint: z.ZodOptional<z.ZodString>;
                documentProcessorProvider: z.ZodOptional<z.ZodEnum<{
                    builtin: "builtin";
                    mineru: "mineru";
                }>>;
                mineruApiKey: z.ZodOptional<z.ZodString>;
                mineruApiHost: z.ZodOptional<z.ZodString>;
                semanticChunk: z.ZodOptional<z.ZodBoolean>;
                semanticChunkThreshold: z.ZodOptional<z.ZodNumber>;
                chunkTokenLimit: z.ZodOptional<z.ZodNumber>;
                conflictStrategy: z.ZodOptional<z.ZodEnum<{
                    keep: "keep";
                    replace: "replace";
                    rename: "rename";
                }>>;
                urlRefreshHours: z.ZodOptional<z.ZodNumber>;
                imageCaptionProvider: z.ZodOptional<z.ZodEnum<{
                    openai: "openai";
                    ollama: "ollama";
                    off: "off";
                }>>;
                imageCaptionModel: z.ZodOptional<z.ZodString>;
                imageCaptionBaseUrl: z.ZodOptional<z.ZodString>;
                imageCaptionApiKey: z.ZodOptional<z.ZodString>;
                localModelCacheDir: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
            groups: z.ZodOptional<z.ZodArray<z.ZodString>>;
            enabled: z.ZodOptional<z.ZodBoolean>;
            enabledBaseIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
        }, z.core.$strip>;
        initial: {
            overrides: ConfigOverrides;
            enabled: boolean;
            enabledBaseIds: string[];
        };
    };
    tables: {
        bases: import("@deepseek-ai/dsh-storage-domain").DomainTableSpec<string, KnowledgeBase>;
        documents: import("@deepseek-ai/dsh-storage-domain").DomainTableSpec<string, KnowledgeDocument>;
    };
};
/** Table names, for the store layer. */
export declare const TABLES: {
    readonly bases: "bases";
    readonly documents: "documents";
    readonly chunks: "chunks";
};
//# sourceMappingURL=domain.d.ts.map