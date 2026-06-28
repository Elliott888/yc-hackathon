import OpenAI from "openai";
import type { EasyInputMessage } from "openai/resources/responses/responses";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

const MAX_MESSAGES = 24;
const MAX_MESSAGE_CHARS = 4000;
const SYSTEM_PROMPT =
  "You are a concise, practical assistant in a simple chat UI. Answer directly, keep formatting readable, and ask a clarifying question only when needed.";

let client: OpenAI | null = null;

function getOpenAIClient() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  client ??= new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  return client;
}

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

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { messages?: unknown };
    const messages = readMessages(body.messages);

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
        model: process.env.OPENAI_MODEL ?? "gpt-5.5",
        instructions: SYSTEM_PROMPT,
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
