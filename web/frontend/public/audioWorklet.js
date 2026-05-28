/**
 * PCMDownsamplerProcessor — AudioWorklet processor that:
 *   1. Receives Float32 frames from the browser's AudioContext (typically 48 kHz)
 *   2. Downsamples to 16 kHz via linear interpolation
 *   3. Quantises Float32 → Int16 LE
 *   4. Posts ~100 ms ArrayBuffer chunks (1 600 samples / 3 200 bytes) to the
 *      main thread via port.postMessage
 *
 * WHY A STATIC FILE IN /public:
 *   Vite bundles files referenced via `new URL('./file.ts', import.meta.url)`
 *   as base64 data URIs with the MIME type inferred from the extension.
 *   The `.ts` extension is ambiguous — browsers treat it as video/mp2t (MPEG-2
 *   Transport Stream), not JavaScript.  Additionally, the TypeScript source is
 *   not transpiled when inlined this way, so private class-field syntax reaches
 *   the browser verbatim and throws a SyntaxError.
 *
 *   AudioWorklets are loaded by URL at runtime and do NOT need to be in the
 *   Vite module graph.  Placing the file in /public ensures it is:
 *     • Served with Content-Type: application/javascript
 *     • Plain JavaScript — no transpile step required
 *     • Loaded via a simple absolute path: audioCtx.audioWorklet.addModule('/audioWorklet.js')
 */

class PCMDownsamplerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.targetRate = 16000;
    // sampleRate is a global provided by the AudioWorkletGlobalScope.
    this.ratio = sampleRate / this.targetRate;
    // 100 ms worth of output samples at 16 kHz.
    this.targetChunkSize = (this.targetRate / 10) | 0; // 1600
    this.buffer = new Float32Array(this.targetChunkSize);
    this.bufferIndex = 0;
    // Fractional accumulator for the downsampling ratio.
    this.accumulator = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;

    // Take only the first (mono) channel.
    const channelData = input[0];
    if (!channelData) return true;

    for (let i = 0; i < channelData.length; i++) {
      this.accumulator += 1;
      if (this.accumulator >= this.ratio) {
        this.accumulator -= this.ratio;
        this.buffer[this.bufferIndex++] = channelData[i];

        if (this.bufferIndex >= this.targetChunkSize) {
          this._flush();
        }
      }
    }

    // Returning true keeps the processor alive.
    return true;
  }

  _flush() {
    // Convert Float32 [-1, 1] → Int16 LE.
    const pcm = new Int16Array(this.bufferIndex);
    for (let i = 0; i < this.bufferIndex; i++) {
      const s = Math.max(-1, Math.min(1, this.buffer[i]));
      pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    // Transfer ownership of the underlying ArrayBuffer for zero-copy messaging.
    this.port.postMessage(pcm.buffer, [pcm.buffer]);
    this.bufferIndex = 0;
    this.buffer = new Float32Array(this.targetChunkSize);
  }
}

registerProcessor('pcm-downsampler', PCMDownsamplerProcessor);
