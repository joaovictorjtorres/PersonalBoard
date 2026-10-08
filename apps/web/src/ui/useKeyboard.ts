import { useEffect } from 'react'
import { useTableStore } from '../store/context'

export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
}

export function useKeyboard(): void {
  const store = useTableStore()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return
      const { actions, selectedId } = store.getState()
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        actions.undo()
        return
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return
      switch (e.key.toLowerCase()) {
        case 'v': actions.setTool('select'); break
        case 'h': actions.setTool('hand'); break
        case 'p': actions.setPen('draw'); break
        case 'e': actions.setPen('erase'); break
        case 'r': actions.setTool('ruler'); break
        case 's': actions.setTool('shape'); break
        case 'escape': actions.rulerCancel(); break
        case 'delete':
        case 'backspace':
          if (selectedId) {
            actions.submit({ kind: 'delete', id: selectedId })
            actions.select(null)
          }
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [store])
}
