/**
 * OCR inference worker — PaddleOCR (PP-OCRv5 mobile, Cherry's engine choice
 * with a full Chinese dictionary) runs here first, Tesseract.js as fallback.
 * Everything runs in this thread so a native/WASM crash (onnxruntime,
 * OpenCV.js, tesseract's rethrown worker errors) can never take down the host
 * process; the client respawns on 'error' (Cherry's own-worker OCR posture).
 *
 * Protocol (JSON over parentPort):
 *   main → worker:  { id, type: 'ocr', png: Buffer, modelDir: string }
 *                    { type: 'shutdown' }
 *   worker → main:  { id, ok: true, text } | { id, ok: false, error }
 * @module dsh-knowledge/knowledge/ocr-worker
 */
export {};
//# sourceMappingURL=ocr-worker.d.ts.map