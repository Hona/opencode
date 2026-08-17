export function executeFailed(value: unknown) {
  if (!Array.isArray(value)) return false
  return value.some(
    (call) =>
      call !== null && typeof call === "object" && !Array.isArray(call) && "status" in call && call.status === "error",
  )
}
