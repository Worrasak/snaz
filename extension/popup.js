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
  for (const key of Object.keys(formats)) {
    $(key).value = s[key];
    $(`${key}Out`).textContent = formats[key](s[key]);
  }
}

chrome.storage.sync.get(SNAZ_DEFAULTS, render);

$('enabled').addEventListener('change', (e) => {
  chrome.storage.sync.set({ enabled: e.target.checked });
  setTimeout(refreshStatus, 300);
});
for (const key of Object.keys(formats)) {
  $(key).addEventListener('input', (e) => {
    const v = Number(e.target.value);
    $(`${key}Out`).textContent = formats[key](v);
    chrome.storage.sync.set({ [key]: v });
  });
}
$('reset').addEventListener('click', () => {
  chrome.storage.sync.set(SNAZ_DEFAULTS);
  render(SNAZ_DEFAULTS);
});

async function refreshStatus() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
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
refreshStatus();
