export function formatBillingCheckoutError(error: unknown): string {
  if (error instanceof Error && error.message?.trim()) {
    return error.message
  }
  return "Something went wrong. Please try again."
}
