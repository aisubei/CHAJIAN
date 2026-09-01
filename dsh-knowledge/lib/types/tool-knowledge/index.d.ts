/**
 * Model-facing knowledge tools. The tools consume the host `knowledge`
 * service and publish nothing themselves, so this row sits as an ordinary
 * tool plugin beside the service it reaches (the same split the goal and
 * interconnect tools use against their host services).
 * @module dsh-knowledge/tool-knowledge
 */
import { Context } from '@deepseek-ai/cordis';
/** Services required before the tools can register. */
export declare const inject: string[];
/** Register the knowledge tool surface. */
export declare function apply(ctx: Context): void;
//# sourceMappingURL=index.d.ts.map