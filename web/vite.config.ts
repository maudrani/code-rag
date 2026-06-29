/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { mockWirePlugin } from './src/mocks/devServer'

// No path aliases: the root Biome enforces noUndeclaredDependencies (error) globally and
// does not resolve tsconfig path aliases, so web/ uses relative imports (FTR-51 / TKT-501 D3).
// mockWirePlugin serves the ADR-008 wire in dev so the whole UI runs ⊥ surface (TKT-502).
export default defineConfig({
  plugins: [react(), mockWirePlugin()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    // Tests are co-located inside the standalone app (web/tests/) so they resolve
    // web/node_modules and stay isolated from the Node-side root toolchain.
    include: ['tests/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
  },
})
