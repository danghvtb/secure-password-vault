import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAutoLock } from './useAutoLock'

describe('useAutoLock', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('locks after the configured inactivity period', () => {
    vi.useFakeTimers()
    const onLock = vi.fn()
    renderHook(() => useAutoLock(true, 1, onLock))

    act(() => vi.advanceTimersByTime(59_999))
    expect(onLock).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(onLock).toHaveBeenCalledOnce()
  })

  it('resets the lock deadline after meaningful activity', () => {
    vi.useFakeTimers()
    const onLock = vi.fn()
    renderHook(() => useAutoLock(true, 1, onLock))

    act(() => vi.advanceTimersByTime(1_000))
    act(() => window.dispatchEvent(new Event('pointerdown')))
    act(() => vi.advanceTimersByTime(59_999))
    expect(onLock).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(onLock).toHaveBeenCalledOnce()
  })

  it('does not schedule a lock while disabled', () => {
    vi.useFakeTimers()
    const onLock = vi.fn()
    renderHook(() => useAutoLock(false, 1, onLock))
    act(() => vi.advanceTimersByTime(120_000))
    expect(onLock).not.toHaveBeenCalled()
  })
})
