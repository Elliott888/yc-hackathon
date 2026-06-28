import type { EasyInputMessage } from "openai/resources/responses/responses";

import { getOpenAIClient, getOpenAIModel } from "@/lib/openai";
import type { PainPoint } from "@/lib/workflow";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

const MAX_MESSAGES = 24;
const MAX_MESSAGE_CHARS = 4000;
const SYSTEM_PROMPT =
  "You are a concise, practical GTM research assistant. Help refine developer pain points and code-level examples. Answer directly, keep formatting readable, and ask a clarifying question only when needed.";

function readMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((message): message is ChatMessage => {
      if (!message || typeof message !== "object") {
        return false;
      }

      const candidate = message as Partial<ChatMessage>;

      return (
        (candidate.role === "user" || candidate.role === "assistant") &&
        typeof candidate.content === "string" &&
        candidate.content.trim().length > 0
      );
    })
    .slice(-MAX_MESSAGES)
    .map((message) => ({
      role: message.role,
      content: message.content.slice(0, MAX_MESSAGE_CHARS),
    }));
}

function readPainPoints(value: unknown): PainPoint[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((painPoint): painPoint is PainPoint => {
      if (!painPoint || typeof painPoint !== "object") {
        return false;
      }

      const candidate = painPoint as Partial<PainPoint>;

      return (
        typeof candidate.title === "string" &&
        typeof candidate.description === "string" &&
        Array.isArray(candidate.subpoints)
      );
    })
    .slice(0, 12)
    .map((painPoint) => ({
      ...painPoint,
      title: painPoint.title.slice(0, 160),
      description: painPoint.description.slice(0, 500),
      subpoints: painPoint.subpoints
        .filter(
          (subpoint) =>
            subpoint &&
            typeof subpoint.title === "string" &&
            typeof subpoint.description === "string"
        )
        .slice(0, 8)
        .map((subpoint) => ({
          ...subpoint,
          title: subpoint.title.slice(0, 160),
          description: subpoint.description.slice(0, 500),
        })),
    }));
}

function buildPainPointContext(painPoints: PainPoint[]) {
  if (painPoints.length === 0) {
    return "";
  }

  return `\n\nCurrent editable pain points:\n${painPoints
    .map(
      (painPoint, index) =>
        `${index + 1}. ${painPoint.title}: ${painPoint.description}\n${painPoint.subpoints
          .map(
            (subpoint) =>
              `   - Code example: ${subpoint.title}: ${subpoint.description}`
          )
          .join("\n")}`
    )
    .join("\n")}`;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      messages?: unknown;
      painPoints?: unknown;
    };
    const messages = readMessages(body.messages);
    const painPoints = readPainPoints(body.painPoints);

    if (messages.length === 0 || messages.at(-1)?.role !== "user") {
      return Response.json(
        { error: "Send at least one user message." },
        { status: 400 }
      );
    }

    const input: EasyInputMessage[] = messages.map((message) => ({
      role: message.role,
      content: message.content,
    }));

    const events = await getOpenAIClient().responses.create(
      {
        model: getOpenAIModel(),
        instructions: `${SYSTEM_PROMPT}${buildPainPointContext(painPoints)}`,
        input,
        stream: true,
        store: false,
        max_output_tokens: 900,
        reasoning: {
          effort: "low",
        },
        text: {
          verbosity: "low",
        },
      },
      { signal: request.signal }
    );

    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const event of events) {
            if (event.type === "response.output_text.delta") {
              controller.enqueue(encoder.encode(event.delta));
            }

            if (event.type === "response.failed") {
              throw new Error(event.response.error?.message ?? "Response failed.");
            }
          }

          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "The chat request failed.";

    return Response.json({ error: message }, { status: 500 });
  }
}
