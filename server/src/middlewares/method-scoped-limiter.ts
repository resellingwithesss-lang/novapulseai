import type { RequestHandler } from "express"

/**
 * Applies an existing rate-limit middleware only to given HTTP methods.
 * Use this so GET polling (job status, etc.) is not capped by the same budget as POST /generate.
 */
export function limitMethods(
  limiter: RequestHandler,
  methods: ReadonlySet<string>
): RequestHandler {
  return (req, res, next) => {
    if (!methods.has(req.method)) {
      next()
      return
    }
    limiter(req, res, next)
  }
}
