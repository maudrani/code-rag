import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { App } from '../src/App'

describe('App (toolchain smoke)', () => {
  it('renders a main landmark', () => {
    render(<App />)
    // getByRole over getByTestId (testing-frontend: query as a user would).
    expect(screen.getByRole('main')).toBeInTheDocument()
  })
})
