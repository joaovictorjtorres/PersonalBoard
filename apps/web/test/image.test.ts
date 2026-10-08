import { describe, expect, it } from 'vitest'
import { fitWithin, initialSize, uploadErrorText, viewportCenter } from '../src/lib/image'

describe('fitWithin', () => {
  it('reduz mantendo proporção', () => {
    expect(fitWithin(8000, 4000, 4096)).toEqual({ width: 4096, height: 2048 })
  })
  it('não amplia imagens pequenas', () => {
    expect(fitWithin(100, 50, 4096)).toEqual({ width: 100, height: 50 })
  })
})

describe('initialSize', () => {
  it('mapa mantém tamanho original', () => {
    expect(initialSize('map', 800, 600)).toEqual({ width: 800, height: 600 })
  })
  it('token tem maior lado = 70', () => {
    expect(initialSize('tokens', 140, 70)).toEqual({ width: 70, height: 35 })
    expect(initialSize('gm', 10, 20)).toEqual({ width: 35, height: 70 })
  })
})

describe('viewportCenter', () => {
  it('converte centro da tela para mundo', () => {
    expect(viewportCenter({ x: 100, y: 50, scale: 2 }, 1000, 600)).toEqual({ x: 200, y: 125 })
  })
})

describe('uploadErrorText', () => {
  it('413 vira mensagem de tamanho sem retry', () => {
    expect(uploadErrorText(new Error('upload_failed_413'))).toEqual({ text: 'Imagem grande demais (máx. 10 MB)', retry: false })
  })
  it('outros erros permitem tentar novamente', () => {
    expect(uploadErrorText(new Error('upload_failed_500'))).toEqual({ text: 'Falha ao enviar a imagem', retry: true })
  })
})
