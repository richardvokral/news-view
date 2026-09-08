import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { isKnownSite, defaultSiteId } from "@/lib/plausible";
import { getApiConfig } from "@/lib/storage/settings";
import {
  TOOL_SCHEMAS,
  executeTool,
  summariseToolResult,
} from "@/lib/analyze/tools";
import { buildSystemPrompt } from "@/lib/analyze/prompt";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MODEL = "claude-sonnet-4-6";
const MAX_ITERATIONS = 8;
const MAX_HISTORY_TURNS = 20;

interface HistoryMessage {
  role: "user" | "assistant";
  content: string;
}

interface RequestBody {
  question?: unknown;
  period?: unknown;
  date?: unknown;
  site?: unknown;
  history?: unknown;
}

function sanitiseHistory(raw: unknown): HistoryMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: HistoryMessage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const role = (item as { role?: unknown }).role;
    const content = (item as { content?: unknown }).content;
    if (
      (role === "user" || role === "assistant") &&
      typeof content === "string" &&
      content.length > 0
    ) {
      out.push({ role, content });
    }
  }
  // Keep only the most recent N turns (a "turn" = 2 messages).
  const sliceFrom = Math.max(0, out.length - MAX_HISTORY_TURNS * 2);
  return out.slice(sliceFrom);
}

export async function POST(req: NextRequest) {
  // Analyze runs Claude tool-use over the same Plausible data as /reports, so
  // it takes the same grant. Checking only for a login let any signed-in user
  // with zero section grants spend Anthropic tokens.
  const session = await getSession();
  if (!session.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!session.sections.includes("reports")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question) {
    return NextResponse.json({ error: "question is required" }, { status: 400 });
  }
  const period = typeof body.period === "string" ? body.period : "30d";
  const date = typeof body.date === "string" ? body.date : undefined;
  const requestedSite =
    typeof body.site === "string" ? body.site : defaultSiteId();
  if (!requestedSite || !isKnownSite(requestedSite)) {
    return NextResponse.json(
      { error: "Unknown site. Configure PLAUSIBLE_SITE_IDS." },
      { status: 400 }
    );
  }
  const siteId: string = requestedSite;
  const history = sanitiseHistory(body.history);

  const config = await getApiConfig();
  const apiKey = config.clustering.anthropicApiKey;
  if (!apiKey) {
    return NextResponse.json(
      { error: "AI not configured (ANTHROPIC_API_KEY missing)" },
      { status: 503 }
    );
  }

  const client = new Anthropic({ apiKey });
  const today = new Date().toISOString().slice(0, 10);
  const system = buildSystemPrompt({ siteId, period, date, today });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const emit = (event: Record<string, unknown>) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
        );
      };

      try {
        emit({
          step: "start",
          siteId,
          period,
          date: date ?? null,
          model: MODEL,
          ts: Date.now(),
        });

        const messages: Anthropic.MessageParam[] = [
          ...history.map((h) => ({ role: h.role, content: h.content })),
          { role: "user" as const, content: question },
        ];

        let finalAnswer = "";
        let stopped = false;

        for (let iter = 0; iter < MAX_ITERATIONS; iter += 1) {
          emit({
            step: "ai_request",
            iter,
            messageCount: messages.length,
            ts: Date.now(),
          });

          let response: Anthropic.Message;
          try {
            response = await client.messages.create({
              model: MODEL,
              max_tokens: 2048,
              system,
              tools: TOOL_SCHEMAS,
              messages,
            });
          } catch (err) {
            emit({
              step: "error",
              scope: "anthropic",
              message: err instanceof Error ? err.message : String(err),
              ts: Date.now(),
            });
            stopped = true;
            break;
          }

          const textParts: string[] = [];
          const toolUses: { id: string; name: string; input: unknown }[] = [];
          for (const block of response.content) {
            if (block.type === "text") textParts.push(block.text);
            else if (block.type === "tool_use") {
              toolUses.push({
                id: block.id,
                name: block.name,
                input: block.input,
              });
            }
          }

          emit({
            step: "ai_response",
            iter,
            stop_reason: response.stop_reason,
            text: textParts.join("\n").slice(0, 4000),
            tool_uses: toolUses.map((t) => ({
              id: t.id,
              name: t.name,
              input: t.input,
            })),
            usage: response.usage,
            ts: Date.now(),
          });

          if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
            finalAnswer = textParts.join("\n").trim();
            emit({ step: "answer", text: finalAnswer, ts: Date.now() });
            stopped = true;
            break;
          }

          messages.push({ role: "assistant", content: response.content });

          const toolResults: Anthropic.ToolResultBlockParam[] = [];
          for (const tu of toolUses) {
            emit({
              step: "tool_request",
              iter,
              tool_use_id: tu.id,
              name: tu.name,
              input: tu.input,
              ts: Date.now(),
            });
            try {
              const data = await executeTool(tu.name, tu.input, siteId);
              emit({
                step: "tool_response",
                iter,
                tool_use_id: tu.id,
                name: tu.name,
                preview: summariseToolResult(data),
                ts: Date.now(),
              });
              toolResults.push({
                type: "tool_result",
                tool_use_id: tu.id,
                content: JSON.stringify(data),
              });
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              emit({
                step: "tool_error",
                iter,
                tool_use_id: tu.id,
                name: tu.name,
                message,
                ts: Date.now(),
              });
              toolResults.push({
                type: "tool_result",
                tool_use_id: tu.id,
                is_error: true,
                content: message,
              });
            }
          }
          messages.push({ role: "user", content: toolResults });
        }

        if (!stopped) {
          emit({
            step: "error",
            scope: "loop",
            message: `Stopped after ${MAX_ITERATIONS} iterations without a final answer.`,
            ts: Date.now(),
          });
        }

        emit({ step: "done", ts: Date.now() });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        try {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                step: "error",
                scope: "fatal",
                message,
                ts: Date.now(),
              })}\n\n`
            )
          );
        } catch {
          // controller may already be closed
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
