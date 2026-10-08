import { createContext, useContext } from 'react'
import { useStore } from 'zustand'
import type { TableActions, TableStore, TableStoreState } from './tableStore'

export const TableStoreContext = createContext<TableStore | null>(null)

export function useTableStore(): TableStore {
  const store = useContext(TableStoreContext)
  if (!store) throw new Error('TableStoreContext ausente')
  return store
}

// Selectors devem retornar valores estáveis (campos do estado), nunca arrays/objetos novos.
export function useTable<T>(selector: (s: TableStoreState) => T): T {
  return useStore(useTableStore(), selector)
}

export function useTableActions(): TableActions {
  return useTable((s) => s.actions)
}
