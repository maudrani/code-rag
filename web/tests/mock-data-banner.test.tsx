import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App'
import { MockDataBanner } from '../src/components/MockDataBanner'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('MockDataBanner', () => {
  it('renders an unmissable MOCK DATA warning when active', () => {
    render(<MockDataBanner active={true} />)
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(/mock data/i)
    expect(alert).toHaveTextContent(/no backend/i)
    expect(alert).toHaveTextContent(/VITE_API_BASE/)
  })

  // Failure twin: on a real backend the banner MUST NOT render (no false "mock" warning).
  it('renders nothing when inactive', () => {
    const { container } = render(<MockDataBanner active={false} />)
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('is present in the App shell on every tab (mock dev env)', async () => {
    // a never-resolving fetch lets the Observability tab mount without a real backend
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    )
    const user = userEvent.setup()
    render(<App />)

    expect(screen.getByTestId('mock-data-banner')).toBeInTheDocument() // chat (default)
    await user.click(screen.getByRole('button', { name: /manual search/i }))
    expect(screen.getByTestId('mock-data-banner')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /observability/i }))
    expect(screen.getByTestId('mock-data-banner')).toBeInTheDocument()
  })
})
