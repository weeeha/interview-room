/**
 * Source of the AudioWorklet processor, loaded through a Blob URL so it needs no bundler support
 * and works the same in Chrome and Safari. It copies mono input into 512-sample chunks and posts them.
 */
export const PCM_WORKLET_NAME = "interview-room-pcm";

export const PCM_WORKLET_SOURCE = `
class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(512);
    this.n = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.buf[this.n++] = ch[i];
      if (this.n === this.buf.length) {
        const out = this.buf;
        this.port.postMessage(out, [out.buffer]);
        this.buf = new Float32Array(512);
        this.n = 0;
      }
    }
    return true;
  }
}
registerProcessor("${PCM_WORKLET_NAME}", PcmCapture);
`;
