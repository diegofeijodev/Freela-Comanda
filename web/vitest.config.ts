import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Só lógica pura (fichas, DRE, DDA, NF-e, objetivo, CSV, vendas). Um processo só: a máquina do dono trava com paralelismo.
export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
