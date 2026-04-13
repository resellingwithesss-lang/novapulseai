/**
 * Backward-compatible exports. Prefer `globalErrorHandler` in `app.ts` and `HttpError` / `next(err)` in routes.
 */
import type { Request, Response, NextFunction } from "express"
import { AppError } from "../lib/http-error"
import { globalErrorHandler } from "./global-error-handler"

export { AppError }

export const errorHandler = (
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  globalErrorHandler(err, req, res, next)
}
