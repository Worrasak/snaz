const test = require('node:test');
const assert = require('node:assert');
const { VocalRemoverCore, FFT_SIZE } = require('../extension/vocal-remover-worklet.js');

const SR = 48000;
const N = SR * 2;

function sine(freq, amp, phase = 0) {
  const out = new Float32Array(N);
  for (let i = 0; i < N; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / SR + phase);
  return out;
}

function run(l, r, params) {
  const core = new VocalRemoverCore(SR, params);
  const outL = new Float32Array(N);
  const outR = new Float32Array(N);
  for (let i = 0; i < N; i += 128) {
    core.process(l.subarray(i, i + 128), r.subarray(i, i + 128), outL.subarray(i, i + 128), outR.subarray(i, i + 128));
  }
  return [outL, outR];
}

// Amplitude of `freq` in the settled second half of the signal.
function level(x, freq) {
  let re = 0, im = 0;
  const start = N / 2;
  for (let i = start; i < N; i++) {
    re += x[i] * Math.cos((2 * Math.PI * freq * i) / SR);
    im += x[i] * Math.sin((2 * Math.PI * freq * i) / SR);
  }
  return (2 * Math.hypot(re, im)) / (N - start);
}

test('passes audio through unchanged (after latency) when disabled', () => {
  const l = sine(440, 0.5);
  const r = sine(660, 0.5);
  const [outL, outR] = run(l, r, { enabled: false });
  for (let i = N / 2; i < N / 2 + 1000; i++) {
    assert.ok(Math.abs(outL[i] - l[i - FFT_SIZE]) < 1e-6);
    assert.ok(Math.abs(outR[i] - r[i - FFT_SIZE]) < 1e-6);
  }
});

test('removes centered vocal but keeps panned instrument and bass', () => {
  const vocal = sine(440, 0.5);   // centered: same in L and R
  const guitar = sine(1250, 0.4); // hard left
  const bass = sine(60, 0.5);     // centered but below lowHz
  const l = new Float32Array(N);
  const r = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    l[i] = vocal[i] + guitar[i] + bass[i];
    r[i] = vocal[i] + bass[i];
  }
  const [outL, outR] = run(l, r, { enabled: true, strength: 1 });

  assert.ok(level(outL, 440) < 0.05 * 0.5, `vocal L ${level(outL, 440)}`);
  assert.ok(level(outR, 440) < 0.05 * 0.5, `vocal R ${level(outR, 440)}`);
  assert.ok(level(outL, 1250) > 0.9 * 0.4, `guitar ${level(outL, 1250)}`);
  assert.ok(level(outL, 60) > 0.9 * 0.5, `bass ${level(outL, 60)}`);
});

test('strength 0.5 roughly halves the centered vocal', () => {
  const v = sine(440, 0.5);
  const [outL] = run(v, v.slice(), { enabled: true, strength: 0.5, autoGain: false });
  const lv = level(outL, 440);
  assert.ok(lv > 0.2 && lv < 0.3, `vocal ${lv}`);
});

test('keeps a slightly panned instrument', () => {
  const keys = sine(700, 0.5);
  const l = new Float32Array(N);
  const r = new Float32Array(N);
  for (let i = 0; i < N; i++) { l[i] = 0.65 * keys[i]; r[i] = 0.35 * keys[i]; }
  const [outL, outR] = run(l, r, { enabled: true, strength: 1 });
  assert.ok(level(outL, 700) > 0.9 * 0.65 * 0.5, `keys L ${level(outL, 700)}`);
  assert.ok(level(outR, 700) > 0.9 * 0.35 * 0.5, `keys R ${level(outR, 700)}`);
});

test('keeps the side part of an instrument sharing a bin with the vocal', () => {
  const vocal = sine(440, 0.5);
  const guitar = sine(440, 0.3, Math.PI / 3); // hard left, same frequency
  const l = new Float32Array(N);
  const r = new Float32Array(N);
  for (let i = 0; i < N; i++) { l[i] = vocal[i] + guitar[i]; r[i] = vocal[i]; }
  const [outL, outR] = run(l, r, { enabled: true, strength: 1 });
  // The guitar's side component (half its amplitude) must survive in both channels.
  assert.ok(level(outL, 440) > 0.12, `L ${level(outL, 440)}`);
  assert.ok(level(outR, 440) > 0.12, `R ${level(outR, 440)}`);
});

test('auto gain brings the music back toward the original loudness', () => {
  const vocal = sine(440, 0.5);
  const guitar = sine(1250, 0.2);
  const l = new Float32Array(N);
  const r = new Float32Array(N);
  for (let i = 0; i < N; i++) { l[i] = vocal[i] + guitar[i]; r[i] = vocal[i] - guitar[i]; }
  const [plainL] = run(l, r, { enabled: true, strength: 1, autoGain: false });
  const [autoL] = run(l, r, { enabled: true, strength: 1, autoGain: true });
  assert.ok(Math.abs(level(plainL, 1250) - 0.2) < 0.02, `plain ${level(plainL, 1250)}`);
  // Capped at +9 dB, so the guitar ends up much louder but never above 2.8x.
  const boosted = level(autoL, 1250);
  assert.ok(boosted > 0.4 && boosted <= 0.2 * 2.8 + 0.01, `auto ${boosted}`);
  assert.ok(level(autoL, 440) < 0.05, `vocal ${level(autoL, 440)}`);
});
