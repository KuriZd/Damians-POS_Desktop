// src/renderer/src/hooks/useBarcodeScanner.ts
import { useEffect, useLayoutEffect, useRef } from 'react'

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable
}

export function useBarcodeScanner(onScan: (code: string) => void): void {
  const bufferRef = useRef<string>('')
  const timerRef = useRef<number | null>(null)
  const onScanRef = useRef(onScan)

  useLayoutEffect(() => {
    onScanRef.current = onScan
  })

  useEffect((): (() => void) => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // Ignore keystrokes coming from inputs, textareas, or contenteditable elements
      if (isInteractiveTarget(event.target)) return

      if (event.key === 'Enter') {
        const code = bufferRef.current.trim()
        bufferRef.current = ''

        if (timerRef.current !== null) {
          window.clearTimeout(timerRef.current)
          timerRef.current = null
        }

        if (code.length > 0) onScanRef.current(code)
        return
      }

      if (event.key.length === 1) {
        bufferRef.current += event.key
      }

      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current)
      }

      timerRef.current = window.setTimeout((): void => {
        bufferRef.current = ''
        timerRef.current = null
      }, 100)
    }

    window.addEventListener('keydown', onKeyDown)
    return (): void => window.removeEventListener('keydown', onKeyDown)
  }, []) // onScanRef handles latest callback without re-subscribing
}
