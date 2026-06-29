import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Composer } from '../src/components/Composer'

describe('Composer', () => {
  it('Enter sends the trimmed text and clears the input', async () => {
    const onSend = vi.fn()
    const user = userEvent.setup()
    render(<Composer onSend={onSend} />)
    const input = screen.getByRole('textbox', { name: /message/i })
    await user.type(input, 'how does the membrane work')
    await user.keyboard('{Enter}')
    expect(onSend).toHaveBeenCalledWith('how does the membrane work')
    expect(input).toHaveValue('')
  })

  it('Shift+Enter inserts a newline and does NOT send', async () => {
    const onSend = vi.fn()
    const user = userEvent.setup()
    render(<Composer onSend={onSend} />)
    const input = screen.getByRole('textbox', { name: /message/i })
    await user.type(input, 'line one')
    await user.keyboard('{Shift>}{Enter}{/Shift}')
    expect(onSend).not.toHaveBeenCalled()
    expect((input as HTMLTextAreaElement).value).toContain('line one')
  })

  it('send is disabled when the input is empty', () => {
    render(<Composer onSend={vi.fn()} />)
    expect(screen.getByRole('button', { name: /send/i })).toBeDisabled()
  })

  it('while streaming, shows Stop instead of Send and calls onStop', async () => {
    const onStop = vi.fn()
    const user = userEvent.setup()
    render(<Composer onSend={vi.fn()} onStop={onStop} isStreaming />)
    expect(screen.queryByRole('button', { name: /send/i })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /stop/i }))
    expect(onStop).toHaveBeenCalled()
  })

  it('shows a Retry control when canRetry and calls onRetry', async () => {
    const onRetry = vi.fn()
    const user = userEvent.setup()
    render(<Composer onSend={vi.fn()} onRetry={onRetry} canRetry />)
    await user.click(screen.getByRole('button', { name: /retry/i }))
    expect(onRetry).toHaveBeenCalled()
  })

  it('Enter does NOT send while streaming (composer is in Stop mode)', async () => {
    const onSend = vi.fn()
    const user = userEvent.setup()
    render(<Composer onSend={onSend} onStop={vi.fn()} isStreaming />)
    const input = screen.getByRole('textbox', { name: /message/i })
    await user.type(input, 'queued thought')
    await user.keyboard('{Enter}')
    expect(onSend).not.toHaveBeenCalled()
  })
})
