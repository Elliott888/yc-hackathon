export type PainPointSubpoint = {
  id: string;
  title: string;
  description: string;
};

export type PainPoint = {
  id: string;
  title: string;
  description: string;
  subpoints: PainPointSubpoint[];
};

export type CompanyResearch = {
  website: string;
  companyName: string;
  summary: string;
  customers: string[];
  painPoints: PainPoint[];
};

export type ResearchActivityKind =
  | "model"
  | "tool"
  | "reasoning"
  | "output"
  | "status";

export type ResearchActivityStatus =
  | "queued"
  | "running"
  | "done"
  | "warning"
  | "error";

export type ResearchActivity = {
  id: string;
  kind: ResearchActivityKind;
  status: ResearchActivityStatus;
  title: string;
  detail?: string;
  timestamp: number;
};

export type LeadEvidence = {
  id: string;
  painPointId: string;
  painPointTitle: string;
  score: number;
  description: string;
  href: string;
  source: string;
};

export type Lead = {
  id: string;
  name: string;
  profile: string;
  score: number;
  evidence: LeadEvidence[];
};

export function createLocalId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function normalizeWebsite(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return "";
  }

  const withProtocol = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  try {
    const url = new URL(withProtocol);
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

export function normalizeResearchTarget(value: string) {
  return value.trim().replace(/\s+/g, " ");
}
