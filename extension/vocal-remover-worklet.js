// Vocal remover AudioWorklet.
//
// เสียงร้องนำในเพลงส่วนใหญ่ถูกมิกซ์ไว้ "ตรงกลาง" (ซ้ายและขวาเท่ากันและเฟสตรงกัน)
// ส่วนดนตรีและคอรัสมักกระจายอยู่ซ้าย-ขวา เราจึงแปลงสัญญาณเป็นความถี่ (STFT)
// แล้วลดเฉพาะ bin ที่ซ้ายกับขวาเหมือนกัน และอยู่ในช่วงความถี่ของเสียงร้อง
// โดยลดเฉพาะส่วน mid (L+R) ส่วน side (L-R) ซึ่งเป็นดนตรีที่กระจายซ้าย-ขวาจะไม่ถูกแตะ
// วิธีนี้เก็บภาพเสียงสเตอริโอ เบส และกลองกระเดื่องไว้ได้ดีกว่าการลบ L-R ตรงๆ

const FFT_SIZE = 2048;
const HOP = FFT_SIZE / 4;
// Hann analysis * Hann synthesis at 75% overlap sums to 1.5.
const OLA_GAIN = 1 / 1.5;

class FFT {
  constructor(n) {
    this.n = n;
    this.rev = new Uint32Array(n);
    const bits = Math.log2(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
    this.cos = new Float64Array(n / 2);
    this.sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / n);
      this.sin[i] = Math.sin((2 * Math.PI * i) / n);
    }
  }

  // In-place radix-2 transform. inverse=true omits the 1/n scaling.
  transform(re, im, inverse) {
    const { n, rev } = this;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    const sign = inverse ? 1 : -1;
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const step = n / size;
      for (let start = 0; start < n; start += size) {
        for (let k = 0; k < half; k++) {
          const wr = this.cos[k * step];
          const wi = sign * this.sin[k * step];
          const a = start + k;
          const b = a + half;
          const tr = re[b] * wr - im[b] * wi;
          const ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr; im[b] = im[a] - ti;
          re[a] += tr; im[a] += ti;
        }
      }
    }
  }
}

class VocalRemoverCore {
  constructor(sampleRate, params = {}) {
    this.sampleRate = sampleRate;
    // width: 0 = ตัดเฉพาะเสียงที่อยู่ตรงกลางเป๊ะ, 1 = ตัดเสียงที่เอียงซ้าย/ขวาไปด้วย
    this.params = { enabled: true, strength: 1, lowHz: 120, highHz: 8000, width: 0.2 };
    this.setParams(params);

    this.fft = new FFT(FFT_SIZE);
    this.window = new Float64Array(FFT_SIZE);
    for (let i = 0; i < FFT_SIZE; i++) {
      this.window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FFT_SIZE);
    }
    this.inL = new Float64Array(FFT_SIZE);
    this.inR = new Float64Array(FFT_SIZE);
    this.accL = new Float64Array(FFT_SIZE);
    this.accR = new Float64Array(FFT_SIZE);
    this.outL = new Float64Array(HOP);
    this.outR = new Float64Array(HOP);
    this.reL = new Float64Array(FFT_SIZE);
    this.imL = new Float64Array(FFT_SIZE);
    this.reR = new Float64Array(FFT_SIZE);
    this.imR = new Float64Array(FFT_SIZE);
    // Per-bin gain smoothed over time to reduce "musical noise" artifacts.
    this.gain = new Float64Array(FFT_SIZE / 2 + 1).fill(1);
    this.rover = 0;
  }

  setParams(p) {
    Object.assign(this.params, p);
  }

  // Processes equal-length stereo blocks; output may alias input.
  process(inL, inR, outL, outR) {
    for (let i = 0; i < inL.length; i++) {
      this.inL[FFT_SIZE - HOP + this.rover] = inL[i];
      this.inR[FFT_SIZE - HOP + this.rover] = inR[i];
      outL[i] = this.outL[this.rover];
      outR[i] = this.outR[this.rover];
      if (++this.rover === HOP) {
        this.rover = 0;
        this.processFrame();
      }
    }
  }

  processFrame() {
    const { reL, imL, reR, imR, window: w, fft, gain } = this;
    for (let i = 0; i < FFT_SIZE; i++) {
      reL[i] = this.inL[i] * w[i]; imL[i] = 0;
      reR[i] = this.inR[i] * w[i]; imR[i] = 0;
    }
    fft.transform(reL, imL, false);
    fft.transform(reR, imR, false);

    const { enabled, strength, lowHz, highHz, width } = this.params;
    const amount = enabled ? Math.min(Math.max(strength, 0), 1) : 0;
    // Similarity above which a bin starts counting as centered.
    const lo = 1 - 0.5 * Math.min(Math.max(width, 0.02), 1);
    const binHz = this.sampleRate / FFT_SIZE;
    const half = FFT_SIZE / 2;
    for (let k = 0; k <= half; k++) {
      const f = k * binHz;
      let target = 1;
      if (amount > 0 && f >= lowHz && f <= highHz) {
        const pl = reL[k] * reL[k] + imL[k] * imL[k];
        const pr = reR[k] * reR[k] + imR[k] * imR[k];
        // 1 when L == R (centered, in phase); <= 0 when hard-panned or out of phase.
        const sim = (2 * (reL[k] * reR[k] + imL[k] * imR[k])) / (pl + pr + 1e-12);
        let c = Math.min(Math.max((sim - lo) / (1 - lo), 0), 1);
        c = c * c * (3 - 2 * c);
        target = 1 - amount * c;
      }
      // Fast attack (cut quickly), slower release.
      const g = target < gain[k] ? 0.6 * target + 0.4 * gain[k] : 0.3 * target + 0.7 * gain[k];
      gain[k] = g;
      // Attenuate only the mid; the side holds stereo instruments and stays intact.
      const midRe = 0.5 * (reL[k] + reR[k]) * g;
      const midIm = 0.5 * (imL[k] + imR[k]) * g;
      const sideRe = 0.5 * (reL[k] - reR[k]);
      const sideIm = 0.5 * (imL[k] - imR[k]);
      reL[k] = midRe + sideRe; imL[k] = midIm + sideIm;
      reR[k] = midRe - sideRe; imR[k] = midIm - sideIm;
      if (k > 0 && k < half) {
        const m = FFT_SIZE - k;
        reL[m] = reL[k]; imL[m] = -imL[k];
        reR[m] = reR[k]; imR[m] = -imR[k];
      }
    }

    fft.transform(reL, imL, true);
    fft.transform(reR, imR, true);
    const scale = OLA_GAIN / FFT_SIZE;
    for (let i = 0; i < FFT_SIZE; i++) {
      this.accL[i] += reL[i] * w[i] * scale;
      this.accR[i] += reR[i] * w[i] * scale;
    }
    for (let i = 0; i < HOP; i++) {
      this.outL[i] = this.accL[i];
      this.outR[i] = this.accR[i];
    }
    this.accL.copyWithin(0, HOP); this.accL.fill(0, FFT_SIZE - HOP);
    this.accR.copyWithin(0, HOP); this.accR.fill(0, FFT_SIZE - HOP);
    this.inL.copyWithin(0, HOP);
    this.inR.copyWithin(0, HOP);
  }
}

if (typeof AudioWorkletProcessor !== 'undefined') {
  class VocalRemoverProcessor extends AudioWorkletProcessor {
    constructor(options) {
      super();
      this.core = new VocalRemoverCore(sampleRate, options.processorOptions || {});
      this.port.onmessage = (e) => this.core.setParams(e.data);
    }

    process(inputs, outputs) {
      const input = inputs[0];
      const output = outputs[0];
      if (!input || input.length === 0) return true;
      const l = input[0];
      const r = input[1] || input[0];
      this.core.process(l, r, output[0], output[1] || new Float32Array(l.length));
      return true;
    }
  }
  registerProcessor('vocal-remover', VocalRemoverProcessor);
} else if (typeof module !== 'undefined') {
  module.exports = { VocalRemoverCore, FFT_SIZE, HOP };
}
