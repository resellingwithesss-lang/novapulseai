export {}

declare global {
  namespace Express {
    interface Request {
      /** Set by middleware in `app.ts` for every request. */
      requestId: string
    }

    interface Locals {
      /** Set by `validateQuery` middleware when used. */
      validatedQuery?: unknown
    }
  }
}
