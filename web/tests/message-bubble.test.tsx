import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '../src/clients/useChatStream'
import { MessageBubble } from '../src/components/MessageBubble'
import { answerProjection } from '../src/mocks/fixtures'

describe('MessageBubble', () => {
  it('renders a user turn as plain content', () => {
    const msg: ChatMessage = { id: 1, role: 'user', content: 'where is the score gate?' }
    render(<MessageBubble message={msg} />)
    expect(screen.getByText('where is the score gate?')).toBeInTheDocument()
  })

  it('renders an assistant answer with its decision badge + content', () => {
    const msg: ChatMessage = {
      id: 2,
      role: 'assistant',
      content: 'The membrane resolves then retrieves.',
      phase: 'done',
      decision: { groundingScore: 0.03, band: 'answer', tier: 'strong', model: 'm' },
    }
    render(<MessageBubble message={msg} />)
    expect(screen.getByText('The membrane resolves then retrieves.')).toBeInTheDocument()
    expect(screen.getByText('answer')).toBeInTheDocument()
  })

  it('renders a refusal (no answer content) for the refuse band', () => {
    const msg: ChatMessage = {
      id: 3,
      role: 'assistant',
      content: '',
      phase: 'refused',
      decision: { groundingScore: 0.006, band: 'refuse', tier: 'cheap', model: 'm' },
    }
    render(<MessageBubble message={msg} />)
    expect(screen.getByText('refused')).toBeInTheDocument()
    expect(screen.getByText(/not enough grounding/i)).toBeInTheDocument()
  })

  it('reveals the EXACT substrate + prompt on toggle (answered turn carrying a prompt)', async () => {
    const user = userEvent.setup()
    const msg: ChatMessage = {
      id: 5,
      role: 'assistant',
      content: 'answer',
      phase: 'done',
      decision: { groundingScore: 0.03, band: 'answer', tier: 'strong', model: 'm' },
      prompt: {
        system: 'Answer ONLY from the provided code context below.\n\nContext:\n// src/x.ts\ncode',
        messages: [{ role: 'user', content: 'how does x work' }],
      },
    }
    render(<MessageBubble message={msg} />)
    const toggle = screen.getByTestId('prompt-inspector-toggle')
    expect(toggle).toHaveTextContent(/show the exact prompt/i)
    await user.click(toggle)
    // the substrate (answer-only policy + assembled context) and the messages the API receives
    expect(screen.getByTestId('prompt-system')).toHaveTextContent(
      'Answer ONLY from the provided code',
    )
    expect(screen.getByTestId('prompt-system')).toHaveTextContent('Context:')
    expect(screen.getByTestId('prompt-messages')).toHaveTextContent('user: how does x work')
  })

  it('does NOT show the prompt inspector on a refused turn — nothing was sent to the model', () => {
    const msg: ChatMessage = {
      id: 6,
      role: 'assistant',
      content: '',
      phase: 'refused',
      decision: { groundingScore: 0.006, band: 'refuse', tier: 'cheap', model: 'm' },
      prompt: { system: 'x', messages: [{ role: 'user', content: 'q' }] },
    }
    render(<MessageBubble message={msg} />)
    expect(screen.queryByTestId('prompt-inspector-toggle')).not.toBeInTheDocument()
  })

  it('clicking a citation opens the in-app source code (joined from results)', async () => {
    const user = userEvent.setup()
    const msg: ChatMessage = {
      id: 4,
      role: 'assistant',
      content: 'The membrane resolves then retrieves.',
      phase: 'done',
      decision: answerProjection.decision,
      citations: answerProjection.citations,
      results: answerProjection.results,
    }
    render(<MessageBubble message={msg} />)
    await user.click(screen.getByRole('button', { name: answerProjection.citations[0].label }))
    expect(screen.getByText(/export async function query/)).toBeInTheDocument()
  })
})
