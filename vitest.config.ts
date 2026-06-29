import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.{test,spec}.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/**/index.ts', 'src/contracts/**'],
      // Critical paths (membrane, retrieval fusion, guardrails/refuse, wire, score-gate)
      // get real cover incl. edge + negative cases (ADR-009). Tune per layer.
      thresholds: { lines: 70, functions: 70, branches: 65 },
    },
  },
})
