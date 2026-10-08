export interface Throttled<A extends unknown[]> {
  (...args: A): void
  flush(): void
  cancel(): void
}

export function throttle<A extends unknown[]>(fn: (...args: A) => void, ms: number): Throttled<A> {
  let last = -Infinity
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending: A | null = null

  const invoke = () => {
    timer = null
    last = Date.now()
    const args = pending!
    pending = null
    fn(...args)
  }

  const throttled = ((...args: A) => {
    pending = args
    const wait = ms - (Date.now() - last)
    if (wait <= 0) {
      if (timer) clearTimeout(timer)
      invoke()
    } else if (!timer) {
      timer = setTimeout(invoke, wait)
    }
  }) as Throttled<A>

  throttled.flush = () => {
    if (!pending) return
    if (timer) clearTimeout(timer)
    invoke()
  }

  throttled.cancel = () => {
    if (timer) clearTimeout(timer)
    timer = null
    pending = null
  }

  return throttled
}
