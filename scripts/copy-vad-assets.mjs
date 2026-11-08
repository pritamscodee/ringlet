// Copies Silero VAD model, worklet and ONNX runtime files into public/vad.
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

const out = "public/vad";
mkdirSync(out, { recursive: true });
const vad = "node_modules/@ricky0123/vad-web/dist";
for (const f of ["vad.worklet.bundle.min.js", "silero_vad_v5.onnx", "silero_vad_legacy.onnx"]) {
  copyFileSync(join(vad, f), join(out, f));
}
const ort = "node_modules/onnxruntime-web/dist";
for (const f of readdirSync(ort)) {
  if (/^ort-wasm-simd-threaded(\.jsep)?\.(wasm|mjs)$/.test(f)) copyFileSync(join(ort, f), join(out, f));
}
console.log("VAD assets copied to", out);
