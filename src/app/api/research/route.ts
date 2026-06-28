import type { ResponseStreamEvent } from "openai/resources/responses/responses";

import { getOpenAIClient, getOpenAIModel } from "@/lib/openai";
import {
  normalizeWebsite,
  type CompanyResearch,
  type ResearchActivity,
  type ResearchActivityKind,
  type ResearchActivityStatus,
} from "@/lib/workflow";

type ResearchPainPoint = {
  title: string;
  description: string;
  subpoints: Array<{
    title: string;
    description: string;
  }>;
};

type ResearchOutput = {
  companyName: string;
  summary: string;
  customers: string[];
  painPoints: ResearchPainPoint[];
};

type ResponseOutputItem = Extract<
  ResponseStreamEvent,
  { type: "response.output_item.done" }
>["item"];

const RESEARCH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["companyName", "summary", "customers", "painPoints"],
  properties: {
    companyName: {
      type: "string",
      description: "The company or product name.",
    },
    summary: {
      type: "string",
      description:
        "A concise explanation of what the company does and who it serves.",
    },
    customers: {
      type: "array",
      description:
        "Customer segments, buyer personas, or team types likely to use the product.",
      items: { type: "string" },
    },
    painPoints: {
      type: "array",
      description:
        "Developer pain points the product solves, with code-level manifestations.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "description", "subpoints"],
        properties: {
          title: {
            type: "string",
            description: "A short editable pain-point title.",
          },
          description: {
            type: "string",
            description:
              "What this pain point means in practical developer workflow terms.",
          },
          subpoints: {
            type: "array",
            description:
              "Examples of how this pain point shows up in code, repo structure, CI, APIs, infrastructure, or developer workflows.",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["title", "description"],
              properties: {
                title: {
                  type: "string",
                  description: "A compact code-level example title.",
                },
                description: {
                  type: "string",
                  description:
                    "Specific technical symptoms or examples developers would recognize.",
                },
              },
            },
          },
        },
      },
    },
  },
} as const;

const RESEARCH_INSTRUCTIONS =
  "You are a senior developer-marketing researcher. Research the official site and relevant public web results, then return concise developer pain points only in the requested schema. Keep every string short. Return 4 to 5 pain points. Return 2 to 3 subpoints per pain point.";

function cleanText(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : fallback;
}

function truncateText(value: string, maxLength = 220) {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1)}...`;
}

function companyNameFromWebsite(website: string) {
  const hostname = new URL(website).hostname.replace(/^www\./, "");
  const label = hostname.split(".")[0] ?? hostname;

  return label
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function normalizeResearch(
  website: string,
  parsed: Partial<ResearchOutput>
): CompanyResearch {
  const painPoints = Array.isArray(parsed.painPoints)
    ? parsed.painPoints.slice(0, 8)
    : [];

  return {
    website,
    companyName: cleanText(parsed.companyName, new URL(website).hostname),
    summary: cleanText(
      parsed.summary,
      "Company research completed. Refine the pain points below before finding customers."
    ),
    customers: Array.isArray(parsed.customers)
      ? parsed.customers
          .filter((customer) => typeof customer === "string")
          .map((customer) => customer.trim())
          .filter(Boolean)
          .slice(0, 8)
      : [],
    painPoints: painPoints.map((painPoint, index) => ({
      id: `pain_${index + 1}`,
      title: cleanText(painPoint.title, `Pain point ${index + 1}`),
      description: cleanText(
        painPoint.description,
        "Describe what this developer pain point means."
      ),
      subpoints: Array.isArray(painPoint.subpoints)
        ? painPoint.subpoints.slice(0, 6).map((subpoint, subpointIndex) => ({
            id: `pain_${index + 1}_sub_${subpointIndex + 1}`,
            title: cleanText(
              subpoint.title,
              `Code example ${subpointIndex + 1}`
            ),
            description: cleanText(
              subpoint.description,
              "Describe how this appears in code."
            ),
          }))
        : [],
    })),
  };
}

function createFallbackResearch(website: string): CompanyResearch {
  const companyName = companyNameFromWebsite(website);

  return {
    website,
    companyName,
    summary:
      "Research returned incomplete structured data. Confirm the website, then edit these starter pain points before finding customers.",
    customers: ["Developer teams", "Platform teams", "Engineering leaders"],
    painPoints: [
      {
        id: "pain_1",
        title: "Unclear integration friction",
        description:
          "Developers lose time when APIs, SDK setup, or docs do not map cleanly to their stack.",
        subpoints: [
          {
            id: "pain_1_sub_1",
            title: "Boilerplate setup",
            description:
              "Configuration, environment variables, or SDK clients are repeated across services.",
          },
          {
            id: "pain_1_sub_2",
            title: "Weak type boundaries",
            description:
              "Runtime payload mismatches show up as defensive parsing and manual validation code.",
          },
        ],
      },
      {
        id: "pain_2",
        title: "Workflow handoffs break context",
        description:
          "Teams struggle when product behavior depends on manual steps across code, deploys, and operations.",
        subpoints: [
          {
            id: "pain_2_sub_1",
            title: "Manual runbooks",
            description:
              "Repeated shell commands, scripts, or checklist comments sit outside the main app flow.",
          },
          {
            id: "pain_2_sub_2",
            title: "CI/CD drift",
            description:
              "Build, preview, and production environments rely on slightly different assumptions.",
          },
        ],
      },
      {
        id: "pain_3",
        title: "Limited operational visibility",
        description:
          "Engineering teams cannot quickly see where customer-impacting behavior is failing.",
        subpoints: [
          {
            id: "pain_3_sub_1",
            title: "Sparse instrumentation",
            description:
              "Logs and metrics do not preserve enough request, user, or deployment context.",
          },
          {
            id: "pain_3_sub_2",
            title: "Ad hoc debugging",
            description:
              "Developers reproduce issues locally instead of tracing failures through production systems.",
          },
        ],
      },
    ],
  };
}

function parseResearchOutput(website: string, outputText: string) {
  if (!outputText.trim()) {
    return {
      research: createFallbackResearch(website),
      warning: "The model completed without structured research output.",
    };
  }

  try {
    const parsed = JSON.parse(outputText) as Partial<ResearchOutput>;
    const research = normalizeResearch(website, parsed);

    if (research.painPoints.length === 0) {
      return {
        research: createFallbackResearch(website),
        warning: "The model returned no editable pain points.",
      };
    }

    return { research };
  } catch {
    return {
      research: createFallbackResearch(website),
      warning:
        "The model returned incomplete structured JSON, so starter pain points were generated instead.",
    };
  }
}

function createActivity({
  id,
  kind,
  status,
  title,
  detail,
}: {
  id: string;
  kind: ResearchActivityKind;
  status: ResearchActivityStatus;
  title: string;
  detail?: string;
}): ResearchActivity {
  return {
    id,
    kind,
    status,
    title,
    detail,
    timestamp: Date.now(),
  };
}

function sendStreamEvent(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  event: "activity" | "final" | "error",
  data: unknown
) {
  controller.enqueue(
    encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  );
}

function safeUrlLabel(value: string) {
  try {
    const url = new URL(value);
    return url.hostname.replace(/^www\./, "");
  } catch {
    return value;
  }
}

function describeWebSearchItem(item: ResponseOutputItem) {
  if (item.type !== "web_search_call") {
    return "";
  }

  const { action } = item;

  if (!action) {
    return "Web search tool call created.";
  }

  if (action.type === "search") {
    const queries = action.queries?.length
      ? action.queries
      : action.query
        ? [action.query]
        : [];
    const sources = action.sources?.length ?? 0;

    if (queries.length > 0 && sources > 0) {
      return `Search: ${truncateText(queries.slice(0, 2).join(", "), 120)}. Sources: ${sources}.`;
    }

    if (queries.length > 0) {
      return `Search: ${truncateText(queries.slice(0, 2).join(", "), 120)}.`;
    }

    return sources > 0
      ? `Searched public web sources: ${sources}.`
      : "Searching public web results.";
  }

  if (action.type === "open_page") {
    return action.url
      ? `Opened page: ${safeUrlLabel(action.url)}.`
      : "Opened a search result page.";
  }

  return `Find in page: ${truncateText(action.pattern, 100)} on ${safeUrlLabel(
    action.url
  )}.`;
}

function responseErrorMessage(
  response: Extract<
    ResponseStreamEvent,
    { type: "response.failed" | "response.incomplete" }
  >["response"]
) {
  if (response.error?.message) {
    return response.error.message;
  }

  if (response.incomplete_details?.reason) {
    return `Response incomplete: ${response.incomplete_details.reason}.`;
  }

  return "The research request failed.";
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { website?: unknown };
    const website =
      typeof body.website === "string" ? normalizeWebsite(body.website) : "";

    if (!website) {
      return Response.json(
        { error: "Enter a valid website URL." },
        { status: 400 }
      );
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let outputText = "";
        let hasOutputActivity = false;
        let finished = false;
        const reasoningSummaries = new Map<string, string>();

        const emitActivity = (activity: ResearchActivity) => {
          sendStreamEvent(controller, encoder, "activity", { activity });
        };

        const emitFinal = (research: CompanyResearch) => {
          sendStreamEvent(controller, encoder, "final", { research });
        };

        const emitError = (message: string) => {
          sendStreamEvent(controller, encoder, "error", { message });
        };

        const finishWithOutput = (rawOutputText: string) => {
          const { research, warning } = parseResearchOutput(
            website,
            rawOutputText
          );

          if (warning) {
            emitActivity(
              createActivity({
                id: "structured-output-warning",
                kind: "output",
                status: "warning",
                title: "Structured output fallback",
                detail: warning,
              })
            );
          }

          emitFinal(research);
          finished = true;
        };

        try {
          emitActivity(
            createActivity({
              id: "queued",
              kind: "status",
              status: "queued",
              title: "Queued research run",
              detail: website,
            })
          );

          const responseStream = await getOpenAIClient().responses.create(
            {
              model: getOpenAIModel(),
              instructions: RESEARCH_INSTRUCTIONS,
              input: `Research this website: ${website}\n\nUnderstand what the company does, who buys or uses it, which developer workflows it affects, and the developer pain points it solves. Focus on pain points that can be recognized in source code, APIs, CI/CD, architecture, observability, data pipelines, infrastructure, SDK use, or local developer experience. Keep descriptions under 24 words.`,
              tools: [{ type: "web_search", search_context_size: "low" }],
              tool_choice: "required",
              include: [
                "web_search_call.action.sources",
                "web_search_call.results",
              ],
              stream: true,
              store: false,
              max_output_tokens: 5000,
              reasoning: {
                effort: "low",
                summary: "concise",
              },
              text: {
                verbosity: "low",
                format: {
                  type: "json_schema",
                  name: "company_research",
                  strict: true,
                  schema: RESEARCH_SCHEMA,
                },
              },
            },
            { signal: request.signal }
          );

          for await (const event of responseStream) {
            if (request.signal.aborted || finished) {
              break;
            }

            switch (event.type) {
              case "response.queued":
                emitActivity(
                  createActivity({
                    id: "queued",
                    kind: "status",
                    status: "queued",
                    title: "Queued research run",
                    detail: `Response ${event.response.id}`,
                  })
                );
                break;

              case "response.created":
              case "response.in_progress":
                emitActivity(
                  createActivity({
                    id: "responses-run",
                    kind: "model",
                    status: "running",
                    title: "Responses run started",
                    detail: `Model: ${getOpenAIModel()}`,
                  })
                );
                break;

              case "response.output_item.added":
                if (event.item.type === "web_search_call") {
                  emitActivity(
                    createActivity({
                      id: `tool-${event.item.id}`,
                      kind: "tool",
                      status: "running",
                      title: "web_search call created",
                      detail:
                        describeWebSearchItem(event.item) ||
                        "Preparing a hosted OpenAI web search call.",
                    })
                  );
                }
                break;

              case "response.web_search_call.in_progress":
                emitActivity(
                  createActivity({
                    id: `tool-${event.item_id}`,
                    kind: "tool",
                    status: "running",
                    title: "web_search in progress",
                    detail: "Preparing public web research.",
                  })
                );
                break;

              case "response.web_search_call.searching":
                emitActivity(
                  createActivity({
                    id: `tool-${event.item_id}`,
                    kind: "tool",
                    status: "running",
                    title: "web_search searching",
                    detail: "Searching company pages and public context.",
                  })
                );
                break;

              case "response.web_search_call.completed":
                emitActivity(
                  createActivity({
                    id: `tool-${event.item_id}`,
                    kind: "tool",
                    status: "done",
                    title: "web_search completed",
                    detail: "Public context retrieved for analysis.",
                  })
                );
                break;

              case "response.output_item.done":
                if (event.item.type === "web_search_call") {
                  emitActivity(
                    createActivity({
                      id: `tool-${event.item.id}`,
                      kind: "tool",
                      status:
                        event.item.status === "failed" ? "error" : "done",
                      title: "web_search call finished",
                      detail:
                        describeWebSearchItem(event.item) ||
                        `Status: ${event.item.status}.`,
                    })
                  );
                }
                break;

              case "response.reasoning_summary_text.delta": {
                const id = `reasoning-${event.output_index}-${event.summary_index}`;
                const detail = truncateText(
                  `${reasoningSummaries.get(id) ?? ""}${event.delta}`
                );

                reasoningSummaries.set(id, detail);
                emitActivity(
                  createActivity({
                    id,
                    kind: "reasoning",
                    status: "running",
                    title: "Thinking through developer workflows",
                    detail,
                  })
                );
                break;
              }

              case "response.reasoning_summary_text.done":
                emitActivity(
                  createActivity({
                    id: `reasoning-${event.output_index}-${event.summary_index}`,
                    kind: "reasoning",
                    status: "done",
                    title: "Thinking summary",
                    detail: truncateText(event.text),
                  })
                );
                break;

              case "response.output_text.delta":
                outputText += event.delta;

                if (!hasOutputActivity) {
                  emitActivity(
                    createActivity({
                      id: "structured-output",
                      kind: "output",
                      status: "running",
                      title: "Structuring pain points",
                      detail:
                        "Building the editable company summary, customers, pain points, and code examples.",
                    })
                  );
                  hasOutputActivity = true;
                }
                break;

              case "response.output_text.done":
                outputText = event.text;
                emitActivity(
                  createActivity({
                    id: "structured-output",
                    kind: "output",
                    status: "done",
                    title: "Structured pain points complete",
                    detail:
                      "Received the editable company summary, customers, pain points, and code examples.",
                  })
                );
                break;

              case "response.completed":
                finishWithOutput(event.response.output_text || outputText);
                break;

              case "response.incomplete":
                emitActivity(
                  createActivity({
                    id: "response-incomplete",
                    kind: "status",
                    status: "warning",
                    title: "Response ended incomplete",
                    detail: responseErrorMessage(event.response),
                  })
                );
                finishWithOutput(event.response.output_text || outputText);
                break;

              case "response.failed":
                throw new Error(responseErrorMessage(event.response));

              case "error":
                throw new Error(event.message);
            }
          }

          if (!finished && !request.signal.aborted) {
            finishWithOutput(outputText);
          }
        } catch (error) {
          if (!request.signal.aborted) {
            const message =
              error instanceof Error
                ? error.message
                : "The research request failed.";

            emitActivity(
              createActivity({
                id: "research-error",
                kind: "status",
                status: "error",
                title: "Research failed",
                detail: message,
              })
            );
            emitError(message);
          }
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "The research request failed.";

    return Response.json({ error: message }, { status: 500 });
  }
}
