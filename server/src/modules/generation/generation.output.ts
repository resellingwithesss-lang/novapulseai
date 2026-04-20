import {
  FinalScript,
  RawScript,
  ScriptViralPack,
} from "./generation.contract";

export type ParseFailureReason =
  | "EMPTY_OR_TOO_LARGE"
  | "JSON_PARSE_FAILED"
  | "UNSUPPORTED_SHAPE";

function normalizeHashtags(tags: string[]): string[] {
  return tags
    .slice(0, 12)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .map((tag) => (tag.startsWith("#") ? tag : `#${tag.replace(/\s+/g, "")}`));
}

function enforceSubtitleRhythm(text: string): string {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const words = line.split(" ");
      return words.length > 14 ? words.slice(0, 14).join(" ") : line;
    })
    .join("\n");
}

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeViralPack(raw: unknown): ScriptViralPack | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const shareTrigger =
    typeof o.shareTrigger === "string" ? o.shareTrigger.trim() : "";
  const rewatchBeat =
    typeof o.rewatchBeat === "string" ? o.rewatchBeat.trim() : "";
  const commentFriction =
    typeof o.commentFriction === "string" ? o.commentFriction.trim() : "";
  if (!shareTrigger && !rewatchBeat && !commentFriction) return undefined;
  return { shareTrigger, rewatchBeat, commentFriction };
}

export function calculateCompositeScore(script: FinalScript): number {
  const viralBoost = script.viralPack?.shareTrigger ? 4 : 0;
  return (
    toNumber(script.retentionScore) * 2 +
    toNumber(script.hookStrength) * 1.5 +
    toNumber(script.controversyScore) +
    viralBoost
  );
}

export function normalizeScript(script: RawScript): FinalScript {
  const viralPack = normalizeViralPack(script.viralPack);
  const base: FinalScript = {
    hook: typeof script.hook === "string" ? script.hook.trim() : "",
    openLoop:
      typeof script.openLoop === "string" ? script.openLoop.trim() : "",
    body: enforceSubtitleRhythm(
      typeof script.body === "string" ? script.body.trim() : ""
    ),
    cta: typeof script.cta === "string" ? script.cta.trim() : "",
    caption: typeof script.caption === "string" ? script.caption.trim() : "",
    hashtags: Array.isArray(script.hashtags)
      ? normalizeHashtags(script.hashtags.map((tag) => String(tag)))
      : [],
    retentionScore: toNumber(script.retentionScore),
    hookStrength: toNumber(script.hookStrength),
    controversyScore: toNumber(script.controversyScore),
  };
  return viralPack ? { ...base, viralPack } : base;
}

export function normalizeScripts(scripts: RawScript[]): FinalScript[] {
  return scripts.map(normalizeScript);
}

export function isValidScript(script: FinalScript): boolean {
  return script.hook.length > 5 && script.body.length > 50 && script.cta.length > 3;
}

export function extractRawScriptsFromModelContent(
  content: string,
  maxOutputLength: number
): RawScript[] | null {
  if (!content || content.length > maxOutputLength) return null;

  try {
    const parsed = JSON.parse(content);

    if (Array.isArray(parsed?.scripts)) {
      return parsed.scripts as RawScript[];
    }

    if (Array.isArray(parsed)) {
      return parsed as RawScript[];
    }

    if (Array.isArray(parsed?.data)) {
      return parsed.data as RawScript[];
    }

    if (Array.isArray(parsed?.data?.scripts)) {
      return parsed.data.scripts as RawScript[];
    }

    return null;
  } catch {
    return null;
  }
}

export function parseScriptsWithReason(
  content: string,
  maxOutputLength: number
): { scripts: RawScript[] | null; reason?: ParseFailureReason } {
  if (!content || content.length > maxOutputLength) {
    return { scripts: null, reason: "EMPTY_OR_TOO_LARGE" };
  }

  try {
    const parsed = JSON.parse(content);

    if (Array.isArray(parsed?.scripts)) {
      return { scripts: parsed.scripts as RawScript[] };
    }

    if (Array.isArray(parsed)) {
      return { scripts: parsed as RawScript[] };
    }

    if (Array.isArray(parsed?.data)) {
      return { scripts: parsed.data as RawScript[] };
    }

    if (Array.isArray(parsed?.data?.scripts)) {
      return { scripts: parsed.data.scripts as RawScript[] };
    }

    return { scripts: null, reason: "UNSUPPORTED_SHAPE" };
  } catch {
    return { scripts: null, reason: "JSON_PARSE_FAILED" };
  }
}

export function selectFinalScripts(
  scripts: RawScript[],
  maxScripts: number
): FinalScript[] {
  const normalized = normalizeScripts(scripts);

  return normalized
    .filter(isValidScript)
    .sort((a, b) => calculateCompositeScore(b) - calculateCompositeScore(a))
    .slice(0, maxScripts);
}
