// server/src/app.ts

import express, { Request, Response, NextFunction } from "express"
import cors from "cors"
import helmet from "helmet"
import cookieParser from "cookie-parser"
import hpp from "hpp"
import morgan from "morgan"
import compression from "compression"
import crypto from "crypto"
import path from "path"

import authRoutes from "./modules/auth/auth.routes"
import emailRoutes from "./modules/email/email.routes"
import generationRoutes from "./modules/generation/generation.routes"
import adminRoutes from "./modules/admin/admin.routes"
import billingRoutes from "./modules/billing/billing.routes"
import billingManageRoutes from "./modules/billing/billing.manage.routes"
import webhookRoutes from "./modules/billing/webhook.routes"
import storyMakerRoutes from "./modules/story-maker/story-maker.routes"
import adsRoutes from "./modules/ads/ads.routes"
import { resolveRequestId, toolFail } from "./lib/tool-response"

/* NEW */
import clipRoutes from "./modules/clip/clip.routes"
import activityRoutes from "./modules/activity/activity.routes"
import workflowRoutes from "./modules/workflow/workflow.routes"
import workspacesRoutes from "./modules/workspaces/workspaces.routes"
import brandVoicesRoutes from "./modules/brand-voices/brand-voices.routes"
import contentPacksRoutes from "./modules/content-packs/content-packs.routes"
import settingsRoutes from "./modules/settings/settings.routes"
import referralRoutes from "./modules/referrals/referral.routes"
import marketingRoutes from "./modules/marketing/marketing.routes"
import { prisma } from "./lib/prisma"
import { createCorsOptions } from "./lib/cors-allowlist"
import { createToolLimiter, globalApiLimiter } from "./middlewares/rate-limits"
import { limitMethods } from "./middlewares/method-scoped-limiter"
import { globalErrorHandler } from "./middlewares/global-error-handler"
import { requestLoggingMiddleware } from "./middlewares/request-logging"

const app = express()

const isProduction = process.env.NODE_ENV === "production"

/** Extra cap on expensive media writes (GET polling uses global limiter only). */
const heavyToolLimiter = createToolLimiter(
  Number(process.env.HEAVY_TOOL_RATE_LIMIT_MAX ?? "90")
)
const heavyToolLimiterPosts = limitMethods(
  heavyToolLimiter,
  new Set(["POST", "PUT", "PATCH", "DELETE"])
)

/* =====================================================
   TRUST PROXY (one hop: Next rewrites, CDN, or LB)
===================================================== */

// Next.js dev/prod rewrites forward X-Forwarded-For. express-rate-limit v8 runs
// validations in keyGenerator and throws if trust proxy is false while that header
// is set. Production previously set this only in prod — dev then broke /api/auth/*.
const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS ?? "1")
app.set(
  "trust proxy",
  Number.isFinite(trustProxyHops) && trustProxyHops >= 0 ? trustProxyHops : 1
)

app.disable("x-powered-by")

/* =====================================================
   REQUEST ID
===================================================== */

app.use((req: Request, res: Response, next: NextFunction) => {
  const incoming = req.headers["x-request-id"]

  const requestId =
    typeof incoming === "string" && incoming.trim()
      ? incoming.trim()
      : crypto.randomUUID()

  req.requestId = requestId

  res.setHeader("X-Request-Id", requestId)

  next()
})

app.use(requestLoggingMiddleware)

/* =====================================================
   SECURITY
===================================================== */

app.use(
  helmet({
    crossOriginOpenerPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: false,
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
  })
)

app.use(compression())
app.use(hpp())
app.use(cookieParser())

if (!isProduction) {
  app.use(morgan("dev"))
}

/* =====================================================
   CORS
===================================================== */

const corsOptions = createCorsOptions(isProduction)
app.use(cors(corsOptions))
app.options("*", cors(corsOptions))

/* =====================================================
   STRIPE WEBHOOK (RAW BODY FIRST)
===================================================== */

app.use(
  "/api/billing/webhook",
  express.raw({ type: "application/json" }),
  webhookRoutes
)

/* =====================================================
   BODY PARSERS
===================================================== */

const jsonBodyLimit = process.env.JSON_BODY_LIMIT?.trim() || "2mb"
app.use(express.json({ limit: jsonBodyLimit }))
app.use(express.urlencoded({ extended: false, limit: jsonBodyLimit }))

/* =====================================================
   RATE LIMIT
===================================================== */

app.use(globalApiLimiter)

/* =====================================================
   STATIC FILES (CLIPS + GENERATED MEDIA)
===================================================== */

app.use(
  "/clips",
  express.static(path.join(process.cwd(), "clips"), {
    maxAge: "7d",
    etag: true,
    index: false,
    setHeaders: (res) => {
      res.setHeader("Access-Control-Allow-Origin", "*")
      res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin")
    },
  })
)

app.use(
  "/generated",
  express.static(path.join(process.cwd(), "generated"), {
    maxAge: "7d",
    etag: true,
    index: false,
    setHeaders: (res) => {
      res.setHeader("Access-Control-Allow-Origin", "*")
      res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin")
    },
  })
)

/* =====================================================
   HEALTH CHECK
===================================================== */

app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({
    status: "ok",
    uptime: process.uptime(),
    timestamp: Date.now(),
    environment: process.env.NODE_ENV || "development",
    revision:
      process.env.K_REVISION ||
      process.env.RENDER_GIT_COMMIT ||
      process.env.FLY_ALLOC_ID ||
      process.env.RAILWAY_GIT_COMMIT_SHA ||
      process.env.GIT_REVISION ||
      null,
  })
})

/**
 * Readiness: verifies PostgreSQL connectivity (use for load balancers / orchestrators).
 * Liveness should use GET /health (no DB).
 */
app.get("/readyz", async (_req: Request, res: Response) => {
  try {
    await prisma.$queryRaw`SELECT 1 AS "ok"`
    return res.status(200).json({
      ok: true,
      checks: { database: "up" },
      timestamp: Date.now(),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "database_unavailable"
    return res.status(503).json({
      ok: false,
      checks: { database: "down" },
      message,
      timestamp: Date.now(),
    })
  }
})

/* =====================================================
   API ROUTES
===================================================== */

app.use("/api/auth", authRoutes)
app.use("/api/email", emailRoutes)
app.use("/api/marketing", marketingRoutes)
app.use("/api/settings", settingsRoutes)
app.use("/api/referrals", referralRoutes)
app.use("/api/activity", activityRoutes)
app.use("/api/workflow", workflowRoutes)
app.use("/api/workspaces", workspacesRoutes)
app.use("/api/brand-voices", brandVoicesRoutes)
app.use("/api/content-packs", contentPacksRoutes)
app.use("/api/generation", generationRoutes)
app.use("/api/story-maker", storyMakerRoutes)
app.use("/api/admin", adminRoutes)
app.use("/api/ads", heavyToolLimiterPosts, adsRoutes)
app.use("/api/billing", billingRoutes)
app.use("/api/billing", billingManageRoutes)

/* NEW CLIPPER ENGINE ROUTE */

app.use("/api/clip", heavyToolLimiterPosts, clipRoutes)

/* =====================================================
   404
===================================================== */

app.use((req: Request, res: Response) => {
  return toolFail(res, 404, "Route not found", {
    requestId: resolveRequestId(req),
    stage: "failed",
    status: "failed",
    code: "NOT_FOUND",
    path: req.originalUrl,
  })
})

/* =====================================================
   GLOBAL ERROR HANDLER
===================================================== */

app.use(globalErrorHandler)

export default app
