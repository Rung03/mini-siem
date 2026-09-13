// ตั้งค่าเทสต์: รันทีละไฟล์เพราะใช้ฐานข้อมูลร่วมกัน

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
