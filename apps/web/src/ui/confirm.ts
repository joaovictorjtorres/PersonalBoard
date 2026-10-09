import { createStore } from 'zustand/vanilla'

export interface ConfirmOptions {
  title: string
  message: string
  /** Texto do botão de confirmar; padrão "Confirmar". */
  confirmLabel?: string
  /** Ação destrutiva: o botão de confirmar fica vermelho. */
  danger?: boolean
  /** Terceiro botão, entre Cancelar e Confirmar (resposta 'alternative' no askChoice). */
  alternativeLabel?: string
  /** O botão alternativo é destrutivo (vermelho). */
  alternativeDanger?: boolean
}

export type ConfirmAnswer = 'confirm' | 'alternative' | 'cancel'

export interface ConfirmRequest extends ConfirmOptions {
  id: number
  resolve: (answer: ConfirmAnswer) => void
}

let seq = 0

/** Um pedido por vez; o modal (ConfirmHost) lê daqui. Substitui os diálogos nativos do navegador. */
export const confirmStore = createStore<{ request: ConfirmRequest | null }>(() => ({ request: null }))

/** Aviso com até três botões; resolve 'cancel' em Cancelar/Esc/clique fora. */
export function askChoice(options: ConfirmOptions): Promise<ConfirmAnswer> {
  return new Promise((resolve) => {
    // um aviso novo cancela o anterior (não ficam promessas penduradas)
    confirmStore.getState().request?.resolve('cancel')
    confirmStore.setState({ request: { ...options, id: ++seq, resolve } })
  })
}

/** Abre o aviso de confirmação do app; resolve true em Confirmar, false em Cancelar/Esc/clique fora. */
export function askConfirm(options: ConfirmOptions): Promise<boolean> {
  return askChoice(options).then((answer) => answer === 'confirm')
}

export function settleConfirm(answer: boolean | 'alternative'): void {
  const request = confirmStore.getState().request
  if (!request) return
  confirmStore.setState({ request: null })
  request.resolve(answer === 'alternative' ? 'alternative' : answer ? 'confirm' : 'cancel')
}

/** Esc cancela; Enter confirma, a menos que o foco esteja em Cancelar. */
export function confirmKeyAction(key: string, focusOnCancel: boolean): 'confirm' | 'cancel' | null {
  if (key === 'Escape') return 'cancel'
  if (key === 'Enter') return focusOnCancel ? 'cancel' : 'confirm'
  return null
}

/** "1 desenho", "3 desenhos". */
export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}
