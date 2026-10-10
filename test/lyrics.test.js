const test = require('node:test');
const assert = require('node:assert');
const { parseLrc, lineAt, cleanTitle, pickBest } = require('../extension/lyrics-core.js');

test('parses LRC including Thai text, repeated stamps and offset', () => {
  const lines = parseLrc('[ar:Artist]\n[offset:500]\n[00:12.50]ฉันยังรักเธอ\n[00:05.00][01:05.00]ท่อนฮุก\n[00:20.000]<00:20.00>คำ <00:21.00>ต่อคำ');
  assert.deepStrictEqual(lines, [
    { time: 4.5, text: 'ท่อนฮุก' },
    { time: 12, text: 'ฉันยังรักเธอ' },
    { time: 19.5, text: 'คำ ต่อคำ' },
    { time: 64.5, text: 'ท่อนฮุก' },
  ]);
});

test('returns null for plain lyrics', () => {
  assert.strictEqual(parseLrc('บรรทัดแรก\nบรรทัดที่สอง'), null);
});

test('finds the current line', () => {
  const lines = [{ time: 1 }, { time: 5 }, { time: 9 }];
  assert.strictEqual(lineAt(lines, 0.5), -1);
  assert.strictEqual(lineAt(lines, 1), 0);
  assert.strictEqual(lineAt(lines, 7), 1);
  assert.strictEqual(lineAt(lines, 100), 2);
});

test('cleans YouTube titles into search queries', () => {
  assert.strictEqual(cleanTitle('Bodyslam - ความเชื่อ 【OFFICIAL MV】 - YouTube'), 'Bodyslam ความเชื่อ');
  assert.strictEqual(cleanTitle('ไกลแค่ไหนคือใกล้ - Getsunova (Official MV) | Lyrics'), 'ไกลแค่ไหนคือใกล้ Getsunova');
  assert.strictEqual(cleanTitle('Official MV | เพลงรัก - ศิลปิน'), 'เพลงรัก ศิลปิน');
  assert.strictEqual(cleanTitle('ทางของฝุ่น [เนื้อเพลง]'), 'ทางของฝุ่น');
  assert.strictEqual(cleanTitle('Song ft. Someone (Lyric Video)'), 'Song');
  assert.strictEqual(cleanTitle('ความเชื่อ', 'Bodyslam - Topic'), 'Bodyslam ความเชื่อ');
});

test('prefers synced lyrics with the closest duration', () => {
  const results = [
    { id: 1, duration: 240, plainLyrics: 'a' },
    { id: 2, duration: 300, syncedLyrics: '[00:01]a' },
    { id: 3, duration: 243, syncedLyrics: '[00:01]a' },
    { id: 4, duration: 240 },
  ];
  assert.strictEqual(pickBest(results, 241).id, 3);
  assert.strictEqual(pickBest([results[0], results[3]], 241).id, 1);
  assert.strictEqual(pickBest([results[3]], 241), null);
});
