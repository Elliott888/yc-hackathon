import { fetchGithubIntentLeads } from "@/lib/github-intent-leads";
import type { PainPoint } from "@/lib/workflow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function readPainPoints(value: unknown): PainPoint[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((painPoint): painPoint is PainPoint => {
    if (!painPoint || typeof painPoint !== "object") {
      return false;
    }

    const candidate = painPoint as Partial<PainPoint>;
    return (
      typeof candidate.id === "string" &&
      typeof candidate.title === "string" &&
      typeof candidate.description === "string" &&
      Array.isArray(candidate.subpoints)
    );
  });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    painPoints?: unknown;
    companyName?: unknown;
  };
  const painPoints = readPainPoints(body.painPoints);
  const companyName =
    typeof body.companyName === "string" ? body.companyName : undefined;

  try {
    const leads = await fetchGithubIntentLeads({
      painPoints,
      companyName,
      limit: 10,
    });

    return Response.json(
      {
        leads,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Lead fetch failed.";

    return Response.json(
      {
        error: message,
      },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  }
}
