const $ = (id) => document.getElementById(id);
const formats = {
  strength: (v) => `${Math.round(v * 100)}%`,
  lowHz: (v) => `${v} Hz`,
  highHz: (v) => `${(v / 1000).toFixed(1)} kHz`,
  boostDb: (v) => `+${v} dB`,
  width: (v) => (v <= 0.25 ? 'แคบ' : v <= 0.6 ? 'กลาง' : 'กว้าง'),
};

function render(s) {
  $('enabled').checked = s.enabled;
  $('lyrics').checked = s.lyrics;
  $('autoGain').checked = s.autoGain;
  for (const key of Object.keys(formats)) {
    $(key).value = s[key];
    $(`${key}Out`).textContent = formats[key](s[key]);
  }
}

chrome.storage.sync.get(SNAZ_DEFAULTS, render);

$('enabled').addEventListener('change', (e) => {
  chrome.storage.sync.set({ enabled: e.target.checked });
  setTimeout(refreshStatus, 300);
  setTimeout(() => lyricsCall({ type: 'lyrics-state' }), 1500);
});
$('autoGain').addEventListener('change', (e) => chrome.storage.sync.set({ autoGain: e.target.checked }));
$('lyrics').addEventListener('change', (e) => {
  chrome.storage.sync.set({ lyrics: e.target.checked });
  setTimeout(() => lyricsCall({ type: 'lyrics-state' }), 1500);
});
for (const key of Object.keys(formats)) {
  $(key).addEventListener('input', (e) => {
    const v = Number(e.target.value);
    $(`${key}Out`).textContent = formats[key](v);
    chrome.storage.sync.set({ [key]: v });
  });
}
$('reset').addEventListener('click', () => {
  const { enabled, lyrics, ...sound } = SNAZ_DEFAULTS;
  chrome.storage.sync.set(sound);
  chrome.storage.sync.get(SNAZ_DEFAULTS, render);
});

for (const tab of document.querySelectorAll('.tabs button')) {
  tab.addEventListener('click', () => {
    for (const t of document.querySelectorAll('.tabs button')) t.classList.toggle('active', t === tab);
    $('tab-sound').hidden = tab.dataset.tab !== 'sound';
    $('tab-lyrics').hidden = tab.dataset.tab !== 'lyrics';
  });
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function refreshStatus() {
  const tab = await activeTab();
  chrome.tabs.sendMessage(tab.id, { type: 'snaz-status' }, (res) => {
    if (chrome.runtime.lastError || !res) {
      $('status').textContent = 'เปิดหน้า YouTube แล้วรีเฟรชหน้าเว็บหนึ่งครั้ง';
      return;
    }
    if (!res.hasVideo) $('status').textContent = 'ยังไม่พบวิดีโอในหน้านี้';
    else if (res.contextState === 'suspended') $('status').textContent = 'คลิกที่วิดีโอหนึ่งครั้งเพื่อเริ่มเสียง';
    else if (res.mode === 'worklet') $('status').textContent = 'กำลังทำงาน (โหมด STFT คุณภาพสูง)';
    else if (res.mode === 'fallback') $('status').textContent = 'กำลังทำงาน (โหมดฟิลเตอร์อย่างง่าย)';
    else $('status').textContent = 'พร้อมแล้ว — เปิดสวิตช์เพื่อตัดเสียงร้อง';
  });
}

async function lyricsCall(msg) {
  const tab = await activeTab();
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tab.id, msg, (st) => {
      if (chrome.runtime.lastError || !st) { resolve(null); return; }
      renderLyrics(st);
      resolve(st);
    });
  });
}

function renderLyrics(st) {
  const now = $('lyricsNow');
  if (!st.videoId) now.textContent = 'เปิดวิดีโอเพลงบน YouTube ก่อน';
  else if (st.status === 'searching') now.textContent = 'กำลังค้นหาเนื้อเพลง…';
  else if (st.status === 'found') now.textContent = `✅ ${st.label}${st.synced ? '' : ' (ไม่มีเวลากำกับ)'}`;
  else if (st.status === 'notfound') now.textContent = 'ไม่พบเนื้อเพลง ลองค้นหาด้วยชื่ออื่น หรือวางเนื้อเพลงเอง';
  else if (st.status === 'error') now.textContent = `ค้นหาไม่สำเร็จ: ${st.error}`;
  else now.textContent = 'เปิดสวิตช์ด้านบนเพื่อค้นหาเนื้อเพลงอัตโนมัติ';

  $('offsetOut').textContent = `${st.offset > 0 ? '+' : ''}${st.offset.toFixed(1)} วิ`;
  if (st.query && document.activeElement !== $('query')) $('query').value = st.query;

  const list = $('results');
  list.replaceChildren();
  st.results.forEach((r, index) => {
    const li = document.createElement('li');
    const m = Math.floor(r.duration / 60);
    li.textContent = r.label;
    const meta = document.createElement('small');
    meta.textContent = `${m}:${String(Math.round(r.duration % 60)).padStart(2, '0')} ${r.synced ? '⏱' : ''}`;
    li.append(meta);
    li.addEventListener('click', () => lyricsCall({ type: 'lyrics-select', index }));
    list.append(li);
  });
}

for (const b of document.querySelectorAll('[data-delta]')) {
  b.addEventListener('click', () => lyricsCall({ type: 'lyrics-offset', delta: Number(b.dataset.delta) }));
}
$('searchForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = $('query').value.trim();
  if (!q) return;
  $('lyricsNow').textContent = 'กำลังค้นหาเนื้อเพลง…';
  lyricsCall({ type: 'lyrics-search', q });
});
$('saveCustom').addEventListener('click', () => {
  const text = $('custom').value.trim();
  if (text) lyricsCall({ type: 'lyrics-custom', text });
});
$('clearLyrics').addEventListener('click', () => {
  $('lyricsNow').textContent = 'กำลังค้นหาเนื้อเพลง…';
  lyricsCall({ type: 'lyrics-clear' });
});

refreshStatus();
lyricsCall({ type: 'lyrics-state' });
