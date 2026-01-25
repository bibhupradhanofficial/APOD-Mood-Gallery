import { useEffect, useState } from 'react'

export function useDebouncedValue(value, delayMs = 180) {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), Math.max(0, Number(delayMs) || 0))
    return () => clearTimeout(id)
  }, [delayMs, value])

  return debounced
}

