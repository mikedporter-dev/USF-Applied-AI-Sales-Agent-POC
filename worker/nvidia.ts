import { SIGNAL_LABELS } from "../src/shared/scoring";
import type { ScoredAccount } from "../src/shared/types";
import type { Env } from "./env";

// NVIDIA's hosted API (build.nvidia.com) is OpenAI-compatible:
// POST {NVIDIA_BASE_URL}/chat/completions with a Bearer key.

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatCompletion {
  choices: {
    finish_reason?: string;
    message: { content: string | null; reasoning_content?: string | null };
  }[];
}

/** Sampling NVIDIA recommends for Nemotron 3.5 Lightning. */
const SAMPLING = { temperature: 1.0, top_p: 0.95 };

const TIMEOUT_MS = 60_000;

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

export async function chat(env: Env, messages: ChatMessage[], maxTokens = 2048): Promise<string> {
  if (!env.NVIDIA_API_KEY) throw new Error("NVIDIA_API_KEY is not configured");

  const res = await fetch(`${env.NVIDIA_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.NVIDIA_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: env.NVIDIA_MODEL, messages, max_tokens: maxTokens, ...SAMPLING }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`NVIDIA API ${res.status}: ${await res.text()}`);

  const data = (await res.json()) as ChatCompletion;
  const choice = data.choices[0];
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

/** Draft a why-now outreach angle grounded in the account's SEC signals. */
export function draftOutreachBrief(env: Env, account: ScoredAccount): Promise<string> {
  const signals = account.signals
    .map((s) => `- [${SIGNAL_LABELS[s.kind]}] ${s.summary} (${s.form}${s.section ? `, ${s.section}` : ""}, ${s.filedAt})`)
    .join("\n");
  const warm = account.warmPath ? `${account.warmPath.name}, ${account.warmPath.title}` : "none";
  const target = account.targetContact
    ? `${account.targetContact.name}, ${account.targetContact.title}`
    : "not yet identified";

  return chat(env, [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `Company: ${account.company.name} (${account.company.industry})
Tier ${account.tier}; Fit ${account.scores.fit}, Intent ${account.scores.intent}, Gap ${account.scores.gap}
Warm introduction: ${warm}
Target contact: ${target}
Signals (trailing 12 months):
${signals || "- none"}`,
    },
  ]);
}
