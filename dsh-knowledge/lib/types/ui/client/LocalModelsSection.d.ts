/**
 * Cherry Studio-style Local Models settings section: model cards with
 * download / retry / remove actions and a live progress bar, mirroring
 * `LocalModelsSection` + `ModelCard`. The settings shell supplies only the
 * `close` owner prop; data and actions arrive through the inject face.
 * @module dsh-knowledge/client/LocalModelsSection
 */
import { KnowledgeApi } from './api.js';
import type { Translate } from './locales.js';
export interface LocalModelsSectionProps {
    close: () => void;
    api: KnowledgeApi;
    t: Translate;
    /** DSH's native directory picker + path opener (optional; absent in tests). */
    workspaces?: {
        pickDirectory(): Promise<string | null>;
        openPath(path: string): Promise<void>;
    };
}
export declare function LocalModelsSection(props: LocalModelsSectionProps): JSX.Element;
//# sourceMappingURL=LocalModelsSection.d.ts.map