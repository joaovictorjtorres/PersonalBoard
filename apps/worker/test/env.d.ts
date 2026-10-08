declare module 'cloudflare:test' {
  interface ProvidedEnv extends Env {}
  export function runInDurableObject<O extends DurableObject, R>(
    stub: DurableObjectStub,
    callback: (instance: O, state: DurableObjectState) => R | Promise<R>,
  ): Promise<R>
}
