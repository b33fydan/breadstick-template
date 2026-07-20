import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.js', 'src/**/*.test.jsx', 'server/**/*.test.js', 'tools/**/*.test.js', 'mcp/**/*.test.js', 'lib/**/*.test.js', 'breadstick-buddy/**/*.test.js'],
    globals: true,
  },
});
