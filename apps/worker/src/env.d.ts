// Variáveis passadas pelo `wrangler dev --var` (não estão no wrangler.jsonc, então o `wrangler types` não as gera).
interface Env {
  /** `pnpm host` (0.0.0.0: rede/VPN): o filtro de pedido local não é confiável, então não há lista de mesas. */
  MESA_EXPOSED?: string
}
