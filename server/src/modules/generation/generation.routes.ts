import { Router, Response } from "express";

import { prisma } from "../../lib/prisma";
import { openai } from "../../lib/openai";
import { resolveRequestId, toolFail, toolOk } from "../../lib/tool-response";
import { logToolEvent } from "../../lib/tool-logger";
import { requireAuth, AuthRequest } from "../auth/auth.middleware";
import {
  GenerationAttemptDiagnostic,
  GenerationErrorClass,
  GENERATION_COOLDOWN_MS,
  GENERATION_COST,
  GENERATION_MAX_OUTPUT_LENGTH,
  GENERATION_MAX_RETRIES,
  GENERATION_MAX_SCRIPTS,
  GENERATION_MAX_TOKENS,
  GENERATION_MODEL,
  GenerationType,
  generationInputSchema,
} from "./generation.contract";
import {
  ParseFailureReason,
  parseScriptsWithReason,
  selectFinalScripts,
} from "./generation.output";
import {
  evaluateCooldown,
  evaluateGenerationEligibility,
  isCooldownActiveAccountingError,
  isGenerationAccountingError,
  loadGenerationUserSnapshot,
  loadLastGenerationTimestamp,
  persistGenerationAndAccounting,
} from "./generation.accounting";
import {
  classifyRetryableError,
  runWithRetry,
} from "./generation.retry";
import {
  formatCreatorContextForPrompt,
  loadCreatorContextAttachments,
} from "../workflow/creator-context";
import { validateGenerationSourceRefs } from "../workflow/source-metadata";

const router = Router();

/* =====================================================
   CONFIG
===================================================== */

/* =====================================================
   VALIDATION
===================================================== */

/* =====================================================
   UTILITIES
===================================================== */

function safeErrorSummary(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "unknown_error";
}

function classifyOpenAiError(error: unknown): GenerationErrorClass {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (
      msg.includes("timeout") ||
      msg.includes("network") ||
      msg.includes("rate limit") ||
      msg.includes("503")
    ) {
      return "OPENAI_REQUEST_ERROR";
    }
    return "OPENAI_REQUEST_ERROR";
  }
  return "UNKNOWN";
}

function classifyParseFailureReason(
  reason: ParseFailureReason
): GenerationErrorClass {
  if (reason === "EMPTY_OR_TOO_LARGE") return "OPENAI_EMPTY_CONTENT";
  if (reason === "JSON_PARSE_FAILED") return "MODEL_PARSE_FAILED";
  if (reason === "UNSUPPORTED_SHAPE") return "MODEL_UNSUPPORTED_SHAPE";
  return "MODEL_OUTPUT_INVALID";
}

function logAttemptDiagnostic(
  diagnostic: GenerationAttemptDiagnostic,
  errorSummary?: string
) {
  const payload = errorSummary
    ? { ...diagnostic, errorSummary }
    : diagnostic;
  console.warn("GENERATION_ATTEMPT_FAIL", payload);
}

function sanitizeInput(input: string): string {
  return input.trim().replace(/\s+/g, " ");
}

function createNonRetriableModelError(
  parseFailureReason?: ParseFailureReason
) {
  const error = new Error("AI output invalid") as Error & {
    nonRetriable?: boolean
    parseFailureReason?: ParseFailureReason
  }
  error.nonRetriable = true
  if (parseFailureReason) {
    error.parseFailureReason = parseFailureReason
  }
  return error
}

/* =====================================================
   ROUTE
===================================================== */

router.post("/", requireAuth, async (req: AuthRequest, res: Response) => {
  const startTime = Date.now();
  const requestId = resolveRequestId(req);

  try {
    const parsed = generationInputSchema.safeParse(req.body);

    if (!parsed.success) {
      return toolFail(res, 400, "Invalid input", {
        requestId,
        stage: "validate",
        status: "queued",
        progress: 0,
        code: "INVALID_INPUT",
        errors: parsed.error.flatten(),
      });
    }

    const {
      input,
      type,
      tone,
      intensity,
      controversy,
      platform,
      audience,
      experience,
      goal,
      psychology,
      format,
      pov,
      emotion,
      workspaceId: bodyWorkspaceId,
      brandVoiceId: bodyBrandVoiceId,
      sourceContentPackId: bodySourcePackId,
      sourceGenerationId: bodySourceGenId,
      sourceType: bodySourceType,
    } = parsed.data
    const userId = req.user?.id;

    if (!userId) {
      return toolFail(res, 401, "Unauthorized", {
        requestId,
        stage: "validate",
        status: "queued",
        progress: 0,
        code: "UNAUTHORIZED",
      });
    }

    const sourceRefCheck = await validateGenerationSourceRefs(prisma, userId, {
      sourceContentPackId: bodySourcePackId,
      sourceGenerationId: bodySourceGenId,
    });
    if (sourceRefCheck.ok === false) {
      return toolFail(res, 400, sourceRefCheck.message, {
        requestId,
        stage: "validate",
        status: "queued",
        progress: 0,
        code: "INVALID_INPUT",
      });
    }

    /* ================= USER CHECK ================= */

    const user = await loadGenerationUserSnapshot(prisma, userId);

    if (!user) {
      return toolFail(res, 404, "User not found", {
        requestId,
        stage: "validate",
        status: "queued",
        progress: 0,
        code: "NOT_FOUND",
      });
    }

    const now = new Date();
    const eligibility = evaluateGenerationEligibility(
      user,
      now,
      GENERATION_COST
    );
    if (eligibility.allowed === false) {
      const { status, message } = eligibility;
      return toolFail(res, status, message, {
        requestId,
        stage: "validate",
        status: "queued",
        progress: 0,
        code: "FORBIDDEN",
      });
    }
    const { isUnlimited } = eligibility;

    /* ================= COOLDOWN ================= */

    const lastCreatedAt = await loadLastGenerationTimestamp(
      prisma,
      userId
    );
    const cooldown = evaluateCooldown(
      lastCreatedAt,
      Date.now(),
      GENERATION_COOLDOWN_MS
    );
    if (cooldown.allowed === false) {
      const { retryAfterMs } = cooldown;
      return toolFail(res, 429, "Please wait before generating again.", {
        retryAfterMs,
        requestId,
        stage: "rank",
        status: "processing",
        progress: 45,
        code: "RETRY_LATER",
      });
    }

    /* ================= PROMPT ================= */

    const cleanInput = sanitizeInput(input);

    let workspaceIdForRow: string | null = null
    let brandVoiceIdForRow: string | null = null
    let creatorAddon = ""
    if (bodyWorkspaceId || bodyBrandVoiceId) {
      const loaded = await loadCreatorContextAttachments(prisma, userId, {
        workspaceId: bodyWorkspaceId,
        brandVoiceId: bodyBrandVoiceId,
      })
      if (loaded.ok === false) {
        return toolFail(
          res,
          400,
          loaded.code === "BRAND_VOICE_WORKSPACE_MISMATCH"
            ? "Brand voice does not match the selected workspace."
            : "Invalid workspace or brand voice.",
          {
            requestId,
            stage: "validate",
            status: "queued",
            progress: 0,
            code: "INVALID_INPUT",
          }
        )
      }
      workspaceIdForRow = loaded.workspace?.id ?? null
      brandVoiceIdForRow = loaded.brandVoice?.id ?? null
      creatorAddon = formatCreatorContextForPrompt(
        loaded.workspace,
        loaded.brandVoice
      )
    }

    const baseCtx = [
      platform && `Target surface: ${platform}`,
      audience && `Primary audience: ${audience}`,
      experience && `Viewer experience level: ${experience}`,
      goal && `Success metric / goal: ${goal}`,
      psychology && `Psychology / angle: ${psychology}`,
      format && `Structure format: ${format}`,
      pov && `POV: ${pov}`,
      emotion && `Dominant emotion to engineer: ${emotion}`,
    ]
      .filter(Boolean)
      .join("\n")

    const ctx = [baseCtx, creatorAddon].filter(Boolean).join("\n\n")

    const systemPrompt = `
You are a principal short-form strategist (TikTok / Reels / Shorts). You write scripts that survive the first 2 seconds and earn rewatches.

Hard rules:
1. Hook = concrete curiosity gap or pattern interrupt (no generic "In this video…").
2. Open loop in the first 2 spoken lines; pay it off or deepen it before the CTA.
3. Escalation ladder: each beat raises stakes, novelty, or tension.
4. Body lines are subtitle-safe (max 14 words per line in "body"; use newline-separated beats).
5. One deliberate comment-bait moment (polarizing but not hateful, platform-safe).
6. CTA is specific (save, duet, stitch, follow, link-in-bio style) — match the goal.
7. Score fields must be honest integers 0–100 (retentionScore weights overall watch-through potential).
8. Return ONLY a valid JSON object with key "scripts". No markdown.

Each script must feel meaningfully different (angle A/B/C: contrarian vs tutorial vs story vs myth-bust).
`.trim()

    const userPrompt = `
Generate 7 distinct high-retention ${type} scripts. We will keep the best ${GENERATION_MAX_SCRIPTS} downstream — maximize variety and quality.

Topic / brief: "${cleanInput}"
Tone: ${tone}
Intensity (pace & risk): ${intensity}/10
Controversy / debate energy: ${controversy}/10
${ctx ? `\nCreator context:\n${ctx}\n` : ""}

JSON shape:
{
  "scripts": [
    {
      "hook": "",
      "openLoop": "",
      "body": "",
      "cta": "",
      "caption": "",
      "hashtags": [],
      "retentionScore": 0,
      "hookStrength": 0,
      "controversyScore": 0
    }
  ]
}
`.trim()

    /* ================= AI GENERATION ================= */

    let scripts: ReturnType<typeof parseScriptsWithReason>["scripts"] = null;

    try {
      scripts = await runWithRetry(
        async () => {
          const completion = await openai.chat.completions.create({
            model: GENERATION_MODEL,
            temperature: 0.9 + intensity / 20,
            max_tokens: GENERATION_MAX_TOKENS,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
          });

          const content = completion.choices[0]?.message?.content;
          const parsedResult = parseScriptsWithReason(
            content || "",
            GENERATION_MAX_OUTPUT_LENGTH
          );
          const extracted = parsedResult.scripts;

          if (extracted && extracted.length > 0) {
            return extracted;
          }

          throw createNonRetriableModelError(parsedResult.reason);
        },
        {
          requestId,
          getElapsedMs: () => Date.now() - startTime,
          maxAttempts: GENERATION_MAX_RETRIES,
          shouldRetry: (decision) => decision.retriable,
          onAttemptFailure: (diagnostic) => {
            const errorClass =
              diagnostic.errorClass ||
              (diagnostic.parseFailureReason
                ? classifyParseFailureReason(
                    diagnostic.parseFailureReason
                  )
                : "UNKNOWN");

            const errorSummary = diagnostic.parseFailureReason
              ? `parse:${diagnostic.parseFailureReason}`
              : undefined;

            logAttemptDiagnostic(
              { ...diagnostic, errorClass },
              errorSummary
            );
          },
        }
      );
    } catch (error) {
      const retryDecision = classifyRetryableError(error);
      const errorClass =
        retryDecision.errorClass || classifyOpenAiError(error);
      const errorSummary = safeErrorSummary(error);

      console.error("OPENAI_GENERATION_ERROR", {
        requestId,
        attempt: GENERATION_MAX_RETRIES,
        errorClass,
        errorSummary,
      });
    }

    if (!scripts) {
      logToolEvent("warn", {
        tool: "generation",
        requestId,
        userId,
        stage: "rank",
        status: "failed",
        message: "AI returned invalid response",
      });
      return toolFail(res, 502, "AI returned invalid response", {
        requestId,
        stage: "rank",
        status: "processing",
        progress: 70,
        code: "AI_INVALID",
      });
    }

    /* ================= VALIDATION ================= */

    const finalScripts = selectFinalScripts(
      scripts,
      GENERATION_MAX_SCRIPTS
    );

    if (!finalScripts.length) {
      logToolEvent("warn", {
        tool: "generation",
        requestId,
        userId,
        stage: "rank",
        status: "failed",
        message: "No valid scripts generated",
      });
      return toolFail(res, 502, "No valid scripts generated", {
        requestId,
        stage: "rank",
        status: "processing",
        progress: 72,
        code: "AI_INVALID",
      });
    }

    /* ================= SAVE ================= */

    try {
      await prisma.$transaction(async (tx) =>
        persistGenerationAndAccounting(tx, {
          userId,
          type: type as GenerationType,
          input: cleanInput,
          outputJson: JSON.stringify(finalScripts),
          requestId,
          durationMs: Date.now() - startTime,
          modelUsed: GENERATION_MODEL,
          isUnlimited,
          generationCost: GENERATION_COST,
          cooldownMs: GENERATION_COOLDOWN_MS,
          workspaceId: workspaceIdForRow,
          brandVoiceId: brandVoiceIdForRow,
          sourceContentPackId: bodySourcePackId ?? null,
          sourceGenerationId: bodySourceGenId ?? null,
          sourceType: bodySourceType ?? null,
        })
      );
    } catch (error) {
      if (isCooldownActiveAccountingError(error)) {
        return toolFail(res, 429, "Please wait before generating again.", {
          retryAfterMs: error.retryAfterMs,
          requestId,
          stage: "finalize",
          status: "processing",
          progress: 90,
          code: "RETRY_LATER",
        });
      }
      if (
        isGenerationAccountingError(error) &&
        error.code === "INSUFFICIENT_CREDITS"
      ) {
        return toolFail(res, 403, "No credits remaining", {
          requestId,
          stage: "finalize",
          status: "processing",
          progress: 90,
          code: "FORBIDDEN",
        });
      }
      throw error;
    }

    logToolEvent("info", {
      tool: "generation",
      requestId,
      userId,
      stage: "finalize",
      status: "completed",
      elapsedMs: Date.now() - startTime,
    });
    return toolOk(res, {
      requestId,
      stage: "finalize",
      status: "completed",
      progress: 100,
      durationMs: Date.now() - startTime,
      result: finalScripts,
      output: finalScripts,
      creditsUsed: isUnlimited ? 0 : GENERATION_COST,
      qualitySignals: deriveGenerationQualitySignals(finalScripts),
    });
  } catch (error) {
    logToolEvent("error", {
      tool: "generation",
      requestId,
      stage: "failed",
      status: "failed",
      errorClass: classifyOpenAiError(error),
      message: safeErrorSummary(error),
      elapsedMs: Date.now() - startTime,
    });

    return toolFail(res, 500, "Internal server error", {
      requestId,
      stage: "failed",
      status: "failed",
      progress: 0,
      code: "INTERNAL_ERROR",
    });
  }
});

function deriveGenerationQualitySignals(
  scripts: Array<{
    hook?: string
    retentionScore?: number
    controversyScore?: number
    hashtags?: string[]
  }>
) {
  const signals: string[] = []
  const topRetention = scripts.reduce(
    (max, item) => Math.max(max, item.retentionScore ?? 0),
    0
  )
  const avgControversy =
    scripts.reduce((sum, item) => sum + (item.controversyScore ?? 0), 0) /
    Math.max(1, scripts.length)
  if (topRetention >= 80) signals.push("high_retention_hooks")
  if (avgControversy >= 6) signals.push("strong_comment_triggers")
  if (scripts.some((item) => (item.hook ?? "").length >= 18)) {
    signals.push("curiosity_gap_openers")
  }
  if (scripts.some((item) => (item.hashtags ?? []).length >= 5)) {
    signals.push("distribution_ready_tags")
  }
  if (signals.length === 0) signals.push("balanced_script_set")
  return signals.slice(0, 6)
}

export default router;