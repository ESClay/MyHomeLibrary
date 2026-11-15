import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { OUTPUT_SCHEMA, parseModelOutput, type DetectedBook } from "./identify-schema";
import type { ModelImageType } from "@/lib/scan/photo";

/** The one place the model is named. */
export const IDENTIFY_MODEL = "claude-opus-5-5";
/** Beta that turns on server-side refusal fallbacks (`fallbacks: "default"`). */
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";
/** Thinking tokens count toward this, so it leaves room for a full shelf. */
export const IDENTIFY_MAX_TOKENS = 16000;

export const SYSTEM_PROMPT = `You read photographs of books for a home-library app. A photo shows one front cover, a stack of books, or a shelf of spines. List every distinct book you can see.

Rules:
- Read only what is printed on the books. Never invent, complete or correct a title, author, series or ISBN from memory. If you recognise a book but cannot read its text in the photo, do not report text you cannot see.
- A spine or cover that is partly hidden, blurred, glared, too small or at a steep angle gets a low confidence (below 0.5) with only the words you can actually read. A book you cannot read at all is left out.
- confidence is 0 to 1: 0.9 or more when title and author are clearly legible, about 0.5 to 0.8 when you had to piece the title together, below 0.5 when you are unsure.
- kind is "cover" when the front cover is visible and "spine" when only the spine shows.
- index is the book's position in reading order: left to right along a shelf, shelf by shelf from the top, starting at 0.
- isbn only when the digits are printed and fully legible (for example on a back cover). Otherwise null.
- series and seriesPosition only when printed on the book. Otherwise null.
- One entry per physical book. Two copies of the same title are two entries.
- If the photo shows no books, return an empty list.`;

export type IdentifyKind = "busy" | "timeout" | "refused" | "too_long" | "bad_image" | "empty_answer" | "bad_answer" | "config" | "failed";

export type IdentifyUsage = { inputTokens: number; outputTokens: number };

/** A failure with a message that is safe to show the person. */
export class IdentifyError extends Error {
  constructor(
    readonly kind: IdentifyKind,
    message: string,
    /** Tokens already spent when the failure came after the model answered; they still cost money. */
    readonly usage?: IdentifyUsage,
  ) {
    super(message);
    this.name = "IdentifyError";
  }
}

export type IdentifyResult = {
  books: DetectedBook[];
  /** Entries the model returned that were unusable and discarded. */
  dropped: number;
  usage: IdentifyUsage;
  /** The model that produced the final answer (differs from IDENTIFY_MODEL when a fallback ran). */
  model: string;
};

type CreateParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
/** The slice of the SDK this module uses, so tests can pass a stand-in. */
export type IdentifyClient = {
  beta: { messages: { create: (body: CreateParams) => PromiseLike<Anthropic.Beta.Messages.BetaMessage> } };
};

let shared: Anthropic | null = null;
function defaultClient(): IdentifyClient {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new IdentifyError("config", "Photo recognition is not set up on this server yet.");
  }
  // One retry covers a blip; the SDK already backs off. The generous timeout fits a full shelf at high effort.
  shared ??= new Anthropic({ maxRetries: 1, timeout: 240_000 });
  return shared as unknown as IdentifyClient;
}

export function buildRequest(imageBase64: string, mediaType: ModelImageType): CreateParams {
  return {
    model: IDENTIFY_MODEL,
    max_tokens: IDENTIFY_MAX_TOKENS,
    betas: [FALLBACK_BETA],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    output_config: { effort: "high", format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } },
          { type: "text", text: "List the books in this photo." },
        ],
      },
    ],
  };
}

/** Turns an SDK failure into an IdentifyError with a friendly message. */
export function toIdentifyError(e: unknown): IdentifyError {
  if (e instanceof IdentifyError) return e;
  if (e instanceof Anthropic.RateLimitError || e instanceof Anthropic.OverloadedError) {
    return new IdentifyError("busy", "Photo reading is busy right now. Give it a minute and try again.");
  }
  if (e instanceof Anthropic.APIConnectionTimeoutError) {
    return new IdentifyError("timeout", "Reading that photo took too long. Try a closer photo of fewer books.");
  }
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    return new IdentifyError("config", "Photo recognition is not set up on this server yet.");
  }
  if (e instanceof Anthropic.BadRequestError) {
    return new IdentifyError("bad_image", "That photo could not be read. Try taking it again.");
  }
  if (e instanceof Anthropic.InternalServerError || e instanceof Anthropic.APIConnectionError) {
    return new IdentifyError("busy", "Photo reading is unavailable for a moment. Try again shortly.");
  }
  return new IdentifyError("failed", "Something went wrong reading that photo. Try again.");
}

/** Sends one photo to the model and returns the books it read, in shelf order. Throws IdentifyError. */
export async function identifyBooks(
  image: { base64: string; mediaType: ModelImageType },
  opts: { client?: IdentifyClient } = {},
): Promise<IdentifyResult> {
  let response: Anthropic.Beta.Messages.BetaMessage;
  try {
    const client = opts.client ?? defaultClient();
    response = await client.beta.messages.create(buildRequest(image.base64, image.mediaType));
  } catch (e) {
    throw toIdentifyError(e);
  }

  const usage = { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens };

  // Look at why it stopped before touching the content.
  if (response.stop_reason === "refusal") {
    throw new IdentifyError("refused", "Claude could not read that photo. Try a different one.", usage);
  }
  if (response.stop_reason === "max_tokens") {
    throw new IdentifyError("too_long", "That shelf has more books than could be read in one go. Try a closer photo of part of it.", usage);
  }
  if (response.stop_reason !== "end_turn") {
    throw new IdentifyError("failed", "Reading that photo did not finish. Try again.", usage);
  }

  const text = response.content.find((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === "text");
  if (!text) throw new IdentifyError("empty_answer", "Nothing came back for that photo. Try again.", usage);

  const parsed = parseModelOutput(text.text);
  if (!parsed.ok) throw new IdentifyError("bad_answer", "The answer for that photo was garbled. Try again.", usage);

  return { books: parsed.books, dropped: parsed.dropped, usage, model: response.model };
}
