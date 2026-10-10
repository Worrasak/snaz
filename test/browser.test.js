// Runs the worklet inside real Chromium via OfflineAudioContext.
// Usage: node test/browser.test.js  (needs playwright)
const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const server = http.createServer((req, res) => {
  const file = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!file.startsWith(root) || !fs.existsSync(file)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': file.endsWith('.js') ? 'text/javascript' : 'text/html' });
  fs.createReadStream(file).pipe(res);
});

(async () => {
  await new Promise((r) => server.listen(0, r));
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`http://localhost:${server.address().port}/demo/index.html`);
  const result = await page.evaluate(async () => {
    const sr = 48000, n = sr * 2;
    const ctx = new OfflineAudioContext(2, n, sr);
    await ctx.audioWorklet.addModule('../extension/vocal-remover-worklet.js');
    const buf = ctx.createBuffer(2, n, sr);
    const l = buf.getChannelData(0), r = buf.getChannelData(1);
    for (let i = 0; i < n; i++) {
      const vocal = 0.5 * Math.sin(2 * Math.PI * 440 * i / sr);
      l[i] = vocal + 0.4 * Math.sin(2 * Math.PI * 1250 * i / sr);
      r[i] = vocal;
    }
    const src = new AudioBufferSourceNode(ctx, { buffer: buf });
    const node = new AudioWorkletNode(ctx, 'vocal-remover', {
      outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit',
      processorOptions: { enabled: true, strength: 1 },
    });
    src.connect(node).connect(ctx.destination);
    src.start();
    const out = await ctx.startRendering();
    const level = (x, f) => {
      let re = 0, im = 0;
      for (let i = n / 2; i < n; i++) { re += x[i] * Math.cos(2 * Math.PI * f * i / sr); im += x[i] * Math.sin(2 * Math.PI * f * i / sr); }
      return 2 * Math.hypot(re, im) / (n / 2);
    };
    const oL = out.getChannelData(0), oR = out.getChannelData(1);
    return { vocalL: level(oL, 440), vocalR: level(oR, 440), guitar: level(oL, 1250) };
  });
  await browser.close();
  server.close();
  console.log(result);
  const ok = result.vocalL < 0.025 && result.vocalR < 0.025 && result.guitar > 0.36;
  console.log(ok ? 'PASS' : 'FAIL');
  process.exit(ok ? 0 : 1);
})();
