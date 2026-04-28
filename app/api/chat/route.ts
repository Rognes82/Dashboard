import { NextResponse } from "next/server";
import { getActiveProfile } from "@/lib/llm/profiles";
import { streamChatForProfile } from "@/lib/llm/chat";
import { assembleContext } from "@/lib/llm/retrieval";
import { buildSystemPrompt, buildUserMessage } from "@/lib/llm/prompt";
import { getBinById } from "@/lib/queries/bins";
import { hasMachineKey } from "@/lib/llm/encryption";
import { badRequest, isNonEmptyString, readJson } from "@/lib/validation";
import { getVaultPath } from "@/lib/vault/path";

export const dynamic = "force-dynamic";
const VAULT_PATH = getVaultPath();

interface ChatRequest {
  messages: { role: "user" | "assistant"; content: string }[];
  scope_bin_id?: string | null;
}

export async function POST(req: Request) {
  if (!hasMachineKey()) {
    return NextResponse.json(
      { error: "machine-key missing or unreadable; cannot decrypt profile key" },
      { status: 500 }
    );
  }
  const profile = getActiveProfile();
  if (!profile) {
    return NextResponse.json({ error: "no active llm profile; configure one in Settings" }, { status: 400 });
  }

  const body = (await readJson(req)) as ChatRequest | null;
  if (!body || !Array.isArray(body.messages) || body.messages.length === 0) {
    return badRequest("messages required");
  }
  const lastUserMsg = [...body.messages].reverse().find((m) => m.role === "user");
  if (!lastUserMsg || !isNonEmptyString(lastUserMsg.content, 8000)) {
    return badRequest("last message must be a non-empty user message (<=8000 chars)");
  }

  let scopePath: string | null = null;
  if (body.scope_bin_id) {
    const bin = getBinById(body.scope_bin_id);
    if (bin) scopePath = bin.name;
  }

  const contextNotes = assembleContext({
    query: lastUserMsg.content,
    scope_bin_id: body.scope_bin_id ?? null,
    vault_path: VAULT_PATH,
    max_context_tokens: profile.max_context_tokens,
  });

  const systemPrompt = buildSystemPrompt({ user_name: "Carter", scope_path: scopePath });
  const userMessage = buildUserMessage({
    question: lastUserMsg.content,
    context_notes: contextNotes,
  });

  const llmMessages = [
    { role: "system" as const, content: systemPrompt },
    ...body.messages.slice(0, -1).map((m) => ({ role: m.role, content: m.content })),
    { role: "user" as const, content: userMessage },
  ];

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const cited_notes = contextNotes.map((n) => n.vault_path);
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({ type: "retrieved", paths: cited_notes })}\n\n`
        )
      );
      try {
        for await (const chunk of streamChatForProfile({ profile, messages: llmMessages })) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "error", message: msg })}\n\n`)
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
