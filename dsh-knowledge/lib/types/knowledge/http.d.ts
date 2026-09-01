/**
 * JSON HTTP surface for the knowledge service, served on the same origin as
 * the browser panel at `/knowledge/*`. Responses use a uniform envelope:
 * `{ ok: true, value }` on success, `{ ok: false, error: { code, message } }`
 * on failure.
 * @module dsh-knowledge/knowledge/http
 */
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver';
import { type KnowledgeService } from './index.js';
export declare function knowledgeRoute(service: KnowledgeService): WebRoute;
//# sourceMappingURL=http.d.ts.map