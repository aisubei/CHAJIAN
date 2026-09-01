// src/knowledge/ocr-worker.ts
import { parentPort } from "node:worker_threads";
import { join } from "node:path";
var paddlePromise = null;
var paddleModelDir = null;
var tesseractPromise = null;
var tesseractWorkerPromise = null;
async function getPaddle(modelDir) {
  if (paddlePromise === null || paddleModelDir !== modelDir) {
    paddleModelDir = modelDir;
    paddlePromise = (async () => {
      try {
        const { env } = await import("onnxruntime-node");
        if (env !== void 0) env.logLevel = "error";
      } catch {
      }
      const mod = await import("ppu-paddle-ocr");
      const service = new mod.PaddleOcrService({
        model: {
          detection: join(modelDir, "ppocrv5_det.onnx"),
          recognition: join(modelDir, "ppocrv5_rec.onnx"),
          charactersDictionary: join(modelDir, "ppocrv5_dict.txt")
        }
      });
      await service.initialize();
      return service;
    })();
    paddlePromise.catch(() => {
      paddlePromise = null;
    });
  }
  return paddlePromise;
}
async function recognizeWithPaddle(service, png) {
  const buffer = png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength);
  const result = await service.recognize(buffer, { flatten: true });
  return result.text ?? "";
}
async function recognizeWithTesseract(png, langPath) {
  const tesseract = tesseractPromise ??= import("tesseract.js");
  const mod = await tesseract;
  tesseractWorkerPromise ??= mod.createWorker("chi_sim+eng", 1, { langPath }).catch((error) => {
    tesseractWorkerPromise = null;
    throw error;
  });
  const worker = await tesseractWorkerPromise;
  const bytes = new Uint8Array(png.buffer, png.byteOffset, png.byteLength);
  const { data } = await worker.recognize(bytes);
  return data.text;
}
parentPort?.on("message", (message) => {
  if (message.type === "shutdown") {
    process.exit(0);
    return;
  }
  const { id, png, modelDir } = message;
  void (async () => {
    try {
      let text = "";
      try {
        const service = await getPaddle(modelDir);
        text = (await recognizeWithPaddle(service, png)).trim();
      } catch {
        text = (await recognizeWithTesseract(png, modelDir)).trim();
      }
      parentPort?.postMessage({ id, ok: true, text });
    } catch (error) {
      parentPort?.postMessage({ id, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  })();
});
//# sourceMappingURL=ocr-worker.mjs.map
