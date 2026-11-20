export interface TableColumn {
  key: string
  label: string
  /** The sort value sent to the API for this column; `true` uses the key. */
  sort?: string | true
  align?: 'left' | 'right' | 'center'
  /** Stays in view while the table scrolls sideways (on wider screens). Use on one column. */
  sticky?: boolean
  /** Extra classes for this column's cells, such as a width. */
  class?: string
}

/** Clicking a heading sorts by it; clicking again reverses the order. */
export function nextSort(current: string, field: string): string {
  return current === field ? `-${field}` : field
}

export function sortState(current: string, field: string): 'ascending' | 'descending' | 'none' {
  if (current === field) return 'ascending'
  if (current === `-${field}`) return 'descending'
  return 'none'
}

type SortValue = string | number | null | undefined

/**
 * Sorts a list that is already fully loaded (short lists such as users).
 * Text compares naturally ("PO 2" before "PO 10"); empty values go last.
 */
export function sortLocal<T>(
  rows: readonly T[],
  sort: string,
  values: Record<string, (row: T) => SortValue>,
): T[] {
  const desc = sort.startsWith('-')
  const get = values[desc ? sort.slice(1) : sort]
  if (!get) return [...rows]
  const text = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
  return [...rows].sort((a, b) => {
    const x = get(a)
    const y = get(b)
    const xEmpty = x === null || x === undefined || x === ''
    const yEmpty = y === null || y === undefined || y === ''
    if (xEmpty || yEmpty) return xEmpty === yEmpty ? 0 : xEmpty ? 1 : -1
    const c =
      typeof x === 'number' && typeof y === 'number' ? x - y : text.compare(String(x), String(y))
    return desc ? -c : c
  })
}
