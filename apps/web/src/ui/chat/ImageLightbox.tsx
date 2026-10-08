import { useRef } from 'react'
import { OverlayPortal } from '../OverlayPortal'
import { useDismiss } from '../useDismiss'

/** Imagem do chat em tamanho real; Esc ou clique fora da imagem fecha. */
export function ImageLightbox({ assetKey, onClose }: { assetKey: string; onClose: () => void }) {
  const ref = useRef<HTMLImageElement>(null)
  useDismiss(ref, onClose)
  return (
    <OverlayPortal>
    <div className="modal-backdrop lightbox" role="dialog" aria-label="Imagem em tamanho real">
      <img ref={ref} src={`/files/${assetKey}`} alt="Imagem do chat em tamanho real" />
    </div>
    </OverlayPortal>
  )
}
