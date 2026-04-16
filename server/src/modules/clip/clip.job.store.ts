import { mkdir, readFile, readdir, rename, unlink, writeFile } from "fs/promises"
import path from "path"
import type { ClipJobRecord } from "./clip.job.types"

const JOBS_DIR = path.join(process.cwd(), "tmp", "clip-jobs")
const JOB_TTL_MS = 48 * 60 * 60 * 1000

function jobPath(jobId: string) {
  return path.join(JOBS_DIR, `${jobId}.json`)
}

export async function ensureJobsDir() {
  await mkdir(JOBS_DIR, { recursive: true })
}

export async function saveJob(record: ClipJobRecord): Promise<void> {
  await ensureJobsDir()
  record.updatedAt = Date.now()
  const target = jobPath(record.jobId)
  const tmp = `${target}.${process.pid}.tmp`
  const payload = JSON.stringify(record, null, 0)
  await writeFile(tmp, payload, "utf8")
  await rename(tmp, target)
}

export async function loadJob(jobId: string): Promise<ClipJobRecord | null> {
  try {
    const raw = await readFile(jobPath(jobId), "utf8")
    const rec = JSON.parse(raw) as ClipJobRecord
    if (!rec?.jobId || rec.jobId !== jobId) return null
    if (Date.now() - rec.updatedAt > JOB_TTL_MS && rec.status !== "completed") {
      return null
    }
    return rec
  } catch {
    return null
  }
}

export async function pruneStaleJobs(): Promise<void> {
  try {
    const names = await readdir(JOBS_DIR)
    const now = Date.now()
    for (const name of names) {
      if (!name.endsWith(".json")) continue
      const fp = path.join(JOBS_DIR, name)
      try {
        const raw = await readFile(fp, "utf8")
        const rec = JSON.parse(raw) as ClipJobRecord
        if (now - (rec.updatedAt || 0) > JOB_TTL_MS) {
          await unlink(fp).catch(() => {})
        }
      } catch {
        /* skip */
      }
    }
  } catch {
    /* dir missing */
  }
}

export async function listRecoverableJobIds(): Promise<string[]> {
  try {
    const names = await readdir(JOBS_DIR)
    const ids: string[] = []
    for (const name of names) {
      if (!name.endsWith(".json")) continue
      const fp = path.join(JOBS_DIR, name)
      try {
        const raw = await readFile(fp, "utf8")
        const rec = JSON.parse(raw) as ClipJobRecord
        if (
          rec?.jobId &&
          (rec.status === "queued" ||
            rec.status === "ingesting" ||
            rec.status === "analyzing" ||
            rec.status === "selecting_moments" ||
            rec.status === "trimming" ||
            rec.status === "captioning" ||
            rec.status === "finalizing")
        ) {
          ids.push(rec.jobId)
        }
      } catch {
        // Ignore malformed records here; prune handles age cleanup separately.
      }
    }
    return ids
  } catch {
    return []
  }
}

export function toPublicJobView(rec: ClipJobRecord): Omit<ClipJobRecord, "sourceVideoPath"> {
  const { sourceVideoPath: _s, ...rest } = rec
  return rest
}
