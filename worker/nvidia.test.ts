import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "./env";
import { chat, finalAnswer, parseChatMessage } from "./nvidia";

const env = {
  NVIDIA_BASE_URL: "https://integrate.api.nvidia.com/v1",
  NVIDIA_MODEL: "nvidia/nemotron-3.5-lightning-30b-a3b",
  NVIDIA_API_KEY: "nvapi-test",
} as Env;

const completion = (content: string | null, finish_reason = "stop") =>
  new Response(JSON.stringify({ choices: [{ finish_reason, message: { content } }] }));

afterEach(() => vi.unstubAllGlobals());

describe("finalAnswer", () => {
  it("drops closed and unclosed <think> blocks", () => {
    expect(finalAnswer("<think>plan</think>\n\nHello")).toBe("Hello");
    expect(finalAnswer("<think>still thinking")).toBe("");
    expect(finalAnswer(null)).toBe("");
  });
});

describe("chat", () => {
  it("sends the model, key, and sampling settings to NVIDIA", async () => {
    const fetchMock = vi.fn(async () => completion("Hi there"));
    vi.stubGlobal("fetch", fetchMock);

    expect(await chat(env, [{ role: "user", content: "Hello" }])).toBe("Hi there");

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://integrate.api.nvidia.com/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer nvapi-test");
    expect(JSON.parse(init.body as string)).toMatchObject({
      model: "nvidia/nemotron-3.5-lightning-30b-a3b",
      messages: [{ role: "user", content: "Hello" }],
      temperature: 1,
      top_p: 0.95,
    });
  });

  it("asks for a direct answer when thinking is off, and leaves the default alone otherwise", async () => {
    const fetchMock = vi.fn(async () => completion("Hi"));
    vi.stubGlobal("fetch", fetchMock);
    const bodyOf = (call: number) =>
      JSON.parse((fetchMock.mock.calls[call] as unknown as [string, RequestInit])[1].body as string);

    await chat(env, [{ role: "user", content: "Hi" }], { thinking: false, maxTokens: 1024 });
    expect(bodyOf(0)).toMatchObject({ max_tokens: 1024, chat_template_kwargs: { enable_thinking: false } });

    await chat(env, [{ role: "user", content: "Hi" }]);
    expect(bodyOf(1).chat_template_kwargs).toBeUndefined();
    expect(bodyOf(1).max_tokens).toBe(8192);
  });

  it("explains when the token limit is spent on thinking", async () => {
    vi.stubGlobal("fetch", async () => completion("<think>long", "length"));
    await expect(chat(env, [{ role: "user", content: "Hi" }])).rejects.toThrow(/max_tokens/);
  });

  it("surfaces NVIDIA errors", async () => {
    vi.stubGlobal("fetch", async () => new Response("bad key", { status: 401 }));
    await expect(chat(env, [{ role: "user", content: "Hi" }])).rejects.toThrow("NVIDIA API 401: bad key");
  });

  it("refuses to call NVIDIA without a key", async () => {
    await expect(chat({ ...env, NVIDIA_API_KEY: undefined }, [])).rejects.toThrow(/not configured/);
  });
});

describe("parseChatMessage", () => {
  it("accepts and trims a message", () => {
    expect(parseChatMessage("  hello ")).toEqual({ message: "hello" });
  });
  it.each([[undefined], [""], ["   "], [42], ["x".repeat(4001)]])("rejects %j", (m) => {
    expect(typeof parseChatMessage(m)).toBe("string");
  });
});
