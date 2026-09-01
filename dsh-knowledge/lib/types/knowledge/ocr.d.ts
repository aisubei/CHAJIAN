/**
 * Local OCR for scanned PDFs (Cherry's local-document posture). When
 * pdf-parse and anydoc both fail to extract a text layer, the PDF's pages are
 * rendered at ~216dpi through pdfjs onto an @napi-rs/canvas surface (Cherry's
 * pdfPageOcr renders each page) and PaddleOCR recognizes the full-page raster.
 * Two fallbacks keep it working without a canvas: embedded rasters are
 * extracted via pdfjs operator lists (no rendering), and a worker thread runs
 * PaddleOCR (WASM/ONNX, isolated so a native crash cannot take down the host).
 * @module dsh-knowledge/knowledge/ocr
 */
export interface OcrModelStatus {
    status: 'idle' | 'downloading' | 'ready' | 'error';
    /** 0–100 aggregate download progress across languages. */
    progress: number;
    message: string;
}
export declare const DEFAULT_OCR_MIRROR = "https://hf-mirror.com";
/** Join a configured HF endpoint with an OCR model's repo path (Cherry model mirror posture). */
export declare function buildOcrUrl(mirror: string | undefined, repoPath: string): string;
/** Parse a PaddleOCR inference.yml `character_dict` block (list of `- 'x'` / `- x` lines). */
export declare function parseCharacterDict(yml: string): string[];
export declare function getOcrModelStatus(): OcrModelStatus;
/**
 * Whether the PaddleOCR engine is fully on disk (det + rec weights + parsed
 * dictionary) — the parse fallback gate.
 */
export declare function isOcrReady(): boolean;
/**
 * Download the PaddleOCR engine files with aggregate progress; idempotent per
 * file and coalesced (concurrent callers share one in-flight download —
 * Cherry's LocalModelDownloadService.inFlight). The dictionary is parsed out
 * of the recognition model's inference.yml (Cherry's dictTextFromInferenceYml).
 *
 * @param mirror - optional HF endpoint override (the `hfEndpoint` setting);
 *   defaults to the China-friendly hf-mirror.com.
 */
export declare function downloadOcrModels(mirror?: string): Promise<OcrModelStatus>;
/**
 * Remove the OCR cache. The worker is released first so a Windows file lock
 * cannot block the unlink (Cherry terminates its OCR worker before deleting
 * weights for the same reason).
 */
export declare function removeOcrModels(): Promise<void>;
interface PdfImage {
    width: number;
    height: number;
    /** RGBA pixel data (normalized from whatever pdfjs decoded). */
    data: Uint8ClampedArray;
}
/**
 * Render every page of a PDF to a full-page PNG (Cherry's pdfPageOcr: scanned
 * pages and vector-only pages both end up as one image per page, so OCR sees
 * the complete layout instead of isolated embedded fragments). Returns null
 * when the renderer is unavailable — the caller falls back to embedded-raster
 * extraction. Exported for tests.
 */
export declare function renderPdfPages(bytes: Uint8Array, maxPages: number): Promise<Array<{
    page: number;
    png: Buffer;
}> | null>;
/** Release the worker (plugin teardown). Idempotent; resolves once the
 *  worker thread has actually exited so callers can move/delete the OCR
 *  weights without a Windows file lock blocking the operation. */
export declare function disposeOcrWorker(): Promise<void>;
/**
 * Extract every embedded raster on each PDF page via pdfjs (no canvas
 * rendering — scanned pages are embedded images), normalize to RGBA.
 * Exported for tests (the decoded shape drives normalizeRgba's branches).
 */
export declare function extractPdfImages(bytes: Uint8Array): Promise<Array<PdfImage & {
    page: number;
}>>;
/** Normalize pdfjs-decoded pixel data (RGBA / RGB / single-channel gray / 1-bit) to RGBA. */
export declare function normalizeRgba(image: {
    width: number;
    height: number;
    data: Uint8ClampedArray | Uint8Array;
}): Uint8ClampedArray;
/** Encode RGBA pixels as PNG using only node:zlib (no canvas/native deps). */
export declare function rgbaToPng(width: number, height: number, rgba: Uint8ClampedArray): Buffer;
/**
 * OCR a scanned PDF. The preferred path renders every page to a full-page
 * raster via mupdf (Cherry's pdfPageOcr) so vector-only pages — e.g. PDFs
 * whose body is drawn with subsetted fonts instead of embedded bitmaps — are
 * recognized as complete pages rather than as isolated character fragments.
 * Without a renderer it falls back to extracting embedded rasters via pdfjs
 * operator lists. Returns '' when the OCR models are not downloaded (the
 * caller keeps its "no extractable text" error) or when nothing was
 * recognized.
 */
export declare function ocrPdfText(bytes: Uint8Array): Promise<string>;
/**
 * Cherry's OCR input chain (sharp grayscale → normalize → sharpen) in pure JS:
 * grayscale, min-max contrast stretch, then a 3x3 unsharp kernel. Small
 * rasters are upscaled 2x before the chain so thin strokes survive.
 */
export declare function prepareForOcr(width: number, height: number, rgba: Uint8ClampedArray): {
    width: number;
    height: number;
    data: Uint8ClampedArray;
};
/**
 * Tesseract separates CJK glyphs with spaces ("中 文 测 试"); collapse spaces
 * between CJK characters so the indexed text matches natural search queries.
 * Only HORIZONTAL whitespace is folded: newlines separate OCR lines and must
 * survive (a CJK line ending next to a CJK line starting would otherwise be
 * glued into one line, destroying paragraph structure).
 */
export declare function postprocessOcrText(text: string): string;
/** List engine files currently on disk (settings panel detail). */
export declare function listOcrLanguages(): Promise<Array<{
    lang: string;
    ready: boolean;
}>>;
export {};
//# sourceMappingURL=ocr.d.ts.map