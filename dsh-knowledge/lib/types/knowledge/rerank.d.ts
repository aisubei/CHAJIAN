/**
 * Rerank step (Cherry Studio's 重排模型): re-score the merged candidates
 * against the query through a Jina / SiliconFlow / Cohere-v2 style rerank
 * API (`POST {baseUrl}/rerank`), or through a local cross-encoder
 * (bge-reranker via transformers.js in the model worker) when the model id
 * carries the `local:` prefix. Disabled when no rerank model is set.
 * @module dsh-knowledge/knowledge/rerank
 */
export interface RerankCandidate {
    id: string;
    text: string;
}
/**
 * Rerank candidates, choosing the local worker when the model is `local:...`.
 * @param baseUrl - API root (ignored for local rerankers).
 * @param model - rerank model id (e.g. `jina-reranker-v2-base-multilingual`
 *   or `local:Xenova/bge-reranker-base`).
 * @param topN - how many candidates the reranker should keep (Cherry asks for
 *   the final result count); defaults to all candidates.
 * @returns id → relevance score clamped to [0, 1], containing only the kept
 *   (top-scoring) candidates — a caller that filters on this map implements
 *   Cherry's mergeRerankResults semantics (drop what the API did not return).
 */
export declare function rerankCandidates(baseUrl: string, model: string, apiKey: string, query: string, candidates: readonly RerankCandidate[], topN?: number): Promise<Map<string, number>>;
//# sourceMappingURL=rerank.d.ts.map