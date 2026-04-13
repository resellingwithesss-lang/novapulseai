/**
 * One-shot rebrand: ViralForge → NovaPulseAI (run from repo root: node scripts/rebrand-novapulseai.mjs)
 */
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build"])

const EXT = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".json",
  ".md",
  ".yml",
  ".css",
  ".example",
])

/** Order: longest / most specific first */
const REPLACEMENTS = [
  ["AD_TREAT_LOCALHOST_AS_VIRALFORGE", "AD_TREAT_LOCALHOST_AS_NOVAPULSEAI"],
  ["allowViralForgeDemoLoginSubmit", "allowNovaPulseAIDemoLoginSubmit"],
  ["viralForgeDemoLoginConfigured", "novaPulseAIDemoLoginConfigured"],
  ["detectViralForgeProduct", "detectNovaPulseAIProduct"],
  ["viralForgeProductAd", "novaPulseAIProductAd"],
  ["viralForgeProduct", "novaPulseAIProduct"],
  ["viralForgeDiagnostics", "novaPulseAIDiagnostics"],
  ["viralForgeCaptureReason", "novaPulseAICaptureReason"],
  ["viralForgeCaptureProfile", "novaPulseAICaptureProfile"],
  ["viralForgeLeanCapture", "novaPulseAILeanCapture"],
  ["maxFramesTimelineViralForge", "maxFramesTimelineNovaPulseAI"],
  ["resolveViralForgeCaptureProfile", "resolveNovaPulseAICaptureProfile"],
  ["finalizeViralForgeDemoLogin", "finalizeNovaPulseAIDemoLogin"],
  ["applyViralForgeQualityPass", "applyNovaPulseAIQualityPass"],
  ["viralForgeHookOverlay", "novaPulseAIHookOverlay"],
  ["viralForgeCtaOverlay", "novaPulseAICtaOverlay"],
  ["validateViralForgeCaptureQuality", "validateNovaPulseAICaptureQuality"],
  ["validateViralForgePlannedSceneMix", "validateNovaPulseAIPlannedSceneMix"],
  ["validateViralForgeStitchContinuity", "validateNovaPulseAIStitchContinuity"],
  ["aggregateViralForgeFrameShares", "aggregateNovaPulseAIFrameShares"],
  ["ViralForgeCaptureDiagnostics", "NovaPulseAICaptureDiagnostics"],
  ["ViralForgeQualityGateResult", "NovaPulseAIQualityGateResult"],
  ["ViralForgeFrameShares", "NovaPulseAIFrameShares"],
  ["ViralForgeCaptureProfileReason", "NovaPulseAICaptureProfileReason"],
  ["ViralForgeCaptureProfileResolution", "NovaPulseAICaptureProfileResolution"],
  ["vfCaptureSupplementalRuntimePct", "novaPulseAICaptureSupplementalRuntimePct"],
  ["trimViralForgeInteractiveSegments", "trimNovaPulseAIInteractiveSegments"],
  ["leanViralForgeTransformationSegment", "leanNovaPulseAITransformationSegment"],
  ["orderAndTrimViralForgeTimeline", "orderAndTrimNovaPulseAITimeline"],
  ["viralForgeCreatorAdBlock", "novaPulseAICreatorAdBlock"],
  ["detectViralForgeSiteUrl", "detectNovaPulseAISiteUrl"],
  ["hostname_viralforge", "hostname_novapulseai"],
  ["isVfLoggedIn", "isNovaPulseAILoggedIn"],
  ["MIN_VF_FINAL_DURATION_SEC", "MIN_NPAI_FINAL_DURATION_SEC"],
  ["runVfQualityGate", "runNpaiQualityGate"],
  ["vfNarrativeStrict", "npaiNarrativeStrict"],
  ["vfResolvedMeta", "npaiResolvedMeta"],
  ["vfProfileStitch", "npaiProfileStitch"],
  ["vfCaptureProfile", "npaiCaptureProfile"],
  ["vfDemoLoginJob", "npaiDemoLoginJob"],
  ["vfDemoCreds", "npaiDemoCreds"],
  ["vfDemoLogin", "npaiDemoLogin"],
  ["vfLoginSuccess", "npaiLoginSuccess"],
  ["vfProduct", "npaiProduct"],
  ["vfBlock", "npaiBlock"],
  ["vf_min_duration", "npai_min_duration"],
  ["../pipeline/vf.ad-quality-gate", "../pipeline/novapulseai.ad-quality-gate"],
  ["./pipeline/vf.ad-quality-gate", "./pipeline/novapulseai.ad-quality-gate"],
  ["./website.vf-login", "./website.novapulseai-login"],
  ["viralForgeTransformation", "novaPulseAITransformation"],
  ["viralForgeNormal", "novaPulseAINormal"],
  ["VF_E2E_", "NPAI_E2E_"],
  ["[e2e-vf]", "[e2e-npai]"],
  ["e2e-vf-", "e2e-npai-"],
  ["VIRALFORGE —", "NOVAPULSEAI —"],
  ["vf_auth_expired", "novapulseai_auth_expired"],
  ["vf_request_start", "novapulseai_request_start"],
  ["vf_request_end", "novapulseai_request_end"],
  ["vf_checkout_plan_intent", "novapulseai_checkout_plan_intent"],
  ["vf_resume_checkout", "novapulseai_resume_checkout"],
  ["vf_debug_a5148d", "novapulseai_debug_a5148d"],
  ["vf-debug-45b566", "npai-debug-45b566"],
  ["vf-agent-debug", "novapulseai-agent-debug"],
  ["vf-agent-debug/log", "novapulseai-agent-debug/log"],
  ["data-vf-tool", "data-npai-tool"],
  ["data-vf-tool=", "data-npai-tool="],
  ['"vf-lineage-hint"', '"npai-lineage-hint"'],
  ["vf-app-shell", "npai-app-shell"],
  ["#vf-app-shell", "#npai-app-shell"],
  ["viralforge_postgres", "novapulseai_postgres"],
  ["viralforge_redis", "novapulseai_redis"],
  ["[ads:vf-login]", "[ads:npai-login]"],
  ["https://vf.local", "https://npai.local"],
]

function walk(dir, files = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(ent.name)) continue
      walk(p, files)
    } else {
      const ext = path.extname(ent.name)
      if (EXT.has(ext)) files.push(p)
    }
  }
  return files
}

function transform(content) {
  let s = content
  for (const [a, b] of REPLACEMENTS) {
    if (s.includes(a)) s = s.split(a).join(b)
  }
  // Variable / param rename: remaining `viralForge` identifier (boolean flags)
  s = s.replace(/\bviralForge\b/g, "novaPulseAI")
  // Branded strings & domains
  s = s.split("ViralForge").join("NovaPulseAI")
  s = s.split("viralforge").join("novapulseai")
  return s
}

const files = walk(ROOT)
let n = 0
for (const f of files) {
  const rel = path.relative(ROOT, f)
  if (rel.startsWith(`scripts${path.sep}rebrand-novapulseai.mjs`)) continue
  const raw = fs.readFileSync(f, "utf8")
  const next = transform(raw)
  if (next !== raw) {
    fs.writeFileSync(f, next, "utf8")
    n++
    console.log("updated:", rel)
  }
}
console.log("files changed:", n)
