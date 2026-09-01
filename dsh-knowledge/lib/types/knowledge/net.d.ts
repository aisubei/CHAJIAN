/**
 * Shared HTTP helpers. Node's built-in fetch (undici) ignores HTTP_PROXY /
 * HTTPS_PROXY / NO_PROXY — the reason a browser can reach a site while a
 * plugin request dies with a bare "fetch failed". `applyGlobalProxy` routes
 * EVERY global fetch in the process (including transformers.js model
 * downloads, which call the bare global fetch) through undici's
 * EnvHttpProxyAgent when a proxy is configured, and `httpFetch` adds a
 * timeout, one retry, and the real error cause chain.
 * @module dsh-knowledge/knowledge/net
 */
/**
 * Make every `fetch()` in the process honor HTTP_PROXY / HTTPS_PROXY /
 * NO_PROXY. Safe when no proxy is configured (direct connections, unchanged
 * behavior); idempotent. Must be called before any download starts.
 */
export declare function applyGlobalProxy(): void;
export interface HttpFetchOptions {
    method?: string;
    headers?: Record<string, string>;
    body?: string | Uint8Array;
    /** Per-attempt timeout in milliseconds. */
    timeoutMs?: number;
    /** Extra retries after the first failed attempt (default 1). */
    retries?: number;
    /** Redirect policy (default: follow, like fetch). SSRF guards pass 'manual'. */
    redirect?: 'follow' | 'manual';
    /** External abort (e.g. a delete cancelling an in-flight paid request). */
    signal?: AbortSignal;
}
/** fetch through the global (proxy-aware) dispatcher with timeout + one retry. */
export declare function httpFetch(url: string, options?: HttpFetchOptions): Promise<Response>;
/** A human-readable cause chain for a fetch/undici error. */
export declare function describeNetworkError(error: unknown): string;
/** Guidance appended to network failures surfaced in the panel. */
export declare const NETWORK_HINT = "\u82E5\u65E0\u6CD5\u8BBF\u95EE huggingface.co\uFF1A\u5728\u300C\u672C\u5730\u6A21\u578B\u300D\u9875\u9762\u8BBE\u7F6E\u955C\u50CF\u7AD9\uFF08\u5982 https://hf-mirror.com\uFF09\uFF0C\u6216\u914D\u7F6E HTTP(S)_PROXY \u4EE3\u7406\u540E\u91CD\u542F\u670D\u52A1\u3002";
//# sourceMappingURL=net.d.ts.map