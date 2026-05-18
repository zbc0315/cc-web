export function newRunId(): string {
  return `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}
