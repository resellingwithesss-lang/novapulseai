"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import dynamic from "next/dynamic"
import { useRouter } from "next/navigation"
import { api, LONG_REQUEST_TIMEOUT_MS } from "@/lib/api"
import { normalizeToolOperation } from "@/lib/tool-operation"
import { useAdsJobPolling } from "@/hooks/useAdsJobPolling"
import AdsAdminJobsList from "./_components/AdsAdminJobsList"

/* ====================================================== */

type GenerateResponse = {
  success: boolean
  jobId: string
}

/* ====================================================== */

const AdsJobReviewPanel = dynamic(
  () => import("./_components/AdsJobReviewPanel"),
  {
    loading: () => (
      <div className="mt-12 rounded-xl border border-white/10 bg-white/[0.04] p-6 text-sm text-white/60">
        Loading review…
      </div>
    ),
  }
)

/* ====================================================== */

export default function AdsPage() {

  const router = useRouter()

  const [siteUrl,setSiteUrl] = useState("")
  const [tone,setTone] = useState("emotional")
  const [duration,setDuration] = useState(30)
  const [platform,setPlatform] = useState("tiktok")
  const [editingStyle,setEditingStyle] = useState("auto")
  const [ultra,setUltra] = useState(true)
  const [creativeMode, setCreativeMode] = useState<"cinematic" | "ugc_social">(
    "cinematic"
  )
  const [renderTopVariants, setRenderTopVariants] = useState<1 | 2>(1)
  /** Opt-in faster capture/encode; sends `previewMode: "fast"` only when true. */
  const [fastPreviewGenerate, setFastPreviewGenerate] = useState(false)

/* ====================================================== */
/* HELPERS */
/* ====================================================== */

  const normalizeUrl = (url:string) => {

    const trimmed = url.trim()

    if(!trimmed) return ""

    if(!/^https?:\/\//i.test(trimmed))
      return `https://${trimmed}`

    return trimmed
  }

  const validUrl = (url:string) => {

    try{
      new URL(url)
      return true
    }catch{
      return false
    }

  }

  /** Labels aligned to worker DB progress: ~41–51 capture, ~52–56 cinematic encode, ~57+ grade/mix/final. */
  const stageFromProgress = (p:number) => {

    if(p < 18) return "Analyzing website structure"
    if(p < 20) return "Extracting product insights"
    if(p < 30) return "Writing viral ad script"
    if(p < 41) return "Generating AI voiceover"
    if(p < 52) return "Capturing website (browser — often the longest step)"
    if(p < 57) return "Building cinematic timeline (video encode)"
    if(p < 71) return "Color grading & audio mix"
    if(p < 100) return "Final video render"

    return "Finishing render"

  }

  const eta = () => {

    if(duration <= 15) return "1-3 min"
    if(duration <= 30) return "2-5 min"
    if(duration <= 45) return "3-7 min"
    return "4-10 min"

  }

  const normalizeOutputUrl = (url: string) => {
    if (url.startsWith("http")) return url
    const rawBase = process.env.NEXT_PUBLIC_API_URL?.trim() || "http://localhost:5000"
    const base = rawBase.endsWith("/api") ? rawBase.slice(0, -4) : rawBase
    return `${base.replace(/\/$/, "")}${url}`
  }

  const job = useAdsJobPolling({
    storageKey: "vf:admin-ads:job",
    normalizeOutputUrl,
    stageFromProgress,
    cancelPath: (jobId) => `/ads/${jobId}/cancel`,
  })

  const openJobById = useCallback(
    async (jid: string) => {
      router.replace(`/admin/ads?job=${encodeURIComponent(jid)}`, {
        scroll: false,
      })
      await job.loadJobForReview(jid)
    },
    [job, router]
  )

  const [adJobsListTick, setAdJobsListTick] = useState(0)

  useEffect(() => {
    if (job.state.jobId) setAdJobsListTick(t => t + 1)
  }, [job.state.jobId])

/* ====================================================== */
/* GENERATE */
/* ====================================================== */

  const generateAd = async () => {

    if(job.state.loading) return

    const url = normalizeUrl(siteUrl)

    if(!validUrl(url)){

      job.setError("Enter a valid website URL")
      return

    }

    job.resetForNewRun()

    try{

      const res = await api.post<GenerateResponse>(
        "/ads/generate",
        {
          siteUrl: url,
          tone,
          duration,
          platform,
          editingStyle,
          ultra,
          creativeMode,
          renderTopVariants,
          ...(fastPreviewGenerate ? { previewMode: "fast" as const } : {}),
        },
        { timeout: LONG_REQUEST_TIMEOUT_MS }
      )
      const operation = normalizeToolOperation(res)

      if(!operation.success || !operation.jobId)
        throw new Error(operation.message || "Invalid response")

      job.begin(operation.jobId, operation.requestId)
      router.replace(`/admin/ads?job=${encodeURIComponent(operation.jobId)}`, {
        scroll: false,
      })

    }catch(e:any){

      job.setError(
        e?.data?.message ||
          e?.message ||
          "Ad generation failed"
      )

    }

  }

/* ====================================================== */

  useEffect(() => {
    if (typeof window === "undefined") return
    const q = new URLSearchParams(window.location.search).get("job")
    if (q) {
      void job.loadJobForReview(q)
      return
    }
    void job.resume()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** After `resume()` restores an in-flight job, align `?job=` so URL matches state (shareable / refresh-safe). */
  const resumeUrlSyncedRef = useRef(false)
  useEffect(() => {
    if (typeof window === "undefined" || resumeUrlSyncedRef.current) return
    const q = new URLSearchParams(window.location.search).get("job")
    if (q) {
      resumeUrlSyncedRef.current = true
      return
    }
    if (job.state.jobId) {
      resumeUrlSyncedRef.current = true
      router.replace(`/admin/ads?job=${encodeURIComponent(job.state.jobId)}`, {
        scroll: false,
      })
    }
  }, [job.state.jobId, router])

/* ====================================================== */
/* UI */
/* ====================================================== */

  return(

  <div className="min-h-screen bg-[#0B0F19] text-white px-6 py-16">

  <div className="max-w-5xl mx-auto">

  <h1 className="text-5xl font-bold mb-4">
  AI Ad Studio
  </h1>

  <p className="text-white/60 mb-10">
  Generate cinematic ads for TikTok, Instagram and YouTube.
  </p>

  {/* INPUTS */}

  <div className="grid md:grid-cols-2 gap-6">

  <input
  type="text"
  placeholder="https://yourwebsite.com"
  value={siteUrl}
  onChange={e=>setSiteUrl(e.target.value)}
  disabled={job.state.loading}
  className="col-span-2 px-4 py-3 rounded-xl bg-white/10 border border-white/20"
  />

  <select
  value={tone}
  onChange={e=>setTone(e.target.value)}
  disabled={job.state.loading}
  className="px-4 py-3 rounded-xl bg-white/10 border border-white/20"
  >

  <option value="aggressive">⚡ Aggressive</option>
  <option value="emotional">💛 Emotional</option>
  <option value="clean">✨ Clean</option>
  <option value="cinematic">🎬 Cinematic</option>

  </select>

  <select
  value={platform}
  onChange={e=>setPlatform(e.target.value)}
  disabled={job.state.loading}
  className="px-4 py-3 rounded-xl bg-white/10 border border-white/20"
  >

  <option value="tiktok">TikTok 9:16</option>
  <option value="instagram">Instagram 1:1</option>
  <option value="youtube">YouTube 16:9</option>

  </select>

  <select
  value={duration}
  onChange={e=>setDuration(Number(e.target.value))}
  disabled={job.state.loading}
  className="px-4 py-3 rounded-xl bg-white/10 border border-white/20"
  >

  <option value={15}>15 sec</option>
  <option value={30}>30 sec</option>
  <option value={45}>45 sec</option>
  <option value={60}>60 sec</option>

  </select>

  <select
  value={editingStyle}
  onChange={e=>setEditingStyle(e.target.value)}
  disabled={job.state.loading}
  className="px-4 py-3 rounded-xl bg-white/10 border border-white/20"
  >

  <option value="auto">🧠 Smart Auto</option>
  <option value="website">🌐 Website Demo</option>
  <option value="desk">🖥 Desk Setup</option>
  <option value="aggressive">⚡ Viral Fast</option>
  <option value="premium">✨ Premium Cinematic</option>

  </select>

  <select
  value={creativeMode}
  onChange={e =>
    setCreativeMode(e.target.value as "cinematic" | "ugc_social")
  }
  disabled={job.state.loading}
  className="col-span-2 px-4 py-3 rounded-xl bg-white/10 border border-white/20"
  title="Cinematic = polished product commercial. UGC = short-form native (TikTok/Reels energy)."
  >
  <option value="cinematic">🎬 Cinematic product ad</option>
  <option value="ugc_social">📱 UGC / short-form social</option>
  </select>

  <select
  value={renderTopVariants === 2 ? "2" : "1"}
  onChange={e => setRenderTopVariants(e.target.value === "2" ? 2 : 1)}
  disabled={job.state.loading}
  className="col-span-2 px-4 py-3 rounded-xl bg-white/10 border border-white/20"
  title="Render the top-scored variant only, or winner + runner-up for side-by-side review."
  >
  <option value="1">Render top 1 variant (default)</option>
  <option value="2">Render top 2 variants (winner + runner-up)</option>
  </select>

  <label className="flex items-center gap-3 col-span-2">

  <input
  type="checkbox"
  checked={ultra}
  disabled={job.state.loading}
  onChange={()=>setUltra(!ultra)}
  />

  Ultra Quality Rendering

  </label>

  <label className="flex items-start gap-3 col-span-2 rounded-xl border border-amber-500/20 bg-amber-500/[0.06] px-4 py-3">

  <input
  type="checkbox"
  checked={fastPreviewGenerate}
  disabled={job.state.loading}
  onChange={() => setFastPreviewGenerate(v => !v)}
  className="mt-0.5"
  />

  <span>
  <span className="font-medium text-amber-100/95">Fast preview</span>
  <span className="mt-0.5 block text-sm font-normal text-white/60">
  Quicker iteration: lighter capture and encodes. Output is labeled in review and in Recent jobs. Off by default.
  {ultra && fastPreviewGenerate ? (
 <span className="mt-1 block text-xs text-amber-200/80">
    Note: Ultra quality has limited effect while Fast preview is on.
    </span>
  ) : null}
  </span>
  </span>

  </label>

  </div>

  {/* BUTTON */}

  <button
  onClick={generateAd}
  disabled={job.state.loading}
  className="w-full mt-8 py-4 bg-gradient-to-r from-purple-600 to-pink-600 rounded-xl text-lg font-semibold disabled:opacity-60"
  >

  {job.state.loading ? "Generating Ad..." : "Generate AI Ad"}

  </button>
  {job.state.loading && (
    <button
      type="button"
      onClick={() => void job.cancel()}
      className="mt-2 w-full rounded-xl border border-white/15 bg-white/5 py-2 text-xs text-white/70 hover:bg-white/10"
    >
      Cancel Generation
    </button>
  )}
  {(job.state.jobId || job.state.requestId) && (
    <p className="mt-2 text-xs text-white/45">
      {job.state.jobId ? `Job ID: ${job.state.jobId}` : ""}
      {job.state.requestId ? `${job.state.jobId ? " • " : ""}Request ID: ${job.state.requestId}` : ""}
    </p>
  )}

  {/* PROGRESS */}

  {job.state.loading && (

  <div className="mt-6">

  <div className="w-full bg-white/10 rounded-full h-3">

  <div
  className="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-500"
  style={{width:`${job.state.progress}%`}}
  />

  </div>

  <p className="text-sm text-white/60 mt-2">
  {job.state.stageText} • {job.state.progress}% • ETA {eta()}
  </p>
  {!fastPreviewGenerate &&
    job.state.progress >= 41 &&
    job.state.progress < 57 && (
    <p className="mt-2 text-xs text-amber-200/75">
    This stage records the site in a real browser; progress may move in small steps. For quicker iteration, use{" "}
    <span className="font-medium text-amber-100/90">Fast preview</span> above.
    </p>
  )}

  </div>

  )}

  {/* ERROR */}

  {job.state.error && (
  <div className="mt-6 rounded-xl border border-red-500/25 bg-red-500/[0.08] px-4 py-3">
  <p className="text-sm text-red-200/95">{job.state.error}</p>
  <button
  type="button"
  onClick={() => job.setError(null)}
  className="mt-2 text-xs font-medium text-white/55 underline decoration-white/30 hover:text-white/80"
  >
  Dismiss
  </button>
  </div>
  )}

  <AdsAdminJobsList
    refreshKey={adJobsListTick}
    currentJobId={job.state.jobId}
    onOpenJob={openJobById}
  />

  {/* Job review + output */}

  {job.state.jobId &&
    (job.state.loading ||
      job.state.jobRecord ||
      job.state.videoUrl) && (
    <AdsJobReviewPanel
      key={job.state.jobId}
      jobId={job.state.jobId}
      jobRecord={job.state.jobRecord}
      videoUrl={job.state.videoUrl}
      normalizeOutputUrl={normalizeOutputUrl}
      loading={job.state.loading}
      onOpenJob={openJobById}
      onOperatorReviewChange={() => {
        if (job.state.jobId) void job.loadJobForReview(job.state.jobId)
        setAdJobsListTick(t => t + 1)
      }}
    />
  )}

  </div>

  </div>

  )

}