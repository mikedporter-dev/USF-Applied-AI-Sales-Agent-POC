import { SIGNAL_LABELS } from "../src/shared/scoring";
import type { ScoredAccount } from "../src/shared/types";
import type { Env } from "./env";

// NVIDIA's hosted API (build.nvidia.com) is OpenAI-compatible:
// POST {NVIDIA_BASE_URL}/chat/completions with a Bearer key.

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

/** A conversation turn in an agent loop, including tool calls and their results. */
export type AgentMessage =
  | ChatMessage
  | { role: "assistant"; content: string | null; tool_calls: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface ToolDefinition {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

interface ChatCompletion {
  choices: {
    finish_reason?: string;
    message: { content: string | null; reasoning_content?: string | null; tool_calls?: ToolCall[] };
  }[];
}

export interface AgentTurn {
  /** Final-answer text with any reasoning removed. */
  content: string;
  toolCalls: ToolCall[];
  finishReason?: string;
}

/** One turn of an agent loop: the model either calls tools or answers. */
export async function chatWithTools(
  env: Env,
  messages: AgentMessage[],
  tools: ToolDefinition[],
  options: ChatOptions = {},
): Promise<AgentTurn> {
  const choice = await complete(env, { messages, tools }, options);
  return {
    content: finalAnswer(choice?.message.content),
    toolCalls: choice?.message.tool_calls ?? [],
    finishReason: choice?.finish_reason,
  };
}

/** Sampling NVIDIA recommends for Nemotron 3.5 Lightning. */
const SAMPLING = { temperature: 1.0, top_p: 0.95 };

const TIMEOUT_MS = 60_000;

export interface ChatOptions {
  /** Covers thinking plus the answer when thinking is on. */
  maxTokens?: number;
  /** Nemotron thinks before answering by default; false asks for a direct answer. */
  thinking?: boolean;
  /** How long to wait for an answer. */
  timeoutMs?: number;
}

/** Longest message accepted by /api/chat. */
export const MAX_CHAT_MESSAGE_CHARS = 4000;

/**
 * Keep only the final answer. Reasoning models may return their thinking in a
 * separate reasoning_content field (ignored here) or inline in <think> tags,
 * which are left unclosed if the token limit cuts the thinking short.
 */
export function finalAnswer(content: string | null | undefined): string {
  return (content ?? "")
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/<think>[\s\S]*$/, "")
    .trim();
}

async function complete(
  env: Env,
  body: { messages: unknown[]; tools?: ToolDefinition[] },
  { maxTokens = 8192, thinking = true, timeoutMs = TIMEOUT_MS }: ChatOptions,
): Promise<ChatCompletion["choices"][number] | undefined> {
  if (!env.NVIDIA_API_KEY) throw new Error("NVIDIA_API_KEY is not configured");

  const res = await fetch(`${env.NVIDIA_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.NVIDIA_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: env.NVIDIA_MODEL,
      ...body,
      ...(body.tools ? { tool_choice: "auto" } : {}),
      max_tokens: maxTokens,
      ...SAMPLING,
      ...(thinking ? {} : { chat_template_kwargs: { enable_thinking: false } }),
    }),
    signal: AbortSignal.timeout(timeoutMs),
  }).catch((err: unknown) => {
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new Error(`NVIDIA didn't answer within ${Math.round(timeoutMs / 1000)} seconds`);
    }
    throw err;
  });
  if (!res.ok) throw new Error(`NVIDIA API ${res.status}: ${await res.text()}`);
  return ((await res.json()) as ChatCompletion).choices[0];
}

export async function chat(env: Env, messages: ChatMessage[], options: ChatOptions = {}): Promise<string> {
  const maxTokens = options.maxTokens ?? 8192;
  const choice = await complete(env, { messages }, options);
  const answer = finalAnswer(choice?.message.content);
  if (!answer && choice?.finish_reason === "length") {
    throw new Error(`The model used all ${maxTokens} tokens before answering. Raise max_tokens.`);
  }
  return answer;
}

/** Validate a /api/chat message. Returns the message, or an error string. */
export function parseChatMessage(message: unknown): { message: string } | string {
  if (typeof message !== "string" || !message.trim()) return "message must be a non-empty string";
  if (message.length > MAX_CHAT_MESSAGE_CHARS) return `message must be at most ${MAX_CHAT_MESSAGE_CHARS} characters`;
  return { message: message.trim() };
}

const SYSTEM_PROMPT = `You help a business development leader who sells AI transformation services.
Write a short outreach angle for one account using ONLY the filing signals provided.
Do not invent facts, numbers, or people. Cite the form and date for each claim.
Format: one sentence on why now, then two or three bullets on the AI ambition-to-results gap,
then one sentence suggesting how to use the warm introduction.`;

/**
 * Draft a why-now outreach angle grounded in the account's SEC signals.
 * Thinking is off: the answer is short and built only from evidence we supply,
 * and with thinking on the model spent its whole token limit before answering.
 */
export function draftOutreachBrief(env: Env, account: ScoredAccount): Promise<string> {
  const signals = account.signals
    .map((s) => `- [${SIGNAL_LABELS[s.kind]}] ${s.summary} (${s.form}${s.section ? `, ${s.section}` : ""}, ${s.filedAt})`)
    .join("\n");
  const warm = account.warmPath ? `${account.warmPath.name}, ${account.warmPath.title}` : "none";
  const target = account.targetContact
    ? `${account.targetContact.name}, ${account.targetContact.title}`
    : "not yet identified";

  const prompt = `Company: ${account.company.name} (${account.company.industry})
Tier ${account.tier}; Fit ${account.scores.fit}, Intent ${account.scores.intent}, Gap ${account.scores.gap}
Warm introduction: ${warm}
Target contact: ${target}
Signals (trailing 12 months):
${signals || "- none"}`;

  return chat(
    env,
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ],
    { maxTokens: 1024, thinking: false },
  );
}
