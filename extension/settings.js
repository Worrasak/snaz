// Shared between the content script and the popup.
const SNAZ_DEFAULTS = {
  enabled: false,
  // 0 = เสียงต้นฉบับ, 1 = ตัดเสียงร้องเต็มที่
  strength: 1,
  // ตัดเฉพาะช่วงความถี่ของเสียงร้อง เพื่อเก็บเบส/กลองกระเดื่อง (ต่ำ) และฉาบ (สูง) ไว้
  lowHz: 120,
  highHz: 8000,
};
