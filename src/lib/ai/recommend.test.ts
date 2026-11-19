import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { buildPersonalPrompt } from "./recommend-prompt";
import { RECOMMEND_MAX_TOKENS, RECOMMEND_MODEL, RecommendError, buildRequest, estimateCostUsd, requestPicks, toRecommendError, type RecommendClient } from "./recommend";

const prompt = buildPersonalPrompt({ person: { id: "a", name: "Alice" }, rows: [], library: [], feedback: [] });

type Msg = Awaited<ReturnType<RecommendClient["beta"]["messages"]["create"]>>;
function message(over: Partial<Msg> & { text?: string | null }): Msg {
  const { text, ...rest } = over;
  return {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: RECOMMEND_MODEL,
    content: text === null ? [] : [{ type: "text", text: text ?? '{"picks":[]}', citations: null }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 1000, output_tokens: 500 },
    ...rest,
  } as unknown as Msg;
}
const clientReturning = (m: Msg | (() => never)): RecommendClient => ({
  beta: { messages: { create: vi.fn(async () => (typeof m === "function" ? m() : m)) } },
});

describe("buildRequest", () => {
  it("uses Opus 5.5, adaptive thinking at high effort, a JSON schema, refusal fallbacks and no tools", () => {
    const body = buildRequest(prompt, "personal");
    expect(RECOMMEND_MODEL).toBe("claude-opus-5-5");
    expect(body.model).toBe("claude-opus-5-5");
    expect(body.thinking).toEqual({ type: "adaptive" });
    expect(body.output_config?.effort).toBe("high");
    expect(body.output_config?.format).toMatchObject({ type: "json_schema" });
    expect(body.fallbacks).toBe("default");
    expect(body.betas).toContain("server-side-fallback-2026-07-01");
    expect(body.max_tokens).toBe(RECOMMEND_MAX_TOKENS);
    expect("tools" in body).toBe(false);
    expect(body).not.toHaveProperty("temperature");
    expect(body.messages).toEqual([{ role: "user", content: prompt.user }]);
    expect(body.system).toBe(prompt.system);
  });

  it("uses the shared schema for the shared scope", () => {
    const body = buildRequest(prompt, "shared");
    expect(JSON.stringify(body.output_config?.format)).toContain('"fit"');
  });
});

describe("requestPicks", () => {
  const good = JSON.stringify({ picks: [{ category: "shelves", title: "Piranesi", authors: ["Susanna Clarke"], reason: "Because.", series: null, seriesPosition: null }] });

  it("parses a normal answer and reports usage and the serving model", async () => {
    const r = await requestPicks(prompt, "personal", { client: clientReturning(message({ text: good, model: "claude-opus-4-8" })) });
    expect(r.picks.map((p) => p.title)).toEqual(["Piranesi"]);
    expect(r.usage).toEqual({ inputTokens: 1000, outputTokens: 500 });
    expect(r.model).toBe("claude-opus-4-8");
  });

  it("keeps only picks in the groups the prompt asked for", async () => {
    const text = JSON.stringify({
      picks: ["shelves", "ratings"].map((category) => ({ category, title: `T ${category}`, authors: ["A"], reason: "r", series: null, seriesPosition: null })),
    });
    // The empty prompt has no ratings, so only "shelves" was asked for.
    expect(prompt.categories).toEqual(["shelves"]);
    const r = await requestPicks(prompt, "personal", { client: clientReturning(message({ text })) });
    expect(r.picks.map((p) => p.category)).toEqual(["shelves"]);
    expect(r.dropped).toBe(1);
  });

  it("checks stop_reason before reading content", async () => {
    await expect(requestPicks(prompt, "personal", { client: clientReturning(message({ stop_reason: "refusal", text: good })) })).rejects.toMatchObject({ kind: "refused", usage: { inputTokens: 1000 } });
    await expect(requestPicks(prompt, "personal", { client: clientReturning(message({ stop_reason: "max_tokens", text: good })) })).rejects.toMatchObject({ kind: "too_long" });
    await expect(requestPicks(prompt, "personal", { client: clientReturning(message({ stop_reason: "pause_turn" })) })).rejects.toMatchObject({ kind: "failed" });
  });

  it("types an empty or garbled answer and keeps the tokens spent", async () => {
    await expect(requestPicks(prompt, "personal", { client: clientReturning(message({ text: null })) })).rejects.toMatchObject({ kind: "empty_answer", usage: { outputTokens: 500 } });
    await expect(requestPicks(prompt, "personal", { client: clientReturning(message({ text: "nope" })) })).rejects.toMatchObject({ kind: "bad_answer" });
  });

  it("maps SDK errors to friendly typed errors", () => {
    const h = new Headers();
    expect(toRecommendError(new Anthropic.RateLimitError(429, {}, "x", h)).kind).toBe("busy");
    expect(toRecommendError(new Anthropic.AuthenticationError(401, {}, "x", h)).kind).toBe("config");
    expect(toRecommendError(new Anthropic.BadRequestError(400, {}, "x", h)).kind).toBe("bad_request");
    expect(toRecommendError(new Anthropic.InternalServerError(500, {}, "x", h)).kind).toBe("busy");
    expect(toRecommendError(new Anthropic.APIConnectionTimeoutError({ message: "t" })).kind).toBe("timeout");
    expect(toRecommendError(new Error("boom")).kind).toBe("failed");
    const own = new RecommendError("config", "x");
    expect(toRecommendError(own)).toBe(own);
  });

  it("wraps a thrown SDK error", async () => {
    const client = clientReturning(() => {
      throw new Anthropic.RateLimitError(429, {}, "slow down", new Headers());
    });
    await expect(requestPicks(prompt, "personal", { client })).rejects.toBeInstanceOf(RecommendError);
  });

  it("is not configured without a key", async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      await expect(requestPicks(prompt, "personal")).rejects.toMatchObject({ kind: "config" });
    } finally {
      if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
    }
  });

  it("estimates cost at $4 / $20 per million tokens", () => {
    expect(estimateCostUsd({ inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBe(24);
    expect(estimateCostUsd({ inputTokens: 2000, outputTokens: 3000 })).toBeCloseTo(0.068, 5);
  });
});
