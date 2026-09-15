// ตั้งค่าเทสต์: ไฟล์เทสต์อยู่ที่ /tests ของ repo และรันทีละไฟล์เพราะใช้ฐานข้อมูลร่วมกัน

import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    dir: fileURLToPath(new URL('../tests', import.meta.url)),
    include: ['**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
