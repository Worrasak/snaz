// Loads the unpacked extension into Chromium against a mocked youtube.com page
// and checks that the content script hooks the <video>.
// Usage: node test/extension.test.js  (needs playwright)
const { chromium } = require('playwright');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const extDir = path.join(__dirname, '..', 'extension');

// Chrome derives an unpacked extension's id from its absolute path.
function extensionId(dir) {
  const hash = crypto.createHash('sha256').update(dir).digest('hex').slice(0, 32);
  return [...hash].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
}

function wav(seconds) {
  const sr = 48000, n = sr * seconds, data = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) {
    const v = Math.round(16000 * Math.sin(2 * Math.PI * 440 * i / sr));
    data.writeInt16LE(v, i * 4);
    data.writeInt16LE(v, i * 4 + 2);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22);
  h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

(async () => {
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'snaz-'));
  const context = await chromium.launchPersistentContext(userDir, {
    headless: true,
    channel: 'chromium', // the headless shell can't load extensions
    args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`,
      '--autoplay-policy=no-user-gesture-required'],
  });
  await context.route('https://www.youtube.com/**', (route) => {
    if (route.request().url().endsWith('/song.wav')) {
      return route.fulfill({ body: wav(3), contentType: 'audio/wav' });
    }
    return route.fulfill({ contentType: 'text/html; charset=utf-8',
      body: '<div id="movie_player" style="position:relative;width:640px;height:360px">'
        + '<video class="html5-main-video" src="/song.wav" loop></video></div>'
        + '<ytd-watch-metadata><h1>ทดสอบ - เพลงไทย【Official MV】</h1></ytd-watch-metadata>' });
  });
  let lyricsQuery = null;
  await context.route('https://lrclib.net/**', (route) => {
    lyricsQuery = new URL(route.request().url()).searchParams.get('q');
    return route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify([{ artistName: 'ทดสอบ', trackName: 'เพลงไทย', duration: 3,
        syncedLyrics: '[00:00.00]บรรทัดแรก\n[00:01.00]ฉันยังรักเธอ\n[00:02.50]บรรทัดสุดท้าย' }]) });
  });

  const id = extensionId(extDir);
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await popup.click('.slider');

  const page = await context.newPage();
  const logs = [];
  page.on('console', (m) => logs.push(m.text()));
  await page.goto('https://www.youtube.com/watch?v=test');
  await page.click('video', { force: true });
  await page.evaluate(() => document.querySelector('video').play());
  await page.evaluate(() => { document.querySelector('video').currentTime = 1.2; });
  const lyric = await page.waitForFunction(() => {
    const el = document.querySelector('.snaz-lyrics .cur');
    return el && !el.closest('[hidden]') && el.textContent === 'ฉันยังรักเธอ' && el.textContent;
  }, null, { timeout: 10000 }).then((h) => h.jsonValue()).catch(() => null);
  await page.screenshot({ path: path.join(os.tmpdir(), 'snaz-lyrics.png') });
  await context.close();

  console.log(logs, { lyricsQuery, lyric });
  const ok = logs.some((l) => l.includes('[Snaz Karaoke] active (worklet mode)'))
    && lyricsQuery === 'ทดสอบ เพลงไทย' && lyric === 'ฉันยังรักเธอ';
  console.log(ok ? 'PASS' : 'FAIL');
  process.exit(ok ? 0 : 1);
})();
