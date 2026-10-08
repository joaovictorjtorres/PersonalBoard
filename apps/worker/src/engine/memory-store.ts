import { APPLIED_OPS_KEEP, type Layer, type TableObject } from '@mesa/shared'
import type { StoredMember, TableMeta, TableStore } from './store'

export class MemoryStore implements TableStore {
  private meta: TableMeta | null = null
  private layers: Layer[] = []
  private members = new Map<string, StoredMember>()
  private objects = new Map<string, TableObject>()
  private notes = new Map<string, string>()
  private applied = new Map<string, number>()
  private appliedOrder = new Map<string, string[]>()

  getMeta() { return this.meta }

  initTable(meta: TableMeta, layers: Layer[]) {
    this.meta = meta
    this.layers = layers.map((l) => ({ ...l }))
  }

  getLayers() { return [...this.layers].sort((a, b) => a.order - b.order) }
  putLayer(layer: Layer) { this.layers = [...this.layers.filter((l) => l.id !== layer.id), { ...layer }] }
  deleteLayer(id: string) { this.layers = this.layers.filter((l) => l.id !== id) }
  getMember(clientId: string) { return this.members.get(clientId) ?? null }
  upsertMember(member: StoredMember) { this.members.set(member.clientId, { ...member }) }
  deleteMember(clientId: string) { this.members.delete(clientId) }
  listMembers() { return [...this.members.values()] }
  getObject(id: string) { return this.objects.get(id) ?? null }
  listObjects() { return [...this.objects.values()] }
  putObject(object: TableObject) { this.objects.set(object.id, object) }
  deleteObject(id: string) { this.objects.delete(id) }
  listNotes() { return Object.fromEntries(this.notes) }

  setNote(objectId: string, text: string) {
    if (text === '') this.notes.delete(objectId)
    else this.notes.set(objectId, text)
  }

  deleteNote(objectId: string) { this.notes.delete(objectId) }

  getAppliedOp(clientId: string, opId: string) {
    return this.applied.get(`${clientId}:${opId}`) ?? null
  }

  recordAppliedOp(clientId: string, opId: string, version: number) {
    this.applied.set(`${clientId}:${opId}`, version)
    const order = this.appliedOrder.get(clientId) ?? []
    order.push(opId)
    while (order.length > APPLIED_OPS_KEEP) this.applied.delete(`${clientId}:${order.shift()}`)
    this.appliedOrder.set(clientId, order)
  }
}
