import { useEffect, useRef, useState } from 'react'

export function useAutoLock(enabled: boolean, minutes: number, onLock: () => void): boolean {
  const callbackRef = useRef(onLock)
  const [warning, setWarning] = useState(false)
  useEffect(() => {
    callbackRef.current = onLock
  }, [onLock])

  useEffect(() => {
    if (!enabled) {
      setWarning(false)
      return undefined
    }
    const timeout = Math.max(minutes * 60 * 1000, 60_000)
    let lockTimer: number | undefined
    let warningTimer: number | undefined
    let lastActivity = 0
    const reset = () => {
      const current = Date.now()
      if (current - lastActivity < 750) return
      lastActivity = current
      window.clearTimeout(lockTimer)
      window.clearTimeout(warningTimer)
      setWarning(false)
      warningTimer = window.setTimeout(() => setWarning(true), Math.max(timeout - 60_000, 1_000))
      lockTimer = window.setTimeout(() => callbackRef.current(), timeout)
    }
    const events: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'touchstart', 'scroll']
    events.forEach((event) => window.addEventListener(event, reset, { passive: true }))
    reset()
    return () => {
      events.forEach((event) => window.removeEventListener(event, reset))
      window.clearTimeout(lockTimer)
      window.clearTimeout(warningTimer)
    }
  }, [enabled, minutes])

  return warning
}
