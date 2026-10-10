// Pure helpers for lyrics: shared by the content script, the popup and tests.

// Parses LRC text ("[01:23.45]line"). Returns sorted [{ time, text }] or null
// when the text has no timestamps (plain lyrics).
function parseLrc(text) {
  const lines = [];
  let offset = 0;
  for (const raw of String(text).split(/\r?\n/)) {
    const off = raw.match(/^\[offset:\s*([+-]?\d+)\]/i);
    if (off) { offset = Number(off[1]) / 1000; continue; }
    const stamps = [];
    let rest = raw;
    let m;
    while ((m = rest.match(/^\s*\[(\d+):(\d+(?:[.:]\d+)?)\]/))) {
      stamps.push(Number(m[1]) * 60 + Number(m[2].replace(':', '.')));
      rest = rest.slice(m[0].length);
    }
    // Strip word-level timestamps of enhanced LRC ("<00:12.34>").
    const words = rest.replace(/<\d+:\d+(?:[.:]\d+)?>/g, '').trim();
    for (const time of stamps) lines.push({ time, text: words });
  }
  if (lines.length === 0) return null;
  for (const l of lines) l.time = Math.max(0, l.time - offset);
  return lines.sort((a, b) => a.time - b.time);
}

// Index of the line being sung at time t, or -1 before the first line.
function lineAt(lines, t) {
  let lo = 0, hi = lines.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].time <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

const JUNK = /\b(official|music|video|mv|m\/v|lyrics?|audio|visuali[sz]er|karaoke|4k|hd|hq|full ver(sion)?|teaser)\b|เนื้อเพลง|คาราโอเกะ|มิวสิควิดีโอ/gi;

// Turns a YouTube title like "ศิลปิน - เพลง【Official MV】| Label" into a search query.
function cleanTitle(title, channel = '') {
  let t = String(title)
    .replace(/\s*-\s*YouTube\s*$/, '')
    .replace(/[(\[【「『（][^)\]】」』）]*[)\]】」』）]/g, ' ');
  const parts = t.split(/[|｜]/).map((p) => p.trim()).filter(Boolean);
  t = parts.find((p) => p.replace(JUNK, '').trim().length > 1) || parts[0] || '';
  t = t
    .replace(/\b(feat|ft|prod)\.?\s.*$/i, '')
    .replace(JUNK, ' ')
    .replace(/["“”'‘’#]/g, ' ')
    .replace(/\s[-–—~]\s/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Auto-generated "Artist - Topic" channels have titles with just the song name.
  const topic = String(channel).match(/^(.*) - Topic$/);
  if (topic && !t.includes(topic[1])) t = `${topic[1]} ${t}`;
  return t;
}

// Picks the LRCLIB result that best fits the video: synced lyrics first, then
// the closest duration. Returns null when nothing has lyrics.
function pickBest(results, duration) {
  let best = null, bestScore = Infinity;
  for (const r of results) {
    if (!r.syncedLyrics && !r.plainLyrics) continue;
    let score = r.syncedLyrics ? 0 : 30;
    if (duration > 0 && r.duration > 0) score += Math.min(Math.abs(duration - r.duration), 60);
    if (score < bestScore) { best = r; bestScore = score; }
  }
  return best;
}

if (typeof module !== 'undefined') module.exports = { parseLrc, lineAt, cleanTitle, pickBest };
