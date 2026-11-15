import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { buildRequest, FALLBACK_BETA, identifyBooks, IDENTIFY_MODEL, IdentifyError, SYSTEM_PROMPT, type IdentifyClient } from "./identify";

// The Anthropic client is always a stand-in here: no test ever reaches the network.

const reply = (over: Record<string, unknown> = {}) =>
  ({
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: IDENTIFY_MODEL,
    stop_reason: "end_turn",
    stop_details: null,
    content: [
      {
        type: "text",
        text: JSON.stringify({
          books: [{ title: "Dune", authors: ["Frank Herbert"], series: null, seriesPosition: null, isbn: null, confidence: 0.9, kind: "cover", index: 0 }],
        }),
      },
    ],
    usage: { input_tokens: 1200, output_tokens: 340 },
    ...over,
  }) as never;

const clientReturning = (r: unknown): IdentifyClient & { create: ReturnType<typeof vi.fn> } => {
  const create = vi.fn().mockResolvedValue(r);
  return { beta: { messages: { create } }, create };
};
const clientThrowing = (e: unknown): IdentifyClient => ({ beta: { messages: { create: vi.fn().mockRejectedValue(e) } } });

const image = { base64: "QUJD", mediaType: "image/jpeg" as const };
const apiError = (status: number) => Anthropic.APIError.generate(status, { type: "error", error: { type: "x", message: "m" } }, "m", new Headers());

describe("request", () => {
  it("uses Opus 5.5 with adaptive thinking, high effort, structured output and server-side fallbacks", () => {
    const req = buildRequest("QUJD", "image/png");
    expect(req.model).toBe("claude-opus-5-5");
    expect(req.thinking).toEqual({ type: "adaptive" });
    expect(req.output_config?.effort).toBe("high");
    expect(req.output_config?.format?.type).toBe("json_schema");
    expect(req.betas).toEqual([FALLBACK_BETA]);
    expect(FALLBACK_BETA).toBe("server-side-fallback-2026-07-01");
    expect(req.fallbacks).toBe("default");
    expect(req.system).toBe(SYSTEM_PROMPT);
  });

  it("sends the photo as a base64 image block", () => {
    const req = buildRequest("QUJD", "image/webp");
    const content = (req.messages[0].content as { type: string; source?: unknown }[])[0];
    expect(content).toEqual({ type: "image", source: { type: "base64", media_type: "image/webp", data: "QUJD" } });
  });

  it("tells the model to read only what is printed and to mark doubt with low confidence", () => {
    expect(SYSTEM_PROMPT).toMatch(/Never invent/);
    expect(SYSTEM_PROMPT).toMatch(/low confidence/);
  });
});

describe("identifyBooks", () => {
  it("returns the books and the token usage", async () => {
    const client = clientReturning(reply());
    const r = await identifyBooks(image, { client });
    expect(client.create).toHaveBeenCalledTimes(1);
    expect(r.books.map((b) => b.title)).toEqual(["Dune"]);
    expect(r.usage).toEqual({ inputTokens: 1200, outputTokens: 340 });
  });

  it("surfaces a refusal as a friendly error, with the tokens it cost", async () => {
    const err = await identifyBooks(image, { client: clientReturning(reply({ stop_reason: "refusal", content: [] })) }).catch((e) => e);
    expect(err).toBeInstanceOf(IdentifyError);
    expect(err).toMatchObject({ kind: "refused", usage: { inputTokens: 1200, outputTokens: 340 } });
  });

  it("does not read a truncated answer", async () => {
    const err = await identifyBooks(image, { client: clientReturning(reply({ stop_reason: "max_tokens", content: [{ type: "text", text: '{"books":[' }] })) }).catch((e) => e);
    expect(err).toMatchObject({ kind: "too_long" });
  });

  it("rejects stop reasons it does not expect", async () => {
    const err = await identifyBooks(image, { client: clientReturning(reply({ stop_reason: "pause_turn" })) }).catch((e) => e);
    expect(err).toMatchObject({ kind: "failed" });
  });

  it("rejects an answer with no text block", async () => {
    const err = await identifyBooks(image, { client: clientReturning(reply({ content: [{ type: "thinking", thinking: "", signature: "s" }] })) }).catch((e) => e);
    expect(err).toMatchObject({ kind: "empty_answer" });
  });

  it("rejects an answer that is not valid output", async () => {
    const err = await identifyBooks(image, { client: clientReturning(reply({ content: [{ type: "text", text: "Sorry, I can't" }] })) }).catch((e) => e);
    expect(err).toMatchObject({ kind: "bad_answer" });
  });

  it("treats an empty shelf as a result, not an error", async () => {
    const r = await identifyBooks(image, { client: clientReturning(reply({ content: [{ type: "text", text: '{"books":[]}' }] })) });
    expect(r.books).toEqual([]);
  });

  it("maps a rate limit to a friendly 'busy, try again'", async () => {
    const err = await identifyBooks(image, { client: clientThrowing(apiError(429)) }).catch((e) => e);
    expect(err).toBeInstanceOf(IdentifyError);
    expect(err.kind).toBe("busy");
    expect(err.message).toMatch(/busy.*try again/i);
  });

  it("maps overload and server errors to busy, auth errors to config, bad requests to bad_image", async () => {
    expect((await identifyBooks(image, { client: clientThrowing(apiError(529)) }).catch((e) => e)).kind).toBe("busy");
    expect((await identifyBooks(image, { client: clientThrowing(apiError(500)) }).catch((e) => e)).kind).toBe("busy");
    expect((await identifyBooks(image, { client: clientThrowing(apiError(401)) }).catch((e) => e)).kind).toBe("config");
    expect((await identifyBooks(image, { client: clientThrowing(apiError(400)) }).catch((e) => e)).kind).toBe("bad_image");
  });

  it("maps a timeout and anything unknown", async () => {
    expect((await identifyBooks(image, { client: clientThrowing(new Anthropic.APIConnectionTimeoutError()) }).catch((e) => e)).kind).toBe("timeout");
    expect((await identifyBooks(image, { client: clientThrowing(new Error("boom")) }).catch((e) => e)).kind).toBe("failed");
  });
});
