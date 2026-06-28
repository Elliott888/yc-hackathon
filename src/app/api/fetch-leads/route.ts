import type { Lead, PainPoint } from "@/lib/workflow";

function readPainPointTitles(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((painPoint): painPoint is PainPoint => {
      if (!painPoint || typeof painPoint !== "object") {
        return false;
      }

      return typeof (painPoint as Partial<PainPoint>).title === "string";
    })
    .map((painPoint) => painPoint.title.trim())
    .filter(Boolean);
}

function createPlaceholderLeads(painPointTitles: string[]): Lead[] {
  const selectedPainPoints =
    painPointTitles.length > 0
      ? painPointTitles
      : [
          "Developer workflow friction",
          "Scaling internal tooling",
          "Reliability and velocity gaps",
        ];

  function evidenceForLead({
    leadId,
    name,
    baseScore,
    sourceDomain,
  }: {
    leadId: string;
    name: string;
    baseScore: number;
    sourceDomain: string;
  }) {
    return selectedPainPoints.map((painPointTitle, index) => {
      const score = Math.max(52, Math.min(96, baseScore - index * 5));

      return {
        id: `${leadId}_evidence_${index + 1}`,
        painPointId: `pain_${index + 1}`,
        painPointTitle,
        score,
        description: `${name} shows public buying intent for ${painPointTitle.toLowerCase()} through hiring, product messaging, or engineering content.`,
        href: `https://${sourceDomain}/signals/${index + 1}`,
        source: `${sourceDomain} signal ${index + 1}`,
      };
    });
  }

  function createLead({
    id,
    name,
    profile,
    baseScore,
    sourceDomain,
  }: {
    id: string;
    name: string;
    profile: string;
    baseScore: number;
    sourceDomain: string;
  }): Lead {
    const evidence = evidenceForLead({ leadId: id, name, baseScore, sourceDomain });
    const score = Math.round(
      evidence.reduce((total, item) => total + item.score, 0) / evidence.length
    );

    return {
      id,
      name,
      profile,
      score,
      evidence,
    };
  }

  return [
    createLead({
      id: "lead_1",
      name: "Northstar Cloud",
      profile: "Platform engineering team evaluating workflow consolidation",
      baseScore: 88,
      sourceDomain: "northstar.example",
    }),
    createLead({
      id: "lead_2",
      name: "RelayStack",
      profile: "API infrastructure group with reliability and integration work",
      baseScore: 81,
      sourceDomain: "relaystack.example",
    }),
    createLead({
      id: "lead_3",
      name: "ForgeLayer",
      profile: "Developer tools buyer scaling internal engineering systems",
      baseScore: 74,
      sourceDomain: "forgelayer.example",
    }),
  ];
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    painPoints?: unknown;
  };
  const painPointTitles = readPainPointTitles(body.painPoints);

  return Response.json(
    {
      leads: createPlaceholderLeads(painPointTitles),
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}
