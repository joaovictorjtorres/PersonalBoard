import { MAX_IMAGE_SIDE, TOKEN_INITIAL_SIDE } from '@mesa/shared'
import type { Viewport } from '../store/state'

export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  const k = Math.min(1, max / Math.max(width, height))
  return { width: Math.round(width * k), height: Math.round(height * k) }
}

export function initialSize(layerId: string, width: number, height: number): { width: number; height: number } {
  if (layerId === 'map') return { width, height }
  const k = TOKEN_INITIAL_SIDE / Math.max(width, height)
  return { width: width * k, height: height * k }
}

export function viewportCenter(v: Viewport, screenW: number, screenH: number): { x: number; y: number } {
  return { x: (screenW / 2 - v.x) / v.scale, y: (screenH / 2 - v.y) / v.scale }
}

// Redimensiona e converte para WebP no navegador. Se o navegador não codificar WebP,
// toBlob devolve PNG — o servidor aceita os dois.
export async function prepareImage(file: Blob): Promise<{ blob: Blob; width: number; height: number }> {
  const bitmap = await createImageBitmap(file)
  const { width, height } = fitWithin(bitmap.width, bitmap.height, MAX_IMAGE_SIDE)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  const encode = (type: string) =>
    new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode_failed'))), type, 0.85),
    )
  let blob = await encode('image/webp')
  // Navegadores sem WebP devolvem PNG (pode passar de 10 MB): reencoda como JPEG.
  if (blob.type !== 'image/webp') blob = await encode('image/jpeg')
  return { blob, width, height }
}

export function uploadErrorText(err: unknown): { text: string; retry: boolean } {
  if (err instanceof Error && err.message === 'upload_failed_413') {
    return { text: 'Imagem grande demais (máx. 10 MB)', retry: false }
  }
  return { text: 'Falha ao enviar a imagem', retry: true }
}
