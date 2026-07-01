/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { mockWirePlugin } from './src/mocks/devServer'

// The `@` → src alias is required by shadcn/ui (components import `@/lib/utils`, `@/components/ui/*`).
// This supersedes the FTR-51 no-alias decision: web/ now has its own biome.json (noUndeclaredDependencies
// off for the alias) and is excluded from the root Biome CI (FTR-56 migration). tailwindcss() is the
// Tailwind v4 Vite plugin; mockWirePlugin serves the ADR-008 wire in dev so the UI runs ⊥ surface.
export default defineConfig({
  plugins: [react(), tailwindcss(), mockWirePlugin()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    // Tests are co-located inside the standalone app (web/tests/) so they resolve
    // web/node_modules and stay isolated from the Node-side root toolchain.
    include: ['tests/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
  },
})
