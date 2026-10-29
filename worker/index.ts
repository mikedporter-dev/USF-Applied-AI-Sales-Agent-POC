import { parseApprovalRequest } from "../src/shared/approval";
import { SAMPLE_ACCOUNTS, SAMPLE_AS_OF } from "../src/shared/sampleData";
import { scoreAccounts } from "../src/shared/scoring";
import type { AccountsResponse, ApprovalResponse } from "../src/shared/types";
import type { Env } from "./env";
import { chat, draftOutreachBrief, parseChatMessage } from "./nvidia";
import * as supabase from "./supabase";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

async function rankedAccounts(env: Env): Promise<AccountsResponse> {
  if (supabase.isConfigured(env)) {
    const asOf = new Date();
    return {
      source: "supabase",
      asOf: asOf.toISOString(),
      accounts: scoreAccounts(await supabase.loadAccountInputs(env), asOf),
    };
  }
  return {
    source: "sample",
    asOf: SAMPLE_AS_OF.toISOString(),
    accounts: scoreAccounts(SAMPLE_ACCOUNTS, SAMPLE_AS_OF),
  };
}

async function handleApi(request: Request, env: Env, path: string): Promise<Response> {
  if (path === "/api/health" && request.method === "GET") {
    return json({
      ok: true,
      integrations: {
        nvidia: Boolean(env.NVIDIA_API_KEY),
        supabase: supabase.isConfigured(env),
      },
    });
  }

  if (path === "/api/accounts" && request.method === "GET") {
    return json(await rankedAccounts(env));
  }

  if (path === "/api/contacts/approval" && request.method === "POST") {
    if (!supabase.isConfigured(env)) {
      return json({ error: "Approvals aren't saved for sample data. Connect Supabase to store them." }, 409);
    }
    const parsed = parseApprovalRequest(await request.json().catch(() => null));
    if (typeof parsed === "string") return json({ error: parsed }, 400);
    const body: ApprovalResponse = { contacts: await supabase.setApproval(env, parsed) };
    return json(body);
  }

  // Plain chat with the NVIDIA model. GET /api/chat?message=... is handy from a browser;
  // POST {"message": "..."} for code.
  if (path === "/api/chat" && (request.method === "GET" || request.method === "POST")) {
    if (!env.NVIDIA_API_KEY) {
      return json({ error: "The NVIDIA API key isn't configured yet. Set the NVIDIA_API_KEY secret." }, 503);
    }
    const raw =
      request.method === "GET"
        ? new URL(request.url).searchParams.get("message")
        : ((await request.json().catch(() => null)) as { message?: unknown } | null)?.message;
    const parsed = parseChatMessage(raw);
    if (typeof parsed === "string") return json({ error: parsed }, 400);
    const reply = await chat(env, [{ role: "user", content: parsed.message }]);
    return json({ model: env.NVIDIA_MODEL, reply });
  }

  const brief = path.match(/^\/api\/accounts\/(\d{10})\/brief$/);
  if (brief && request.method === "POST") {
    if (!env.NVIDIA_API_KEY) {
      return json({ error: "The NVIDIA API key isn't configured yet. Set NVIDIA_API_KEY to enable briefs." }, 503);
    }
    const { accounts } = await rankedAccounts(env);
    const account = accounts.find((a) => a.company.cik === brief[1]);
    if (!account) return json({ error: "Account not found" }, 404);
    return json({ brief: await draftOutreachBrief(env, account) });
  }

  return json({ error: "Not found" }, 404);
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

    try {
      return await handleApi(request, env, url.pathname);
    } catch (err) {
      console.error(err);
      return json({ error: err instanceof Error ? err.message : "Internal error" }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
