import type { PainPoint } from "@/lib/workflow";

export function buildGithubIntentQuery({
  painPoints,
  companyName,
}: {
  painPoints: PainPoint[];
  companyName?: string;
}) {
  const normalizedPainPoints = painPoints
    .map((painPoint) => ({
      ...painPoint,
      title: painPoint.title.trim(),
      description: painPoint.description.trim(),
      subpoints: painPoint.subpoints
        .map((subpoint) => ({
          ...subpoint,
          title: subpoint.title.trim(),
          description: subpoint.description.trim(),
        }))
        .filter((subpoint) => subpoint.title || subpoint.description),
    }))
    .filter((painPoint) => painPoint.title || painPoint.description);

  const target = companyName?.trim() ? ` for ${companyName.trim()}` : "";
  const painPointLines =
    normalizedPainPoints.length > 0
      ? normalizedPainPoints
          .map((painPoint, painPointIndex) => {
            const header = [
              `${painPointIndex + 1}.`,
              painPoint.title || "Untitled pain point",
              painPoint.description ? `- ${painPoint.description}` : "",
            ]
              .filter(Boolean)
              .join(" ");
            const subpoints = painPoint.subpoints
              .map((subpoint) => {
                const label = subpoint.title || "Code-level signal";
                return `   - ${label}${
                  subpoint.description ? `: ${subpoint.description}` : ""
                }`;
              })
              .join("\n");

            return subpoints ? `${header}\n${subpoints}` : header;
          })
          .join("\n")
      : "1. Developer workflow friction - Find public code activity that suggests urgent developer-tooling pain.";

  return [
    `Find engineers on GitHub${target} with recent public activity showing these developer pain points.`,
    "Return engineers, not companies.",
    "Prioritize evidence from issues, pull requests, comments, commits, and code changes.",
    "Prefer concrete code-level signals over generic repository-topic matches.",
    "",
    "Pain points:",
    painPointLines,
  ].join("\n");
}
