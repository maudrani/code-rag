import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Unmount React trees between tests so DOM state never leaks (testing-frontend).
afterEach(() => {
  cleanup()
})
