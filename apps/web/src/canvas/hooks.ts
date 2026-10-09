import { useEffect, useState } from 'react'
import type { TableObject } from '@mesa/shared'
import { useTable } from '../store/context'
import { isLockedByOther } from '../store/reducers'
import { isTypingTarget } from '../ui/useKeyboard'

export function useModifierKeys(): { space: boolean; shift: boolean } {
  const [space, setSpace] = useState(false)
  const [shift, setShift] = useState(false)
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setShift(true)
      if (e.code === 'Space' && !isTypingTarget(e.target)) {
        e.preventDefault()
        setSpace(true)
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setShift(false)
      if (e.code === 'Space') setSpace(false)
    }
    const reset = () => {
      setSpace(false)
      setShift(false)
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', reset)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', reset)
    }
  }, [])
  return { space, shift }
}

export function useWindowSize(): { width: number; height: number } {
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight })
  useEffect(() => {
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return size
}

export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

/** Date.now() a cada quadro enquanto `active`; parado quando não há animação. */
export function useFrameClock(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    let frame = requestAnimationFrame(function tick() {
      setNow(Date.now())
      frame = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(frame)
  }, [active])
  return now
}

/**
 * Geometria ao vivo do objeto: acompanha o meu arrasto/redimensionamento a cada movimento
 * e o de quem trava o objeto; fora disso, o próprio objeto.
 */
export function useLiveGeometry<T extends TableObject>(object: T): T {
  const lockedByOther = useTable((s) => isLockedByOther(s, object.id, Date.now()))
  const preview = useTable((s) => s.dragPreviews[object.id])
  const own = useTable((s) => s.ownDragPreviews[object.id])
  return (own ?? (lockedByOther && preview ? preview : object)) as T
}
