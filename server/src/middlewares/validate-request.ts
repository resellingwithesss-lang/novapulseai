import type { Request, Response, NextFunction } from "express"
import type { ZodType } from "zod"
import type { output } from "zod"
import { HttpError } from "../lib/http-error"

/**
 * Validates `req.body` and replaces it with the parsed value (strips unknown keys per schema).
 * On failure calls `next(HttpError)` so the global handler returns a consistent envelope.
 */
export function validateBody<S extends ZodType>(schema: S) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      next(
        new HttpError(400, "Invalid request body", {
          code: "INVALID_INPUT",
          isOperational: true,
          details: parsed.error.flatten(),
        })
      )
      return
    }
    req.body = parsed.data as output<S>
    next()
  }
}

/**
 * Validates `req.query` and stores the result on `res.locals.validatedQuery`.
 */
export function validateQuery<S extends ZodType>(schema: S) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const parsed = schema.safeParse(req.query)
    if (!parsed.success) {
      next(
        new HttpError(400, "Invalid query parameters", {
          code: "INVALID_INPUT",
          isOperational: true,
          details: parsed.error.flatten(),
        })
      )
      return
    }
    res.locals.validatedQuery = parsed.data as output<S>
    next()
  }
}
