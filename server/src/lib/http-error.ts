import { Prisma } from "@prisma/client"
import type { ZodError } from "zod"
import type { ToolErrorCode } from "./tool-response"

/**
 * Typed HTTP error for `next(err)` and centralized handling.
 * Keeps responses consistent with `toolFail` (success/message/code/requestId/stage/status).
 */
export class HttpError extends Error {
  readonly statusCode: number
  readonly code: ToolErrorCode
  readonly isOperational: boolean
  /** Optional structured detail (Zod flatten, etc.). Omitted in production responses when sensitive. */
  readonly details?: unknown

  constructor(
    statusCode: number,
    message: string,
    options?: {
      code?: ToolErrorCode
      isOperational?: boolean
      details?: unknown
    }
  ) {
    super(message)
    this.name = "HttpError"
    this.statusCode = statusCode
    this.code = options?.code ?? "INTERNAL_ERROR"
    this.isOperational = options?.isOperational ?? true
    this.details = options?.details
  }
}

/** Legacy helper — same shape as previous `AppError` in error.middleware.ts */
export class AppError extends HttpError {
  constructor(message: string, statusCode = 500) {
    super(statusCode, message, {
      code: "INTERNAL_ERROR",
      isOperational: true,
    })
    this.name = "AppError"
  }
}

export function isHttpError(err: unknown): err is HttpError {
  return err instanceof HttpError
}

function mapGenerationAccountingToToolCode(
  code: string
): ToolErrorCode | undefined {
  switch (code) {
    case "ACCOUNT_SUSPENDED":
    case "SUBSCRIPTION_REQUIRED":
    case "TRIAL_EXPIRED":
    case "INSUFFICIENT_CREDITS":
      return "FORBIDDEN"
    case "USER_NOT_FOUND":
      return "NOT_FOUND"
    case "COOLDOWN_ACTIVE":
      return "RETRY_LATER"
    default:
      return undefined
  }
}

/**
 * Normalize any thrown value into an HttpError for logging + response mapping.
 */
function isGenerationAccountingLike(
  err: unknown
): err is { status: number; message: string; code: string } {
  if (!err || typeof err !== "object") return false
  const o = err as Record<string, unknown>
  return (
    typeof o.status === "number" &&
    typeof o.message === "string" &&
    typeof o.code === "string" &&
    (err as Error).name === "GenerationAccountingError"
  )
}

export function normalizeHttpError(err: unknown): HttpError {
  if (isHttpError(err)) return err

  if (isGenerationAccountingLike(err)) {
    const code =
      mapGenerationAccountingToToolCode(err.code) ?? "FORBIDDEN"
    return new HttpError(err.status, err.message, {
      code,
      isOperational: true,
    })
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    switch (err.code) {
      case "P2002":
        return new HttpError(409, "A record with this value already exists.", {
          code: "INVALID_INPUT",
          isOperational: true,
        })
      case "P2021":
      case "P2022": {
        const meta = err.meta as Record<string, unknown> | undefined
        const column = typeof meta?.column === "string" ? meta.column : undefined
        const modelName = typeof meta?.modelName === "string" ? meta.modelName : undefined
        const table = typeof meta?.table === "string" ? meta.table : undefined
        const detail =
          err.code === "P2021"
            ? modelName ?? table ?? "unknown table"
            : column ?? "unknown column"
        return new HttpError(
          503,
          `Database schema not migrated (${detail}). From the server folder run: npx prisma migrate deploy — then restart the API.`,
          {
            code: "DATABASE_SCHEMA_MIGRATION_REQUIRED",
            isOperational: true,
            details: { prismaCode: err.code, meta },
          }
        )
      }
      case "P2025":
        return new HttpError(404, "Record not found.", {
          code: "NOT_FOUND",
          isOperational: true,
        })
      case "P2003":
        return new HttpError(400, "Invalid reference.", {
          code: "INVALID_INPUT",
          isOperational: true,
        })
      default:
        return new HttpError(500, "Database error.", {
          code: "INTERNAL_ERROR",
          isOperational: true,
        })
    }
  }

  if (err instanceof Prisma.PrismaClientValidationError) {
    return new HttpError(400, "Invalid data.", {
      code: "INVALID_INPUT",
      isOperational: true,
    })
  }

  /* Zod v4 — duck-type to avoid tight coupling */
  if (
    err &&
    typeof err === "object" &&
    (err as ZodError).name === "ZodError" &&
    Array.isArray((err as ZodError).issues)
  ) {
    const z = err as ZodError
    return new HttpError(400, "Invalid request", {
      code: "INVALID_INPUT",
      isOperational: true,
      details: z.flatten?.() ?? z.issues,
    })
  }

  const legacy = err as { statusCode?: number; status?: number; message?: string }
  const status =
    typeof legacy?.statusCode === "number"
      ? legacy.statusCode
      : typeof legacy?.status === "number"
        ? legacy.status
        : 500

  if (err instanceof Error) {
    const operational = status < 500
    return new HttpError(status, err.message, {
      code: operational ? "INVALID_INPUT" : "INTERNAL_ERROR",
      isOperational: operational,
    })
  }

  return new HttpError(500, "Internal server error", {
    code: "INTERNAL_ERROR",
    isOperational: false,
  })
}
