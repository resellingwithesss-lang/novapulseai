/* =========================================================
   PLATFORM / RENDER BASICS
========================================================= */

export type Platform = "tiktok" | "instagram" | "youtube"

export type AspectRatio =
  | "9:16"
  | "1:1"
  | "16:9"
  | "4:5"

export type Resolution =
  | "1080x1920"
  | "1080x1350"
  | "1920x1080"
  | "1024x1024"

export type Quality = "standard" | "high" | "ultra"
export type ExportFormat = "mp4"

/* =========================================================
   EDITING / VIDEO STYLE
========================================================= */

export type EditingStyle =
  | "aggressive"
  | "premium"
  | "auto"
  | "website"
  | "desk"

export type TransitionStyle =
  | "cut"
  | "fade"
  | "zoom"
  | "slide"
  | "cinematic_cross"
  | "whip"

export type CameraStyle =
  | "static"
  | "handheld"
  | "smooth_glide"
  | "dramatic_push"

export type ColorProfile =
  | "neutral"
  | "warm"
  | "cool"
  | "high_contrast"
  | "film"

export type Pacing = "fast" | "medium" | "slow"

/* =========================================================
   MARKETING STRATEGY
========================================================= */

export type Tone =
  | "aggressive"
  | "emotional"
  | "clean"
  | "luxury"
  | "funny"
  | "dramatic"
  | "educational"
  | "storytelling"
  | "minimal"
  | "cinematic"

export type AdObjective =
  | "brand_awareness"
  | "traffic"
  | "engagement"
  | "lead_generation"
  | "conversions"
  | "app_installs"

export type HookStyle =
  | "pattern_interrupt"
  | "question"
  | "bold_claim"
  | "shock"
  | "relatable_problem"
  | "statistic"
  | "story_start"

export type CTAStyle =
  | "hard_sell"
  | "soft_sell"
  | "urgency"
  | "scarcity"
  | "authority"
  | "social_proof"
  | "community"
  | "exclusive"

export type CreatorStyle =
  | "ugc_selfie"
  | "ugc_review"
  | "screen_demo"
  | "cinematic_saas"
  | "founder_story"

export type CaptionStyle =
  | "big_bold"
  | "minimal_clean"
  | "animated_kinetic"
  | "highlight_keywords"
  | "subtle_subtitles"
  | "luxury_fade"
  | "high_energy_pop"

export type BackgroundMusicMood =
  | "upbeat"
  | "dramatic"
  | "inspirational"
  | "hype"
  | "corporate"
  | "ambient"
  | "cinematic_trailer"
  | "minimal_tech"

/* =========================================================
   AUDIENCE
========================================================= */

export type Gender = "male" | "female" | "all"
export type AwarenessLevel = "cold" | "warm" | "hot"
export type DevicePreference = "mobile" | "desktop" | "all"
export type IncomeBracket = "low" | "mid" | "high"

export interface TargetAudience {
  ageRange?: [number, number]
  gender?: Gender
  interests?: string[]
  painPoints?: string[]
  desires?: string[]
  awarenessLevel?: AwarenessLevel
  incomeBracket?: IncomeBracket
  location?: string[]
  devicePreference?: DevicePreference
}

/* =========================================================
   BRAND PROFILE
========================================================= */

export type BrandArchetype =
  | "hero"
  | "outlaw"
  | "caregiver"
  | "explorer"
  | "creator"
  | "ruler"
  | "magician"

export interface BrandProfile {
  name?: string
  tagline?: string
  voiceStyle?: string
  brandValues?: string[]
  primaryColorHex?: string
  secondaryColorHex?: string
  accentColorHex?: string
  logoUrl?: string
  brandArchetype?: BrandArchetype
}

/* =========================================================
   CINEMATIC CONTROLS
========================================================= */

export interface CinematicControls {
  motionIntensity?: 1 | 2 | 3 | 4 | 5
  colorProfile?: ColorProfile
  useLUT?: boolean
  useFilmGrain?: boolean
  useVignette?: boolean
  useMotionBlur?: boolean
  cameraStyle?: CameraStyle
  transitionStyle?: TransitionStyle
}

export interface MotionProfile {
  zoomSpeed?: number
  cameraDrift?: number
  parallaxIntensity?: number
}

/* =========================================================
   OPTIMIZATION
========================================================= */

export interface OptimizationSettings {
  optimizeFor?: "clicks" | "watch_time" | "conversions" | "engagement"
  pacing?: Pacing
  energyLevel?: 1 | 2 | 3 | 4 | 5
  retentionPriority?: number
  hookPriority?: number
  conversionBias?: number
  aBTestVariants?: number
}

/* =========================================================
   VISUALS
========================================================= */

export type VisualType =
  | "landing_page"
  | "dashboard"
  | "feature_demo"
  | "pricing_page"
  | "testimonial"
  | "broll"
  | "cta_screen"
  | "login_flow"
  | "tools_grid"

export type CaptureStyle = "website" | "desk"

/* =========================================================
   CAPTIONS / AUDIO
========================================================= */

export interface Caption {
  text: string
  start: number
  end: number
}

export interface AudioMixOptions {
  voicePath: string
  musicPath?: string
  outputFileName: string
  durationSeconds?: number
}

/* =========================================================
   RENDER
========================================================= */

export interface RenderOptions {
  clips: string[]
  voicePath: string
  captions: Caption[]
  outputFileName: string
  platform?: Platform
  editingStyle?: EditingStyle
  quality?: Quality
  hook?: string
  cta?: string
  watermarkText?: string
}

/* =========================================================
   CAPTURE
========================================================= */

/** NovaPulseAI capture diagnostics — see `pipeline/novapulseai.ad-quality-gate.ts`. */
export type NovaPulseAICaptureDiagnostics = import("./pipeline/novapulseai.ad-quality-gate").NovaPulseAICaptureDiagnostics

export interface CaptureResult {
  videoPath: string
  duration: number
  pagesVisited?: string[]
  screenshots?: string[]
  /** Present when NovaPulseAI capture profile is active (hostname / dev env). */
  novaPulseAIDiagnostics?: NovaPulseAICaptureDiagnostics
}

/* =========================================================
   CINEMATIC OUTPUT
========================================================= */

export interface CinematicAssets {
  finalVideo: string
  metadata: {
    durationRequested: number
    buildTimeMs: number
    captureDuration: number
    platform: Platform
    width: number
    height: number
    fps: number
    sceneCount: number
    encoder: string
    pagesVisited?: string[]
    novaPulseAI?: {
      qualityGatePassed: boolean
      flowMode?: "logged_in" | "public_fallback"
      recovery?: "timeline_after_weak_interactive"
      gateReason?: string
      runtimeSharesPct?: Record<string, number>
    }
  }
}

/* =========================================================
   INPUT
========================================================= */

export interface GenerateAdInput {
  siteUrl: string
  platform: Platform
  duration: number
  tone: Tone
  objective?: AdObjective
  audience?: TargetAudience
  brand?: BrandProfile
  creatorStyle?: CreatorStyle
  hookStyle?: HookStyle
  captionStyle?: CaptionStyle
  ctaStyle?: CTAStyle
  backgroundMusicMood?: BackgroundMusicMood
  cinematic?: CinematicControls
  motion?: MotionProfile
  optimization?: OptimizationSettings
  includeSocialProof?: boolean
  includeTestimonials?: boolean
  includeProblemAgitation?: boolean
  includeBeforeAfter?: boolean
  addSubtitles?: boolean
  addLogoWatermark?: boolean
  exportFormat?: ExportFormat
  resolution?: Resolution
  aspectRatio?: AspectRatio
  bitrateKbps?: number
  quality?: Quality
  editingStyle?: EditingStyle
  captureStyle?: CaptureStyle
}

/* =========================================================
   GENERATED SCRIPT
========================================================= */

export interface GeneratedHook {
  text: string
  style: HookStyle
  voiceover: string
}

export interface GeneratedCTA {
  text: string
  style: CTAStyle
  urgencyLevel?: number
}

export interface GeneratedScene {
  id: string
  startTime: number
  endTime: number
  visualType?: VisualType
  visualDescription: string
  onScreenText: string
  caption: string
  voiceoverLine: string
  emotion?: string
  intensityLevel?: 1 | 2 | 3 | 4 | 5
  cameraDirection?: string
  transition?: TransitionStyle
  importanceScore?: number
  page?: string
  focus?: string
}

/* =========================================================
   SCRIPT METADATA
========================================================= */

export interface PerformancePrediction {
  estimatedHookRetention?: number
  predictedEngagementScore?: number
  conversionIntentScore?: number
  viralityScore?: number
  watchTimeProjection?: number
}

export interface GeneratedScriptMetadata {
  platform: Platform
  duration: number
  tone: Tone
  createdAt: number
  strategyNotes?: string
  performance?: PerformancePrediction
  variantId?: string
}

export interface GeneratedScript {
  metadata: GeneratedScriptMetadata
  hook: GeneratedHook
  scenes: GeneratedScene[]
  cta: GeneratedCTA
  hashtags?: string[]
  keywords?: string[]
  captionCopy?: string
}

/* =========================================================
   WEBSITE ANALYSIS
========================================================= */

export interface WebsiteAnalysis {
  siteUrl: string
  brandName?: string
  headline?: string
  subheadline?: string
  description?: string
  keyBenefits?: string[]
  features?: string[]
  testimonials?: string[]
  socialProof?: string[]
  ctaTexts?: string[]
  primaryColorHex?: string
  secondaryColorHex?: string
  accentColorHex?: string
  detectedPages?: string[]
  loginUrl?: string
  toolsUrl?: string
  pricingUrl?: string
  dashboardUrl?: string
  capturedAt?: number
}

/* =========================================================
   PERFORMANCE
========================================================= */

export interface AdPerformanceMetrics {
  impressions?: number
  ctr?: number
  watchTime?: number
  conversionRate?: number
  costPerClick?: number
  engagementRate?: number
}

/* =========================================================
   JOB PIPELINE
========================================================= */

export type RenderStatus =
  | "queued"
  | "processing"
  | "rendering"
  | "completed"
  | "failed"

export interface AdJobProgress {
  status: RenderStatus
  progress: number
  step?:
    | "analysis"
    | "script"
    | "voice"
    | "capture"
    | "cinematic"
    | "audio"
    | "render"
    | "complete"
    | "failed"
  message?: string
}

export interface AdRenderJob {
  id: string
  userId: string
  input: GenerateAdInput
  status: RenderStatus
  progress: number
  outputUrl?: string
  createdAt: number
  updatedAt?: number
}

/* =========================================================
   SCENE PLAN
========================================================= */

export interface PlannedScene {
  id: string
  kind: "hook" | "problem" | "product" | "benefit" | "proof" | "cta"
  duration: number
  source?: "capture" | "broll" | "ui" | "generated"
  visualType?: VisualType
  scriptText?: string
  captionText?: string
}