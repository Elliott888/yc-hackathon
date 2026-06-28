import type {
  CompanyResearch,
  Lead,
  PainPoint,
  PainPointSubpoint,
} from "@/lib/workflow";

export const WORKFLOW_SNAPSHOT_VERSION = 1;
export const WORKFLOW_SNAPSHOT_STORAGE_KEY =
  "yc-hackathon.workflow.latest.v1";

type WorkflowSnapshotStage = "entry" | "workspace" | "leads";

type WorkflowChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

export type WorkflowSnapshot = {
  version: typeof WORKFLOW_SNAPSHOT_VERSION;
  savedAt: number;
  stage: WorkflowSnapshotStage;
  websiteInput: string;
  research: CompanyResearch | null;
  painPoints: PainPoint[];
  messages: WorkflowChatMessage[];
  leads: Lead[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isPainPointSubpoint(value: unknown): value is PainPointSubpoint {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.description === "string"
  );
}

function isPainPoint(value: unknown): value is PainPoint {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.description === "string" &&
    Array.isArray(value.subpoints) &&
    value.subpoints.every(isPainPointSubpoint)
  );
}

function isCompanyResearch(value: unknown): value is CompanyResearch {
  return (
    isRecord(value) &&
    typeof value.website === "string" &&
    typeof value.companyName === "string" &&
    typeof value.summary === "string" &&
    isStringArray(value.customers) &&
    Array.isArray(value.painPoints) &&
    value.painPoints.every(isPainPoint)
  );
}

function isWorkflowSnapshotStage(
  value: unknown
): value is WorkflowSnapshotStage {
  return value === "entry" || value === "workspace" || value === "leads";
}

function isWorkflowChatMessage(value: unknown): value is WorkflowChatMessage {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    (value.role === "user" || value.role === "assistant") &&
    typeof value.content === "string"
  );
}

function isLeadEvidence(value: unknown): value is Lead["evidence"][number] {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.painPointId === "string" &&
    typeof value.painPointTitle === "string" &&
    typeof value.score === "number" &&
    typeof value.description === "string" &&
    typeof value.href === "string" &&
    typeof value.source === "string"
  );
}

function isLead(value: unknown): value is Lead {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.profile === "string" &&
    typeof value.score === "number" &&
    Array.isArray(value.evidence) &&
    value.evidence.every(isLeadEvidence)
  );
}

function isWorkflowSnapshot(value: unknown): value is WorkflowSnapshot {
  return (
    isRecord(value) &&
    value.version === WORKFLOW_SNAPSHOT_VERSION &&
    typeof value.savedAt === "number" &&
    isWorkflowSnapshotStage(value.stage) &&
    typeof value.websiteInput === "string" &&
    (value.research === null || isCompanyResearch(value.research)) &&
    Array.isArray(value.painPoints) &&
    value.painPoints.every(isPainPoint) &&
    Array.isArray(value.messages) &&
    value.messages.every(isWorkflowChatMessage) &&
    Array.isArray(value.leads) &&
    value.leads.every(isLead)
  );
}

function canUseStorage() {
  return typeof window !== "undefined" && "localStorage" in window;
}

export function loadWorkflowSnapshot() {
  if (!canUseStorage()) {
    return null;
  }

  try {
    const rawSnapshot = window.localStorage.getItem(
      WORKFLOW_SNAPSHOT_STORAGE_KEY
    );

    if (!rawSnapshot) {
      return null;
    }

    const snapshot = JSON.parse(rawSnapshot) as unknown;

    if (isWorkflowSnapshot(snapshot)) {
      return snapshot;
    }

    clearWorkflowSnapshot();
    return null;
  } catch {
    clearWorkflowSnapshot();
    return null;
  }
}

export function saveWorkflowSnapshot(snapshot: WorkflowSnapshot) {
  if (!canUseStorage()) {
    return;
  }

  try {
    window.localStorage.setItem(
      WORKFLOW_SNAPSHOT_STORAGE_KEY,
      JSON.stringify(snapshot)
    );
  } catch {
    // Storage can be full, disabled, or unavailable in private contexts.
  }
}

export function clearWorkflowSnapshot() {
  if (!canUseStorage()) {
    return;
  }

  try {
    window.localStorage.removeItem(WORKFLOW_SNAPSHOT_STORAGE_KEY);
  } catch {
    // Treat storage cleanup as best-effort.
  }
}
