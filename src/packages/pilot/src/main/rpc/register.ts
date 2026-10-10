// Pilot's RPC methods join Orca's registry at startup, before any dispatcher is built. They aren't
// in the static catalog, so rpc-params-catalog.generated.ts never changes (D24).
type Named = { name: string; pilot?: boolean }
const registered = new WeakSet<object>()

export function registerPilotRpcMethods(target: unknown[], methods: readonly unknown[]): void {
  for (const raw of methods) {
    const method = raw as Named
    const existing = target.find((m) => (m as Named).name === method.name) as Named | undefined
    if (existing && registered.has(existing)) {
      continue
    }
    if (existing) {
      throw new Error(`Pilot RPC method ${method.name} collides with an existing method`)
    }
    registered.add(method as object)
    target.push(method)
  }
}
