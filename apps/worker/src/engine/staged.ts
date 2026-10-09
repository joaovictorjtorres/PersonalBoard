import type { TableObject } from '@mesa/shared'

/** Onde create/update/delete leem e gravam objetos. */
export interface ObjectTx {
  get(id: string): TableObject | null
  put(object: TableObject): void
  /** Apaga o objeto e o que depende dele (anotação, trava). */
  remove(id: string): void
}

/** Cópia de trabalho de um lote: nada chega ao store até `commit()`. */
export class StagedObjects implements ObjectTx {
  private changes = new Map<string, TableObject | null>()

  constructor(private base: ObjectTx) {}

  get(id: string): TableObject | null {
    return this.changes.has(id) ? (this.changes.get(id) ?? null) : this.base.get(id)
  }

  put(object: TableObject): void {
    this.changes.set(object.id, object)
  }

  remove(id: string): void {
    this.changes.set(id, null)
  }

  /** Grava tudo de uma vez (escritas síncronas no mesmo evento do DO: atômicas). */
  commit(): void {
    for (const [id, object] of this.changes) {
      if (object) this.base.put(object)
      else this.base.remove(id)
    }
    this.changes.clear()
  }
}
