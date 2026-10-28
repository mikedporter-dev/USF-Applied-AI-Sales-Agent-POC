import { SIGNAL_LABELS } from "../src/shared/scoring";
import type { ScoredAccount } from "../src/shared/types";
import type { Env } from "./env";

// NVIDIA's hosted API (build.nvidia.com) is OpenAI-compatible:
// POST {NVIDIA_BASE_URL}/chat/completions with a Bearer key.

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export async function chat(env: Env, messages: ChatMessage[], maxTokens = 500): Promise<string> {
  if (!env.NVIDIA_API_KEY) throw new Error("NVIDIA_API_KEY is not configured");

  const res = await fetch(`${env.NVIDIA_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.NVIDIA_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: env.NVIDIA_MODEL, messages, temperature: 0.2, max_tokens: maxTokens }),
  });
  if (!res.ok) throw new Error(`NVIDIA API ${res.status}: ${await res.text()}`);

  const data = (await res.json()) as { choices: { message: { content: string } }[] };
  return data.choices[0]?.message.content ?? "";
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
