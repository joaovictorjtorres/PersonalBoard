import { describe, expect, it } from 'vitest'
import { memberMenuOptions, memberPatch } from '../src/ui/memberMenuOptions'

describe('memberMenuOptions', () => {
  it('conversa privada com qualquer outro; edição só para o mestre (inclusive de si mesmo)', () => {
    expect(memberMenuOptions('b', 'a', false)).toEqual({ dm: true, edit: false })
    expect(memberMenuOptions('a', 'a', false)).toEqual({ dm: false, edit: false })
    expect(memberMenuOptions('b', 'g', true)).toEqual({ dm: true, edit: true })
    expect(memberMenuOptions('g', 'g', true)).toEqual({ dm: false, edit: true })
  })
})

describe('memberPatch', () => {
  const ana = { nickname: 'Ana', color: '#3cb44b' }

  it('só manda o que mudou, com o apelido aparado', () => {
    expect(memberPatch(ana, '  Aninha  ', '#3cb44b')).toEqual({ nickname: 'Aninha' })
    expect(memberPatch(ana, 'Ana', '#123456')).toEqual({ color: '#123456' })
    expect(memberPatch(ana, 'Bia', '#123456')).toEqual({ nickname: 'Bia', color: '#123456' })
  })

  it('nada mudou, apelido vazio ou cor inválida: nada a enviar', () => {
    expect(memberPatch(ana, 'Ana', '#3CB44B')).toBeNull()
    expect(memberPatch(ana, '   ', '#3cb44b')).toBeNull()
    expect(memberPatch(ana, 'Ana', 'red')).toBeNull()
  })

  it('apelido maior que 32 é cortado', () => {
    expect(memberPatch(ana, 'x'.repeat(40), '#3cb44b')).toEqual({ nickname: 'x'.repeat(32) })
  })
})
