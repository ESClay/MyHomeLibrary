import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { FALLBACK_BETA } from "./identify";
import type { BuiltPrompt } from "./recommend-prompt";
import { parsePicks, schemaFor, type RawPick, type RecommendScope } from "./recommend-schema";

/** The one place the recommendation model is named (same model as photo recognition). */
export const RECOMMEND_MODEL = "claude-opus-5-5";
/** Thinking tokens count toward this. Kept under the SDK's non-streaming limit (about 21k) so no streaming is needed. */
export const RECOMMEND_MAX_TOKENS = 16000;

export type RecommendKind = "busy" | "timeout" | "refused" | "too_long" | "empty_answer" | "bad_answer" | "bad_request" | "config" | "failed";

export type RecommendUsage = { inputTokens: number; outputTokens: number };

/** A failure with a message that is safe to show the person. */
export class RecommendError extends Error {
  constructor(
    readonly kind: RecommendKind,
    message: string,
    /** Tokens already spent when the failure came after the model answered; they still cost money. */
    readonly usage?: RecommendUsage,
  ) {
    super(message);
    this.name = "RecommendError";
  }
}

export type RecommendResult = {
  picks: RawPick[];
  dropped: number;
  usage: RecommendUsage;
  /** The model that produced the answer (differs from RECOMMEND_MODEL when a fallback ran). */
  model: string;
};

type CreateParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
/** The slice of the SDK this module uses, so tests can pass a stand-in. */
export type RecommendClient = {
  beta: { messages: { create: (body: CreateParams) => PromiseLike<Anthropic.Beta.Messages.BetaMessage> } };
};

/** Whether recommendations can be generated on this server. */
export const recommendConfigured = () => Boolean(process.env.ANTHROPIC_API_KEY);

let shared: Anthropic | null = null;
function defaultClient(): RecommendClient {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new RecommendError("config", "Recommendations are not set up on this server yet.");
  }
  // One retry covers a blip; the SDK already backs off. The timeout fits a high-effort answer.
  shared ??= new Anthropic({ maxRetries: 1, timeout: 240_000 });
  return shared as unknown as RecommendClient;
}

/**
 * The exact request: Opus 5.5, adaptive thinking at high effort, a JSON schema for the answer, server-side refusal
 * fallbacks, and no tools (in particular no web search: picks come from the model's knowledge and are then checked
 * against the catalogue).
 */
export function buildRequest(prompt: Pick<BuiltPrompt, "system" | "user">, scope: RecommendScope): CreateParams {
  return {
    model: RECOMMEND_MODEL,
    max_tokens: RECOMMEND_MAX_TOKENS,
    betas: [FALLBACK_BETA],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    output_config: { effort: "high", format: { type: "json_schema", schema: schemaFor(scope) as unknown as Record<string, unknown> } },
    system: prompt.system,
    messages: [{ role: "user", content: prompt.user }],
  };
}

/** Turns an SDK failure into a RecommendError with a friendly message. */
export function toRecommendError(e: unknown): RecommendError {
  if (e instanceof RecommendError) return e;
  if (e instanceof Anthropic.RateLimitError || e instanceof Anthropic.OverloadedError) {
    return new RecommendError("busy", "Recommendations are busy right now. Give it a minute and try again.");
  }
  if (e instanceof Anthropic.APIConnectionTimeoutError) {
    return new RecommendError("timeout", "Choosing books took too long. Try again in a moment.");
  }
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    return new RecommendError("config", "Recommendations are not set up on this server yet.");
  }
  if (e instanceof Anthropic.BadRequestError) {
    return new RecommendError("bad_request", "That request could not be processed. Try again later.");
  }
  if (e instanceof Anthropic.InternalServerError || e instanceof Anthropic.APIConnectionError) {
    return new RecommendError("busy", "Recommendations are unavailable for a moment. Try again shortly.");
  }
  return new RecommendError("failed", "Something went wrong choosing books. Try again.");
}

/** One model call. Throws RecommendError. */
export async function requestPicks(
  prompt: BuiltPrompt,
  scope: RecommendScope,
  opts: { client?: RecommendClient } = {},
): Promise<RecommendResult> {
  let response: Anthropic.Beta.Messages.BetaMessage;
  try {
    const client = opts.client ?? defaultClient();
    response = await client.beta.messages.create(buildRequest(prompt, scope));
  } catch (e) {
    throw toRecommendError(e);
  }

  const usage = { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens };

  // Look at why it stopped before touching the content.
  if (response.stop_reason === "refusal") {
    throw new RecommendError("refused", "Claude could not make recommendations this time. Try again later.", usage);
  }
  if (response.stop_reason === "max_tokens") {
    throw new RecommendError("too_long", "The answer ran too long and was cut off. Try again.", usage);
  }
  if (response.stop_reason !== "end_turn") {
    throw new RecommendError("failed", "Choosing books did not finish. Try again.", usage);
  }

  const text = response.content.find((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === "text");
  if (!text) throw new RecommendError("empty_answer", "Nothing came back. Try again.", usage);

  const parsed = parsePicks(text.text, scope, prompt.people);
  if (!parsed.ok) throw new RecommendError("bad_answer", "The answer was garbled. Try again.", usage);

  return { picks: parsed.picks, dropped: parsed.dropped, usage, model: response.model };
}

/** US dollars for a call, at Opus 5.5's list prices ($4 / $20 per million tokens). Thinking is billed as output. */
export function estimateCostUsd(u: RecommendUsage): number {
  return (u.inputTokens * 4 + u.outputTokens * 20) / 1_000_000;
}
