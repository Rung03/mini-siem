// สีของธีมสว่างที่กราฟใช้ (Recharts ต้องการค่า hex) — ผ่านตัวตรวจสีบนพื้นการ์ดสีขาวแล้ว

export const COLORS = {
  surface: '#ffffff',
  grid: '#e8ebf3',
  axis: '#8a93a6',
  success: '#2a78d6',
  failure: '#e34948',
  series1: '#6d5ce8',
} as const;

// สีแหล่งข้อมูลในโดนัท เรียงตามวงแหวน firewall → network → api → crowdstrike → m365 → (กลับไป firewall)
// ทุกคู่ที่อยู่ติดกันบนวงผ่านการแยกสีสำหรับคนตาบอดสี คู่ที่ใกล้กัน (ส้ม/เหลือง, ส้ม/ชมพู) ถูกวางไม่ให้ติดกัน
export const SOURCE_COLORS: Record<string, string> = {
  firewall: '#1baf7a',
  network: '#eb6834',
  api: '#4a3aa7',
  crowdstrike: '#e87ba4',
  m365: '#eda100',
};

export const OTHER_COLOR = '#c3c6d1';
