import { NextFunction, Request, Response, Router } from "express"
import multer from "multer"
import path from "path"
import { mkdir } from "fs/promises"
import { createClipJob, getClipJobStatus } from "./clip.controller"
import { requireAuth } from "../auth/auth.middleware"
import { resolveRequestId, toolFail } from "../../lib/tool-response"

const router = Router()

const uploadDir = path.join(process.cwd(), "tmp", "clip-uploads")

const storage = multer.diskStorage({
  destination: async (_req, _file, cb) => {
    try {
      await mkdir(uploadDir, { recursive: true })
      cb(null, uploadDir)
    } catch (e) {
      cb(e as Error, uploadDir)
    }
  },
  filename: (_req, file, cb) => {
    const safe =
      `${Date.now()}_${Math.random().toString(36).slice(2, 10)}` +
      path.extname(file.originalname || ".mp4")
    cb(null, safe)
  },
})

const upload = multer({
  storage,
  limits: {
    fileSize: 512 * 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("video/")) {
      cb(null, true)
      return
    }
    const ext = path.extname(file.originalname || "").toLowerCase()
    if (
      [".mp4", ".mov", ".webm", ".mkv", ".avi", ".m4v"].includes(ext)
    ) {
      cb(null, true)
      return
    }
    cb(new Error("Only video uploads are supported (mp4, mov, webm, mkv, …)"))
  },
})

router.post("/create", requireAuth, upload.single("video"), createClipJob)
router.get("/jobs/:jobId", requireAuth, getClipJobStatus)

router.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
  if (!err) return next()
  const requestId = resolveRequestId(req)
  return toolFail(
    res,
    400,
    err instanceof Error ? err.message : "Invalid upload payload",
    {
      requestId,
      stage: "validate",
      status: "failed",
      code: "INVALID_INPUT",
    }
  )
})

export default router
