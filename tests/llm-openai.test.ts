import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Proves the OpenAI migration of server/_core/llm.ts: every call in these
 * tests goes through the mocked `openai` SDK's `responses.create` — if
 * invokeLLM silently fell back to Anthropic (or anything else), the mock
 * would never be invoked and every assertion below would fail/timeout.
 * No real network/API call is made anywhere in this file.
 */

const mockCreate = vi.fn();

vi.mock("openai", () => {
  class MockOpenAI {
    responses = { create: mockCreate };
    constructor(_opts: { apiKey: string }) {}
  }
  return { default: MockOpenAI };
});

const ORIGINAL_ENV = { ...process.env };

async function freshInvokeLLM() {
  vi.resetModules();
  const mod = await import("../server/_core/llm");
  return mod.invokeLLM;
}

describe("invokeLLM — OpenAI migration (server/_core/llm.ts)", () => {
  beforeEach(() => {
    mockCreate.mockReset();
    process.env.OPENAI_API_KEY = "test-key-123";
    delete process.env.OPENAI_MODEL;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("throws a clear, actionable error when OPENAI_API_KEY is missing — never falls back silently", async () => {
    delete process.env.OPENAI_API_KEY;
    const invokeLLM = await freshInvokeLLM();
    await expect(invokeLLM({ messages: [{ role: "user", content: "hi" }] })).rejects.toThrow(/OPENAI_API_KEY/);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("calls the OpenAI Responses API and maps a plain-text completion", async () => {
    mockCreate.mockResolvedValueOnce({
      id: "resp_1",
      model: "gpt-6.1-sol",
      status: "completed",
      output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "hello there" }] }],
      output_text: "hello there",
      usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    });

    const invokeLLM = await freshInvokeLLM();
    const result = await invokeLLM({ messages: [{ role: "system", content: "sys" }, { role: "user", content: "hi" }] });

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const [body] = mockCreate.mock.calls[0];
    expect(body.model).toBe("gpt-6.1-sol"); // ENV default when no override/env var set
    expect(result.choices[0].message.content).toBe("hello there");
    expect(result.choices[0].finish_reason).toBe("stop");
    expect(result.usage).toEqual({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });
  });

  it("honors OPENAI_MODEL and a per-call model override", async () => {
    process.env.OPENAI_MODEL = "gpt-6-astra";
    mockCreate.mockResolvedValueOnce({
      id: "r", model: "gpt-6-astra", status: "completed",
      output: [], output_text: "", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    });
    const invokeLLM = await freshInvokeLLM();
    await invokeLLM({ messages: [{ role: "user", content: "x" }] });
    expect(mockCreate.mock.calls[0][0].model).toBe("gpt-6-astra");

    mockCreate.mockResolvedValueOnce({
      id: "r2", model: "gpt-5-mini", status: "completed",
      output: [], output_text: "", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    });
    await invokeLLM({ messages: [{ role: "user", content: "x" }], model: "gpt-5-mini" });
    expect(mockCreate.mock.calls[1][0].model).toBe("gpt-5-mini");
  });

  it("sends strict Structured Outputs (text.format json_schema) for outputSchema, and returns the schema-shaped JSON text directly", async () => {
    const schema = { type: "object", properties: { days: { type: "array" } }, required: ["days"] };
    mockCreate.mockResolvedValueOnce({
      id: "r", model: "gpt-6.1-sol", status: "completed",
      output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: '{"days":[]}' }] }],
      output_text: '{"days":[]}',
      usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
    });

    const invokeLLM = await freshInvokeLLM();
    const result = await invokeLLM({
      messages: [{ role: "user", content: "plan" }],
      outputSchema: { name: "itinerary_days", schema, strict: true },
      max_tokens: 16000,
    });

    const body = mockCreate.mock.calls[0][0];
    expect(body.text.format).toEqual({ type: "json_schema", name: "itinerary_days", schema, strict: true });
    expect(body.max_output_tokens).toBe(16000);
    expect(JSON.parse(result.choices[0].message.content as string)).toEqual({ days: [] });
  });

  it("adds the web_search tool with tool_choice auto when enableWebSearch is set, and counts web_search_call outputs into usage", async () => {
    mockCreate.mockResolvedValueOnce({
      id: "r", model: "gpt-5-mini", status: "completed",
      output: [
        { type: "web_search_call", id: "ws1", status: "completed" },
        { type: "message", role: "assistant", content: [{ type: "output_text", text: "found it" }] },
      ],
      output_text: "found it",
      usage: { input_tokens: 50, output_tokens: 10, total_tokens: 60 },
    });

    const invokeLLM = await freshInvokeLLM();
    const result = await invokeLLM({ messages: [{ role: "user", content: "search" }], enableWebSearch: true });

    const body = mockCreate.mock.calls[0][0];
    expect(body.tools).toEqual(expect.arrayContaining([{ type: "web_search" }]));
    expect(body.tool_choice).toBe("auto");
    expect(result.usage?.web_search_requests).toBe(1);
  });

  it("maps function_call output items to tool_calls and finish_reason 'tool_calls'", async () => {
    mockCreate.mockResolvedValueOnce({
      id: "r", model: "gpt-6.1-sol", status: "completed",
      output: [{ type: "function_call", call_id: "call_1", name: "lookup", arguments: '{"q":"paris"}' }],
      output_text: "",
      usage: { input_tokens: 5, output_tokens: 5, total_tokens: 10 },
    });

    const invokeLLM = await freshInvokeLLM();
    const result = await invokeLLM({
      messages: [{ role: "user", content: "x" }],
      tools: [{ type: "function", function: { name: "lookup", parameters: { type: "object" } } }],
    });

    expect(result.choices[0].finish_reason).toBe("tool_calls");
    expect(result.choices[0].message.tool_calls).toEqual([
      { id: "call_1", type: "function", function: { name: "lookup", arguments: '{"q":"paris"}' } },
    ]);
  });

  it("maps an incomplete response (max_output_tokens) to finish_reason 'length' instead of silently returning partial content as success", async () => {
    mockCreate.mockResolvedValueOnce({
      id: "r", model: "gpt-6.1-sol", status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
      output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "partial" }] }],
      output_text: "partial",
      usage: { input_tokens: 10, output_tokens: 16000, total_tokens: 16010 },
    });

    const invokeLLM = await freshInvokeLLM();
    const result = await invokeLLM({ messages: [{ role: "user", content: "x" }] });
    expect(result.choices[0].finish_reason).toBe("length");
  });

  it("throws (never persists/returns silently) when the response status is 'failed'", async () => {
    mockCreate.mockResolvedValueOnce({
      id: "r", model: "gpt-6.1-sol", status: "failed",
      error: { message: "content policy violation" },
      output: [], output_text: "",
    });

    const invokeLLM = await freshInvokeLLM();
    await expect(invokeLLM({ messages: [{ role: "user", content: "x" }] })).rejects.toThrow(/content policy violation/);
  });

  it("surfaces a clear error on a 401 auth failure from the provider", async () => {
    mockCreate.mockRejectedValueOnce({ status: 401, message: "Incorrect API key provided" });
    const invokeLLM = await freshInvokeLLM();
    await expect(invokeLLM({ messages: [{ role: "user", content: "x" }] })).rejects.toThrow(/unauthorized|API key/i);
  });

  it("surfaces a clear error on a 429 rate-limit/quota failure from the provider", async () => {
    mockCreate.mockRejectedValueOnce({ status: 429, message: "Rate limit exceeded" });
    const invokeLLM = await freshInvokeLLM();
    await expect(invokeLLM({ messages: [{ role: "user", content: "x" }] })).rejects.toThrow(/rate limit|quota/i);
  });

  it("propagates a transient/timeout error from the SDK without retrying internally (no unbounded retry at this layer)", async () => {
    const abortErr = Object.assign(new Error("Request timed out"), { name: "AbortError" });
    mockCreate.mockRejectedValueOnce(abortErr);
    const invokeLLM = await freshInvokeLLM();
    await expect(invokeLLM({ messages: [{ role: "user", content: "x" }] })).rejects.toThrow(/timed out/i);
    expect(mockCreate).toHaveBeenCalledTimes(1); // exactly one attempt — retry policy lives in the one-shot repair loop, not here
  });

  it("passes a per-request timeout option through to the SDK call when timeoutMs is set", async () => {
    mockCreate.mockResolvedValueOnce({
      id: "r", model: "gpt-5-mini", status: "completed",
      output: [], output_text: "", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    });
    const invokeLLM = await freshInvokeLLM();
    await invokeLLM({ messages: [{ role: "user", content: "x" }], timeoutMs: 25000 });
    expect(mockCreate.mock.calls[0][1]).toEqual({ timeout: 25000 });
  });

  it("passes reasoning.effort through to the SDK call when reasoningEffort is set (itinerary-generation latency fix)", async () => {
    mockCreate.mockResolvedValueOnce({
      id: "r", model: "gpt-6.1-sol", status: "completed",
      output: [], output_text: "", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    });
    const invokeLLM = await freshInvokeLLM();
    await invokeLLM({ messages: [{ role: "user", content: "x" }], reasoningEffort: "low" });
    expect(mockCreate.mock.calls[0][0]).toMatchObject({ reasoning: { effort: "low" } });
  });

  it("omits reasoning entirely when reasoningEffort isn't set — no behavior change for existing callers", async () => {
    mockCreate.mockResolvedValueOnce({
      id: "r", model: "gpt-6.1-sol", status: "completed",
      output: [], output_text: "", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    });
    const invokeLLM = await freshInvokeLLM();
    await invokeLLM({ messages: [{ role: "user", content: "x" }] });
    expect(mockCreate.mock.calls[0][0]).not.toHaveProperty("reasoning");
  });
});
