/**
 * Shared theme tokens (DSH tokens with Cherry-Studio-like fallbacks) and the
 * panel's inline style vocabulary, used by the panel and every dialog.
 * @module dsh-knowledge/client/theme
 */
import type { CSSProperties } from 'react';
export declare const C: {
    readonly bg: "var(--dsw-alias-bg-base, #f6f7f9)";
    readonly surface: "var(--dsw-alias-bg-layer-1, #ffffff)";
    readonly surface2: "var(--dsw-alias-bg-layer-2, #f1f2f5)";
    readonly overlay: "var(--dsw-alias-bg-overlay, #ffffff)";
    readonly border: "var(--dsw-alias-border-l1, #e3e5e9)";
    readonly borderStrong: "var(--dsw-alias-border-l2, #c7ccd4)";
    readonly text: "var(--dsw-alias-label-primary, #1f2329)";
    readonly muted: "var(--dsw-alias-label-secondary, #8a919c)";
    readonly accent: "var(--dsw-alias-brand-primary, #3b6ef6)";
    readonly danger: "var(--dsw-alias-state-error-primary, #e5484d)";
    readonly success: "var(--dsw-alias-state-success-primary, #30a46c)";
    readonly warn: "var(--dsw-alias-state-warn-primary, #f5a623)";
};
export declare const accentSoft = "color-mix(in srgb, var(--dsw-alias-brand-primary, #3b6ef6) 10%, transparent)";
/** One-off hover/animation CSS injected once by the panel. */
export declare const PANEL_CSS = "\n@keyframes kb-spin { to { transform: rotate(360deg) } }\n@keyframes kb-fade-in { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: none } }\n.kb-spinner { animation: kb-spin 0.9s linear infinite }\n.kb-panel-in { animation: kb-fade-in 0.18s ease-out }\n.kb-row { transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease }\n.kb-row:hover { background: var(--dsw-alias-bg-layer-2, #f1f2f5) }\n.kb-card { transition: border-color 0.15s ease, background 0.15s ease }\n.kb-card:hover { border-color: var(--dsw-alias-border-l2, #c7ccd4) }\n.kb-iconbtn { transition: color 0.15s ease, background 0.15s ease }\n.kb-iconbtn:hover { color: var(--dsw-alias-brand-primary, #3b6ef6); background: color-mix(in srgb, var(--dsw-alias-brand-primary, #3b6ef6) 10%, transparent) }\n/* Buttons styled with style.button get a hover tint like the shell's own\n   buttons. The tint rides a CSS variable referenced from the inline\n   background, because inline styles outrank plain class rules: on hover the\n   variable flips and the inline background follows it. */\n.kb-btn { transition: background 0.15s ease, border-color 0.15s ease }\n.kb-btn:hover { --kb-btn-bg: var(--dsw-alias-interactive-bg-hover, #eceef1) }\n.kb-btn:disabled:hover { --kb-btn-bg: var(--dsw-alias-bg-layer-1, #ffffff) }\n/* Backgrounds live in classes (not inline) so :hover can override them, the\n   same way the shell's Settings trigger styles itself. */\n.kb-sidebar-action { background: transparent }\n.kb-sidebar-action:hover { background: var(--dsw-alias-interactive-bg-hover) }\n.kb-dangerbtn:hover { color: var(--dsw-alias-state-error-primary, #e5484d); background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #e5484d) 10%, transparent) }\n.kb-scroll::-webkit-scrollbar { width: 8px; height: 8px }\n.kb-scroll::-webkit-scrollbar-thumb { background: var(--dsw-alias-border-l2, #c7ccd4); border-radius: 999px }\n.kb-scroll::-webkit-scrollbar-track { background: transparent }\n";
export declare const style: {
    readonly panel: CSSProperties;
    readonly header: CSSProperties;
    readonly headerLeft: CSSProperties;
    readonly headerTitle: CSSProperties;
    readonly headerActions: CSSProperties;
    readonly iconButton: CSSProperties;
    readonly closeButton: CSSProperties;
    readonly body: CSSProperties;
    readonly sidebar: CSSProperties;
    readonly newBaseButton: CSSProperties;
    readonly baseCard: CSSProperties;
    readonly baseCardActive: CSSProperties;
    readonly baseAvatar: CSSProperties;
    readonly baseName: CSSProperties;
    readonly baseMeta: CSSProperties;
    readonly main: CSSProperties;
    readonly card: CSSProperties;
    readonly cardTitle: CSSProperties;
    readonly button: CSSProperties;
    readonly primary: CSSProperties;
    readonly primaryDanger: CSSProperties;
    readonly danger: CSSProperties;
    readonly input: CSSProperties;
    readonly textarea: CSSProperties;
    readonly dropzone: CSSProperties;
    readonly dropzoneActive: CSSProperties;
    readonly actionsRow: CSSProperties;
    readonly statsRow: CSSProperties;
    readonly statChip: CSSProperties;
    readonly statValue: CSSProperties;
    readonly statLabel: CSSProperties;
    readonly docRow: CSSProperties;
    readonly docIcon: CSSProperties;
    readonly docTitle: CSSProperties;
    readonly docMeta: CSSProperties;
    readonly docActions: CSSProperties;
    readonly chunk: CSSProperties;
    readonly hit: CSSProperties;
    readonly scorePill: CSSProperties;
    readonly mark: CSSProperties;
    readonly label: CSSProperties;
    readonly field: CSSProperties;
    readonly hint: CSSProperties;
    readonly empty: CSSProperties;
    readonly error: CSSProperties;
    readonly modalBackdrop: CSSProperties;
    readonly modal: CSSProperties;
    readonly modalHeader: CSSProperties;
    readonly sidebarAction: CSSProperties;
    readonly sidebarActionRail: CSSProperties;
    readonly sidebarActionActive: CSSProperties;
    readonly tabs: CSSProperties;
    readonly tab: CSSProperties;
    readonly tabActive: CSSProperties;
    readonly toastStack: CSSProperties;
    readonly toast: CSSProperties;
    readonly fileRow: CSSProperties;
    readonly spinner: CSSProperties;
    readonly menu: CSSProperties;
    readonly menuItem: CSSProperties;
    readonly menuItemDanger: CSSProperties;
    readonly menuSeparator: CSSProperties;
    readonly sectionTitle: CSSProperties;
    readonly sectionHint: CSSProperties;
    readonly sliderRow: CSSProperties;
    readonly sliderValue: CSSProperties;
    readonly sliderBounds: CSSProperties;
    readonly switch: CSSProperties;
    readonly switchOn: CSSProperties;
    readonly switchKnob: CSSProperties;
    readonly accordionHeader: CSSProperties;
    readonly warningHint: CSSProperties;
    readonly ghostButton: CSSProperties;
    readonly iconOnlyButton: CSSProperties;
    readonly tableHeadRow: CSSProperties;
    readonly tableRow: CSSProperties;
    readonly checkbox: CSSProperties;
    readonly checkboxOn: CSSProperties;
    readonly sidePanelScrim: CSSProperties;
    readonly sidePanel: CSSProperties;
    readonly sidePanelHeader: CSSProperties;
    readonly sidePanelBody: CSSProperties;
};
/** Palette for auto-colored base avatars (hash → color). */
export declare const AVATAR_COLORS: readonly ["#3b6ef6", "#8b5cf6", "#ec4899", "#f59e0b", "#10b981", "#06b6d4", "#ef4444", "#6366f1"];
export declare function avatarColor(name: string): string;
/** Human-readable size from a character count (≈ bytes). */
export declare function formatSize(charCount: number): string;
/** Compact relative time, Cherry Studio style (刚刚 / N 分钟前 / N 小时前…). */
export declare function formatRelativeTime(timestamp: number, now?: number): string;
//# sourceMappingURL=theme.d.ts.map