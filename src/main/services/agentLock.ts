/** Serialize (or optionally reject) agent runs on the same project key. */

const tails = new Map<string, Promise<unknown>>()
const busy = new Set<string>()

export function isProjectBusy(projectKey: string): boolean {
  return busy.has(projectKey || '__default__')
}

export async function withProjectLock<T>(
  projectKey: string,
  fn: () => Promise<T>,
  opts?: { rejectIfBusy?: boolean }
): Promise<T> {
  const key = projectKey || '__default__'
  if (opts?.rejectIfBusy && busy.has(key)) {
    throw new Error(`Another agent run is already active on ${key}`)
  }
  const prev = tails.get(key) || Promise.resolve()
  const run = prev.catch(() => undefined).then(async () => {
    busy.add(key)
    try {
      return await fn()
    } finally {
      busy.delete(key)
    }
  })
  tails.set(
    key,
    run.then(
      () => undefined,
      () => undefined
    )
  )
  return run
}
