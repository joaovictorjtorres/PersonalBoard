import { describe, expect, it } from 'vitest'
import { ArgError, parseArgs } from '../src/args.mjs'

describe('parseArgs', () => {
  it('padrões', () => {
    expect(parseArgs([])).toEqual({ smoke: false, noUpdate: false, applyUpdate: false, port: undefined, root: undefined })
  })

  it('flags e valores (separados ou com =)', () => {
    expect(parseArgs(['--smoke', '--port', '18787', '--root', 'C:\\Mesa Virtual\\.'])).toEqual({
      smoke: true, noUpdate: false, applyUpdate: false, port: 18787, root: 'C:\\Mesa Virtual\\.',
    })
    expect(parseArgs(['--no-update', '--port=8790', '--apply-update'])).toMatchObject({
      noUpdate: true, port: 8790, applyUpdate: true,
    })
  })

  it('erros claros', () => {
    expect(() => parseArgs(['--port'])).toThrow(ArgError)
    expect(() => parseArgs(['--port', 'abc'])).toThrow('porta inválida: abc')
    expect(() => parseArgs(['--port', '70000'])).toThrow('porta inválida')
    expect(() => parseArgs(['--root'])).toThrow('--root precisa de um valor')
    expect(() => parseArgs(['--turbo'])).toThrow('opção desconhecida: --turbo')
  })
})
