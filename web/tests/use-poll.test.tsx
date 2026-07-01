import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePoll } from '../src/clients/usePoll'

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('usePoll', () => {
  it('starts loading, then exposes the resolved data and clears loading', async () => {
    const fetcher = vi.fn().mockResolvedValue({ v: 1 })
    const { result } = renderHook(() => usePoll(fetcher, 100_000))
    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toEqual({ v: 1 })
    expect(result.current.error).toBeNull()
  })

  // Failure twin: a rejecting fetcher MUST keep data null (never leak the error into data) + surface it.
  it('keeps data null and sets error when the fetcher rejects', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('nope'))
    const { result } = renderHook(() => usePoll(fetcher, 100_000))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toBeNull()
    expect(result.current.error?.message).toBe('nope')
  })

  it('keeps the last-good data on a later poll failure (resilient live surface)', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ v: 'good' })
      .mockRejectedValueOnce(new Error('blip'))
    const { result } = renderHook(() => usePoll(fetcher, 100_000))
    await waitFor(() => expect(result.current.data).toEqual({ v: 'good' }))
    await act(async () => {
      result.current.refetch()
    })
    expect(result.current.data).toEqual({ v: 'good' }) // NOT blanked
    expect(result.current.error?.message).toBe('blip')
  })

  it('refetch forces an immediate re-fetch', async () => {
    const fetcher = vi.fn().mockResolvedValue({ v: 1 })
    const { result } = renderHook(() => usePoll(fetcher, 100_000))
    await waitFor(() => expect(result.current.data).toEqual({ v: 1 }))
    expect(fetcher).toHaveBeenCalledTimes(1)
    await act(async () => {
      result.current.refetch()
    })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('re-fetches on the interval', async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn().mockResolvedValue({ v: 1 })
    renderHook(() => usePoll(fetcher, 5000))
    expect(fetcher).toHaveBeenCalledTimes(1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    expect(fetcher).toHaveBeenCalledTimes(2)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    expect(fetcher).toHaveBeenCalledTimes(3)
  })
})
