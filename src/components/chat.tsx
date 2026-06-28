"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ArrowUpIcon,
  ChevronDownIcon,
  DatabaseZapIcon,
  GlobeIcon,
  MessageSquareIcon,
  PlusIcon,
  RotateCwIcon,
  SearchIcon,
  SquareIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Field,
  FieldDescription,
  FieldGroup,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { Message, MessageContent } from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sidebar,
  SidebarContent,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  useSidebar,
} from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  createLocalId,
  normalizeWebsite,
  type CompanyResearch,
  type Lead,
  type PainPoint,
  type PainPointSubpoint,
  type ResearchActivity,
  type ResearchActivityKind,
  type ResearchActivityStatus,
} from "@/lib/workflow";

type Stage = "entry" | "researching" | "workspace" | "finding" | "leads";
type ChatRole = "user" | "assistant";

type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
};

type ChatStatus = "idle" | "streaming" | "error";

type ResearchStreamHandlers = {
  onActivity: (activity: ResearchActivity) => void;
};

type WorkflowContextValue = {
  stage: Stage;
  websiteInput: string;
  research: CompanyResearch | null;
  researchActivities: ResearchActivity[];
  painPoints: PainPoint[];
  messages: ChatMessage[];
  chatInput: string;
  chatStatus: ChatStatus;
  error: string;
  leads: Lead[];
  isChatExpanded: boolean;
  companyName: string;
  setWebsiteInput: (value: string) => void;
  setPainPoints: React.Dispatch<React.SetStateAction<PainPoint[]>>;
  setChatInput: (value: string) => void;
  setIsChatExpanded: (value: boolean) => void;
  handleWebsiteSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  handleChatSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  handleFindCustomers: () => void;
  handleStopChat: () => void;
  handleReset: () => void;
};

const FINDING_MINIMUM_MS = 1600;

const WorkflowContext = React.createContext<WorkflowContextValue | null>(null);

function useWorkflow() {
  const workflow = React.useContext(WorkflowContext);

  if (!workflow) {
    throw new Error("Workflow route components must be used inside WorkflowProvider.");
  }

  return workflow;
}

function createMessage(role: ChatRole, content: string): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content,
  };
}

function createPainPoint(): PainPoint {
  return {
    id: createLocalId("pain"),
    title: "New pain point",
    description: "Describe the developer workflow problem this product solves.",
    subpoints: [createSubpoint()],
  };
}

function createSubpoint(): PainPointSubpoint {
  return {
    id: createLocalId("code"),
    title: "Code-level example",
    description: "Describe how this issue appears in code or infrastructure.",
  };
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function createResearchActivity({
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

function createInitialResearchActivities(website: string): ResearchActivity[] {
  return [
    createResearchActivity({
      id: "client-submit",
      kind: "status",
      status: "done",
      title: `Submitted ${website}`,
    }),
  ];
}

function upsertResearchActivity(
  current: ResearchActivity[],
  activity: ResearchActivity
) {
  const existingIndex = current.findIndex((item) => item.id === activity.id);

  if (existingIndex === -1) {
    return [...current, activity];
  }

  return current.map((item, index) =>
    index === existingIndex ? { ...item, ...activity } : item
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isResearchActivity(value: unknown): value is ResearchActivity {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.kind === "string" &&
    typeof value.status === "string" &&
    typeof value.title === "string" &&
    typeof value.timestamp === "number"
  );
}

function isCompanyResearch(value: unknown): value is CompanyResearch {
  return (
    isRecord(value) &&
    typeof value.website === "string" &&
    typeof value.companyName === "string" &&
    typeof value.summary === "string" &&
    Array.isArray(value.customers) &&
    Array.isArray(value.painPoints)
  );
}

function parseServerSentEvent(rawEvent: string) {
  const lines = rawEvent.split(/\r?\n/);
  const event =
    lines
      .find((line) => line.startsWith("event:"))
      ?.slice("event:".length)
      .trim() ?? "message";
  const data = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trimStart())
    .join("\n");

  if (!data) {
    return null;
  }

  return { event, data };
}

async function readResearchStream(
  response: Response,
  handlers: ResearchStreamHandlers
) {
  if (!response.body) {
    throw new Error("Research did not return a stream.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let research: CompanyResearch | null = null;

  while (true) {
    const { done, value } = await reader.read();

    if (value) {
      buffer += decoder.decode(value, { stream: true });
    }

    if (done) {
      buffer += decoder.decode();
    }

    let boundaryIndex = buffer.indexOf("\n\n");

    while (boundaryIndex !== -1) {
      const rawEvent = buffer.slice(0, boundaryIndex);
      buffer = buffer.slice(boundaryIndex + 2);
      boundaryIndex = buffer.indexOf("\n\n");

      const parsedEvent = parseServerSentEvent(rawEvent);

      if (!parsedEvent) {
        continue;
      }

      const data = JSON.parse(parsedEvent.data) as unknown;

      if (parsedEvent.event === "activity" && isRecord(data)) {
        const activity = data.activity;

        if (isResearchActivity(activity)) {
          handlers.onActivity(activity);
        }
      }

      if (parsedEvent.event === "final" && isRecord(data)) {
        const nextResearch = data.research;

        if (isCompanyResearch(nextResearch)) {
          research = nextResearch;
        }
      }

      if (parsedEvent.event === "error" && isRecord(data)) {
        throw new Error(
          typeof data.message === "string" ? data.message : "Research failed."
        );
      }
    }

    if (done) {
      break;
    }
  }

  if (!research) {
    throw new Error("Research finished without results.");
  }

  return research;
}

function useWorkflowState(): WorkflowContextValue {
  const router = useRouter();
  const [stage, setStage] = React.useState<Stage>("entry");
  const [websiteInput, setWebsiteInput] = React.useState("");
  const [research, setResearch] = React.useState<CompanyResearch | null>(null);
  const [researchActivities, setResearchActivities] = React.useState<
    ResearchActivity[]
  >([]);
  const [painPoints, setPainPoints] = React.useState<PainPoint[]>(() => [
    createPainPoint(),
  ]);
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = React.useState("");
  const [chatStatus, setChatStatus] = React.useState<ChatStatus>("idle");
  const [error, setError] = React.useState("");
  const [leads, setLeads] = React.useState<Lead[]>([]);
  const [isChatExpanded, setIsChatExpanded] = React.useState(false);
  const abortControllerRef = React.useRef<AbortController | null>(null);

  const companyName = research?.companyName ?? "Company";
  const isChatBusy = chatStatus === "streaming";

  async function handleWebsiteSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const website = normalizeWebsite(websiteInput);

    if (!website) {
      setError("Enter a valid website.");
      return;
    }

    setError("");
    setResearchActivities(createInitialResearchActivities(website));
    setStage("researching");

    try {
      const response = await fetch("/api/research", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ website }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? "Research failed.");
      }

      const nextResearch = await readResearchStream(response, {
        onActivity: (activity) =>
          setResearchActivities((current) =>
            upsertResearchActivity(current, activity)
          ),
      });
      const nextPainPoints =
        nextResearch.painPoints.length > 0
          ? nextResearch.painPoints
          : [createPainPoint()];

      setResearch(nextResearch);
      setPainPoints(nextPainPoints);
      setMessages([
        createMessage(
          "assistant",
          `I researched ${nextResearch.companyName}. I drafted developer pain points on the left; edit them before finding customers.`
        ),
      ]);
      setStage("workspace");
      router.push("/painpoints");
    } catch (caughtError) {
      const message =
        caughtError instanceof Error ? caughtError.message : "Research failed.";

      setError(message);
      setStage("entry");
    }
  }

  async function handleChatSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const prompt = chatInput.trim();

    if (!prompt || isChatBusy) {
      return;
    }

    const userMessage = createMessage("user", prompt);
    const assistantMessage = createMessage("assistant", "");

    setMessages((currentMessages) => [
      ...currentMessages,
      userMessage,
      assistantMessage,
    ]);
    setChatInput("");
    setChatStatus("streaming");

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: [...messages, userMessage].map(({ role, content }) => ({
            role,
            content,
          })),
          painPoints,
        }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? "The request failed.");
      }

      if (!response.body) {
        throw new Error("The response did not include a stream.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        const chunk = decoder.decode(value, { stream: true });

        setMessages((currentMessages) =>
          currentMessages.map((message) =>
            message.id === assistantMessage.id
              ? { ...message, content: message.content + chunk }
              : message
          )
        );
      }

      setChatStatus("idle");
    } catch (caughtError) {
      if (abortController.signal.aborted) {
        setChatStatus("idle");
        return;
      }

      const message =
        caughtError instanceof Error
          ? caughtError.message
          : "The request failed.";

      setChatStatus("error");
      setMessages((currentMessages) =>
        currentMessages.map((item) =>
          item.id === assistantMessage.id
            ? { ...item, content: `Request failed: ${message}` }
            : item
        )
      );
    } finally {
      abortControllerRef.current = null;
    }
  }

  async function handleFindCustomers() {
    setError("");
    setStage("finding");
    router.push("/table");

    try {
      const startedAt = Date.now();
      const response = await fetch("/api/fetch-leads", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ painPoints }),
      });

      const elapsed = Date.now() - startedAt;

      if (elapsed < FINDING_MINIMUM_MS) {
        await delay(FINDING_MINIMUM_MS - elapsed);
      }

      if (!response.ok) {
        throw new Error("Lead fetch failed.");
      }

      const body = (await response.json()) as { leads?: Lead[] };

      setLeads(body.leads ?? []);
      setIsChatExpanded(false);
      setStage("leads");
    } catch (caughtError) {
      const message =
        caughtError instanceof Error
          ? caughtError.message
          : "Lead fetch failed.";

      setError(message);
      setStage("workspace");
      router.push("/painpoints");
    }
  }

  function handleStopChat() {
    abortControllerRef.current?.abort();
    setChatStatus("idle");
  }

  function handleReset() {
    abortControllerRef.current?.abort();
    setStage("entry");
    setWebsiteInput("");
    setResearch(null);
    setResearchActivities([]);
    setPainPoints([createPainPoint()]);
    setMessages([]);
    setChatInput("");
    setChatStatus("idle");
    setError("");
    setLeads([]);
    setIsChatExpanded(false);
    router.push("/input");
  }

  return {
    stage,
    websiteInput,
    research,
    researchActivities,
    painPoints,
    messages,
    chatInput,
    chatStatus,
    error,
    leads,
    isChatExpanded,
    companyName,
    setWebsiteInput,
    setPainPoints,
    setChatInput,
    setIsChatExpanded,
    handleWebsiteSubmit,
    handleChatSubmit,
    handleFindCustomers,
    handleStopChat,
    handleReset,
  };
}

export function WorkflowProvider({ children }: { children: React.ReactNode }) {
  const workflow = useWorkflowState();

  return (
    <WorkflowContext.Provider value={workflow}>
      {children}
    </WorkflowContext.Provider>
  );
}

export function Chat() {
  return (
    <WorkflowProvider>
      <WorkflowCurrentRoute />
    </WorkflowProvider>
  );
}

function WorkflowCurrentRoute() {
  const workflow = useWorkflow();
  const {
    stage,
    websiteInput,
    error,
    researchActivities,
    painPoints,
  } = workflow;

  if (stage === "entry") {
    return (
      <EntryScreen
        websiteInput={websiteInput}
        error={error}
        onWebsiteInputChange={workflow.setWebsiteInput}
        onSubmit={workflow.handleWebsiteSubmit}
      />
    );
  }

  if (stage === "researching") {
    return (
      <ResearchLoadingScreen
        website={normalizeWebsite(websiteInput)}
        activities={researchActivities}
      />
    );
  }

  if (stage === "finding") {
    return <CustomerSearchLoadingScreen painPoints={painPoints} />;
  }

  if (stage === "leads") {
    return renderLeadsWorkspace(workflow);
  }

  return renderPainPointsWorkspace(workflow);
}

export function WorkflowInputRoute() {
  const workflow = useWorkflow();

  if (workflow.stage === "researching") {
    return (
      <ResearchLoadingScreen
        website={normalizeWebsite(workflow.websiteInput)}
        activities={workflow.researchActivities}
      />
    );
  }

  return (
    <EntryScreen
      websiteInput={workflow.websiteInput}
      error={workflow.error}
      onWebsiteInputChange={workflow.setWebsiteInput}
      onSubmit={workflow.handleWebsiteSubmit}
    />
  );
}

export function WorkflowPainPointsRoute() {
  const workflow = useWorkflow();

  if (workflow.stage === "researching") {
    return (
      <ResearchLoadingScreen
        website={normalizeWebsite(workflow.websiteInput)}
        activities={workflow.researchActivities}
      />
    );
  }

  if (workflow.stage === "finding") {
    return <CustomerSearchLoadingScreen painPoints={workflow.painPoints} />;
  }

  return renderPainPointsWorkspace(workflow);
}

export function WorkflowTableRoute() {
  const workflow = useWorkflow();

  if (workflow.stage === "finding") {
    return <CustomerSearchLoadingScreen painPoints={workflow.painPoints} />;
  }

  return renderLeadsWorkspace(workflow);
}

function renderPainPointsWorkspace(workflow: WorkflowContextValue) {
  return (
    <Workspace
      companyName={workflow.companyName}
      painPoints={workflow.painPoints}
      messages={workflow.messages}
      chatInput={workflow.chatInput}
      chatStatus={workflow.chatStatus}
      error={workflow.error}
      onPainPointsChange={workflow.setPainPoints}
      onFindCustomers={workflow.handleFindCustomers}
      onChatInputChange={workflow.setChatInput}
      onChatSubmit={workflow.handleChatSubmit}
      onStopChat={workflow.handleStopChat}
      onReset={workflow.handleReset}
    />
  );
}

function renderLeadsWorkspace(workflow: WorkflowContextValue) {
  return (
    <LeadsWorkspace
      companyName={workflow.companyName}
      painPoints={workflow.painPoints}
      leads={workflow.leads}
      messages={workflow.messages}
      chatInput={workflow.chatInput}
      chatStatus={workflow.chatStatus}
      isChatExpanded={workflow.isChatExpanded}
      onPainPointsChange={workflow.setPainPoints}
      onFindCustomers={workflow.handleFindCustomers}
      onChatInputChange={workflow.setChatInput}
      onChatSubmit={workflow.handleChatSubmit}
      onStopChat={workflow.handleStopChat}
      onChatExpandedChange={workflow.setIsChatExpanded}
      onReset={workflow.handleReset}
    />
  );
}

function EntryScreen({
  websiteInput,
  error,
  onWebsiteInputChange,
  onSubmit,
}: {
  websiteInput: string;
  error: string;
  onWebsiteInputChange: (value: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <form onSubmit={onSubmit} className="flex w-full max-w-xl flex-col gap-6">
        <div className="flex flex-col gap-2 text-center">
          <h1 className="text-3xl font-semibold tracking-tight">
            Find high-intent buying signals from the code developers write
          </h1>
          <p className="text-muted-foreground">
            Enter a company website. We&apos;ll understand the product, then search
            open-source GitHub activity for code-level patterns that reveal
            developers with high-intent buying signals.
          </p>
        </div>
        <FieldGroup>
          <Field>
            <InputGroup className="h-14 rounded-xl">
              <InputGroupAddon align="inline-start">
                <GlobeIcon aria-hidden="true" />
              </InputGroupAddon>
              <InputGroupInput
                aria-label="Company website"
                placeholder="Enter a website..."
                className="h-14 text-base"
                value={websiteInput}
                onChange={(event) => onWebsiteInputChange(event.target.value)}
              />
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  type="submit"
                  variant="default"
                  size="sm"
                  className="h-12 rounded-lg px-4"
                >
                  <SearchIcon data-icon="inline-start" />
                  Go
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
            {error ? (
              <FieldDescription className="text-destructive">
                {error}
              </FieldDescription>
            ) : null}
          </Field>
        </FieldGroup>
      </form>
    </main>
  );
}

function activityLabel(activity: ResearchActivity) {
  if (activity.title.startsWith("Submitted")) {
    return activity.title;
  }

  switch (activity.title) {
    case "Queued research run":
      return "Queued research";
    case "Responses run started":
      return "Started analysis";
    case "web_search in progress":
      return "Preparing search";
    case "web_search searching":
      return "Searching the web";
    case "web_search completed":
    case "web_search call finished":
      return "Read public web context";
    case "Structuring pain points":
      return "Drafting pain points";
    case "Structured pain points complete":
      return "Drafted pain points";
    case "Thinking through developer workflows":
    case "Thinking summary":
      return "Reasoning about developer workflows";
    case "Structured output fallback":
      return "Using starter pain points";
    case "Response ended incomplete":
      return "Response ended incomplete";
    case "Research failed":
      return "Research failed";
    default:
      return activity.title;
  }
}

function ActivityStatusMark({ status }: { status: ResearchActivityStatus }) {
  if (status === "running" || status === "queued") {
    return <Spinner aria-hidden="true" />;
  }

  return (
    <span
      aria-hidden="true"
      className={cn(
        "size-1.5 rounded-full bg-muted-foreground",
        status === "warning" || status === "error"
          ? "bg-destructive"
          : undefined
      )}
    />
  );
}

function ResearchLoadingScreen({
  website,
  activities,
}: {
  website: string;
  activities: ResearchActivity[];
}) {
  const visibleActivities = activities.slice(-6);

  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <Card className="w-full max-w-xl overflow-hidden">
        <CardHeader className="gap-1">
          <CardTitle>Researching company</CardTitle>
          <CardDescription className="truncate">{website}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border">
            <ScrollArea className="max-h-52">
              <div className="flex flex-col gap-1 p-3">
                {visibleActivities.length > 0 ? (
                  visibleActivities.map((activity) => (
                    <div
                      key={activity.id}
                      className={cn(
                        "flex items-center gap-2 text-sm text-muted-foreground",
                        activity.status === "running"
                          ? "text-foreground"
                          : undefined,
                        activity.status === "warning" ||
                          activity.status === "error"
                          ? "text-destructive"
                          : undefined
                      )}
                    >
                      <span className="flex size-4 shrink-0 items-center justify-center">
                        <ActivityStatusMark status={activity.status} />
                      </span>
                      <span className="truncate">{activityLabel(activity)}</span>
                    </div>
                  ))
                ) : (
                  <div className="flex items-center gap-2 text-sm text-foreground">
                    <span className="flex size-4 shrink-0 items-center justify-center">
                      <Spinner aria-hidden="true" />
                    </span>
                    <span>Starting research</span>
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}

function Workspace({
  companyName,
  painPoints,
  messages,
  chatInput,
  chatStatus,
  error,
  onPainPointsChange,
  onFindCustomers,
  onChatInputChange,
  onChatSubmit,
  onStopChat,
  onReset,
}: {
  companyName: string;
  painPoints: PainPoint[];
  messages: ChatMessage[];
  chatInput: string;
  chatStatus: ChatStatus;
  error: string;
  onPainPointsChange: React.Dispatch<React.SetStateAction<PainPoint[]>>;
  onFindCustomers: () => void;
  onChatInputChange: (value: string) => void;
  onChatSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onStopChat: () => void;
  onReset: () => void;
}) {
  return (
    <main className="grid h-dvh min-h-0 gap-4 p-4 lg:grid-cols-[minmax(340px,420px)_minmax(0,1fr)]">
      <ChatPanel
        companyName={companyName}
        messages={messages}
        input={chatInput}
        status={chatStatus}
        error={error}
        onInputChange={onChatInputChange}
        onSubmit={onChatSubmit}
        onStop={onStopChat}
        onReset={onReset}
      />
      <PainPointsPanel
        companyName={companyName}
        painPoints={painPoints}
        onPainPointsChange={onPainPointsChange}
        onFindCustomers={onFindCustomers}
      />
    </main>
  );
}

function LeadsWorkspace({
  companyName,
  painPoints,
  leads,
  messages,
  chatInput,
  chatStatus,
  isChatExpanded,
  onPainPointsChange,
  onFindCustomers,
  onChatInputChange,
  onChatSubmit,
  onStopChat,
  onChatExpandedChange,
  onReset,
}: {
  companyName: string;
  painPoints: PainPoint[];
  leads: Lead[];
  messages: ChatMessage[];
  chatInput: string;
  chatStatus: ChatStatus;
  isChatExpanded: boolean;
  onPainPointsChange: React.Dispatch<React.SetStateAction<PainPoint[]>>;
  onFindCustomers: () => void;
  onChatInputChange: (value: string) => void;
  onChatSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onStopChat: () => void;
  onChatExpandedChange: (value: boolean) => void;
  onReset: () => void;
}) {
  return (
    <SidebarProvider
      open={isChatExpanded}
      onOpenChange={onChatExpandedChange}
      className="h-dvh min-h-0 overflow-hidden"
      style={
        {
          "--sidebar-width": "28rem",
          "--sidebar-width-icon": "3rem",
        } as React.CSSProperties
      }
    >
      <Sidebar collapsible="icon" className="border-r">
        <SidebarContent className="p-2">
          {isChatExpanded ? (
            <ChatSidebarPanel
              companyName={companyName}
              messages={messages}
              input={chatInput}
              status={chatStatus}
              error=""
              onInputChange={onChatInputChange}
              onSubmit={onChatSubmit}
              onStop={onStopChat}
              onReset={onReset}
            />
          ) : (
            <CollapsedChatSidebarButton />
          )}
        </SidebarContent>
      </Sidebar>
      <SidebarInset className="min-h-0">
        <MobileChatSidebarButton />
        <main className="grid min-h-dvh auto-rows-min gap-4 overflow-y-auto p-4 pt-16 md:pt-4 lg:h-dvh lg:min-h-0 lg:auto-rows-auto lg:grid-cols-[minmax(320px,390px)_minmax(0,1fr)] lg:overflow-hidden">
          <PainPointsPanel
            companyName={companyName}
            painPoints={painPoints}
            onPainPointsChange={onPainPointsChange}
            onFindCustomers={onFindCustomers}
          />
          <LeadsTablePanel companyName={companyName} leads={leads} />
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}

function PainPointsPanel({
  companyName,
  painPoints,
  onPainPointsChange,
  onFindCustomers,
}: {
  companyName: string;
  painPoints: PainPoint[];
  onPainPointsChange: React.Dispatch<React.SetStateAction<PainPoint[]>>;
  onFindCustomers: () => void;
}) {
  const [openIds, setOpenIds] = React.useState<Set<string>>(() => new Set());

  function addPainPoint() {
    const nextPainPoint = createPainPoint();

    onPainPointsChange((current) => [...current, nextPainPoint]);
    setOpenIds((current) => new Set(current).add(nextPainPoint.id));
  }

  function removePainPoint(painPointId: string) {
    onPainPointsChange((current) =>
      current.filter((painPoint) => painPoint.id !== painPointId)
    );
  }

  function addSubpoint(painPointId: string) {
    onPainPointsChange((current) =>
      current.map((painPoint) =>
        painPoint.id === painPointId
          ? {
              ...painPoint,
              subpoints: [...painPoint.subpoints, createSubpoint()],
            }
          : painPoint
      )
    );
  }

  function updateSubpoint(
    painPointId: string,
    subpointId: string,
    patch: Partial<Omit<PainPointSubpoint, "id">>
  ) {
    onPainPointsChange((current) =>
      current.map((painPoint) =>
        painPoint.id === painPointId
          ? {
              ...painPoint,
              subpoints: painPoint.subpoints.map((subpoint) =>
                subpoint.id === subpointId
                  ? { ...subpoint, ...patch }
                  : subpoint
              ),
            }
          : painPoint
      )
    );
  }

  function removeSubpoint(painPointId: string, subpointId: string) {
    onPainPointsChange((current) =>
      current.map((painPoint) =>
        painPoint.id === painPointId
          ? {
              ...painPoint,
              subpoints: painPoint.subpoints.filter(
                (subpoint) => subpoint.id !== subpointId
              ),
            }
          : painPoint
      )
    );
  }

  return (
    <Card className="min-h-0 gap-0 overflow-hidden">
      <CardHeader className="gap-2 border-b">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle>Pain points</CardTitle>
            <CardDescription>
              Developer problems {companyName} appears to solve, with code
              examples nested underneath.
            </CardDescription>
          </div>
          <Badge variant="secondary">{painPoints.length}</Badge>
        </div>
      </CardHeader>

      <CardContent className="min-h-0 flex-1 p-0">
        <ScrollArea className="h-full">
          <div className="flex flex-col gap-3 p-4">
            {painPoints.map((painPoint) => {
              const isOpen = openIds.has(painPoint.id);

              return (
                <Collapsible
                  key={painPoint.id}
                  open={isOpen}
                  onOpenChange={(open) =>
                    setOpenIds((current) => {
                      const next = new Set(current);

                      if (open) {
                        next.add(painPoint.id);
                      } else {
                        next.delete(painPoint.id);
                      }

                      return next;
                    })
                  }
                >
                  <div className="group relative rounded-lg border bg-card">
                    <div className="min-w-0 p-2">
                      <PainPointTrigger painPoint={painPoint} isOpen={isOpen} />
                    </div>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label="Remove pain point"
                            className="pointer-events-none absolute top-2 right-2 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100"
                            onClick={() => removePainPoint(painPoint.id)}
                          />
                        }
                      >
                        <Trash2Icon />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Remove</p>
                      </TooltipContent>
                    </Tooltip>
                    <CollapsibleContent>
                      <div className="flex flex-col gap-4 border-t p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-medium">Code examples</div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => addSubpoint(painPoint.id)}
                          >
                            <PlusIcon data-icon="inline-start" />
                            Add
                          </Button>
                        </div>
                        <CodeExampleList
                          painPoint={painPoint}
                          onUpdateSubpoint={updateSubpoint}
                          onRemoveSubpoint={removeSubpoint}
                        />
                      </div>
                    </CollapsibleContent>
                  </div>
                </Collapsible>
              );
            })}
          </div>
        </ScrollArea>
      </CardContent>

      <CardFooter className="border-t">
        <div className="flex w-full flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={addPainPoint}>
            <PlusIcon data-icon="inline-start" />
            Add pain point
          </Button>
          <Button
            type="button"
            className="sm:ml-auto"
            disabled={painPoints.length === 0}
            onClick={onFindCustomers}
          >
            <DatabaseZapIcon data-icon="inline-start" />
            Find Customers
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}

function PainPointTrigger({
  painPoint,
  isOpen,
}: {
  painPoint: PainPoint;
  isOpen: boolean;
}) {
  return (
    <CollapsibleTrigger
      render={
        <button
          type="button"
          className="flex w-full min-w-0 items-start gap-2 rounded-md p-2 text-left hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          aria-label={isOpen ? "Collapse pain point" : "Expand pain point"}
        />
      }
    >
      <ChevronDownIcon
        aria-hidden="true"
        className={cn(
          "mt-0.5 size-4 shrink-0 transition-transform",
          isOpen ? "rotate-0" : "-rotate-90"
        )}
      />
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-foreground">
          {painPoint.title}
        </span>
        <span className="mt-1 block line-clamp-2 text-xs leading-5 text-muted-foreground">
          {painPoint.description}
        </span>
      </span>
    </CollapsibleTrigger>
  );
}

function CodeExampleList({
  painPoint,
  onUpdateSubpoint,
  onRemoveSubpoint,
}: {
  painPoint: PainPoint;
  onUpdateSubpoint: (
    painPointId: string,
    subpointId: string,
    patch: Partial<Omit<PainPointSubpoint, "id">>
  ) => void;
  onRemoveSubpoint: (painPointId: string, subpointId: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {painPoint.subpoints.map((subpoint) => (
        <div
          key={subpoint.id}
          className="group/code-example relative flex flex-col gap-1 rounded-md"
        >
          <Input
            aria-label="Code example title"
            className="h-auto min-w-0 border-0 bg-transparent p-0 text-sm font-medium text-foreground shadow-none focus-visible:ring-0"
            value={subpoint.title}
            onChange={(event) =>
              onUpdateSubpoint(painPoint.id, subpoint.id, {
                title: event.target.value,
              })
            }
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Remove code example"
            className="pointer-events-none absolute top-0 right-0 opacity-0 transition-opacity group-hover/code-example:pointer-events-auto group-hover/code-example:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100"
            onClick={() => onRemoveSubpoint(painPoint.id, subpoint.id)}
          >
            <Trash2Icon />
          </Button>
          <Textarea
            aria-label="Code example description"
            className="min-h-0 resize-none border-0 bg-transparent p-0 text-sm font-normal text-muted-foreground shadow-none focus-visible:ring-0"
            value={subpoint.description}
            onChange={(event) =>
              onUpdateSubpoint(painPoint.id, subpoint.id, {
                description: event.target.value,
              })
            }
          />
        </div>
      ))}
    </div>
  );
}

function ChatPanel({
  companyName,
  messages,
  input,
  status,
  error,
  compact = false,
  onClose,
  onInputChange,
  onSubmit,
  onStop,
  onReset,
}: {
  companyName: string;
  messages: ChatMessage[];
  input: string;
  status: ChatStatus;
  error: string;
  compact?: boolean;
  onClose?: () => void;
  onInputChange: (value: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onStop: () => void;
  onReset: () => void;
}) {
  const isBusy = status === "streaming";
  const canSend = input.trim().length > 0 && !isBusy;

  function handleTextareaKeyDown(
    event: React.KeyboardEvent<HTMLTextAreaElement>
  ) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  return (
    <MessageScrollerProvider autoScroll>
      <Card className="h-full min-h-0 gap-0 overflow-hidden">
        <CardHeader className="gap-1 border-b">
          <CardTitle>Chat</CardTitle>
          <CardDescription>{companyName}</CardDescription>
          <CardAction>
            {onClose ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label="Collapse chat"
                      onClick={onClose}
                    />
                  }
                >
                  <XIcon />
                </TooltipTrigger>
                <TooltipContent>
                  <p>Close</p>
                </TooltipContent>
              </Tooltip>
            ) : (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label="Reset workflow"
                      onClick={onReset}
                    />
                  }
                >
                  <RotateCwIcon />
                </TooltipTrigger>
                <TooltipContent>
                  <p>Reset</p>
                </TooltipContent>
              </Tooltip>
            )}
          </CardAction>
        </CardHeader>

        <CardContent className="min-h-0 flex-1 overflow-hidden p-0">
          {messages.length === 0 ? (
            <Empty className="h-full">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <MessageSquareIcon />
                </EmptyMedia>
                <EmptyTitle>Ready</EmptyTitle>
                <EmptyDescription>
                  Ask about the company, customers, or pain points.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <MessageScroller>
              <MessageScrollerViewport>
                <MessageScrollerContent
                  aria-busy={isBusy}
                  className={cn(
                    "p-(--card-spacing)",
                    compact ? "gap-3" : undefined
                  )}
                >
                  {messages.map((message) => (
                    <MessageAnimated
                      key={message.id}
                      message={message}
                      isBusy={isBusy}
                    />
                  ))}
                </MessageScrollerContent>
              </MessageScrollerViewport>
              <MessageScrollerButton />
            </MessageScroller>
          )}
        </CardContent>

        <CardFooter className="flex-col gap-2 border-t">
          <form onSubmit={onSubmit} className="w-full">
            <InputGroup>
              <InputGroupTextarea
                aria-label="Message"
                placeholder="Ask a follow-up..."
                className="h-14 min-h-14 overflow-y-auto"
                value={input}
                onChange={(event) => onInputChange(event.target.value)}
                onKeyDown={handleTextareaKeyDown}
                disabled={isBusy}
              />
              <InputGroupAddon align="block-end" className="pt-1">
                {isBusy ? (
                  <InputGroupButton
                    type="button"
                    size="icon-sm"
                    className="ml-auto"
                    onClick={onStop}
                  >
                    <SquareIcon />
                    <span className="sr-only">Stop</span>
                  </InputGroupButton>
                ) : (
                  <InputGroupButton
                    type="submit"
                    variant="default"
                    size="icon-sm"
                    disabled={!canSend}
                    className="ml-auto"
                  >
                    <ArrowUpIcon />
                    <span className="sr-only">Send</span>
                  </InputGroupButton>
                )}
              </InputGroupAddon>
            </InputGroup>
          </form>
          {error || status === "error" ? (
            <p className="text-center text-xs text-destructive">
              {error || "The last request failed."}
            </p>
          ) : null}
        </CardFooter>
      </Card>
    </MessageScrollerProvider>
  );
}

function MessageAnimated({
  message,
  isBusy,
}: {
  message: ChatMessage;
  isBusy: boolean;
}) {
  const isUser = message.role === "user";
  const isEmptyStreamingAssistant =
    !isUser && isBusy && message.content.length === 0;

  return (
    <MessageScrollerItem
      messageId={message.id}
      scrollAnchor={message.role === "user"}
      className="animate-in fade-in-0 slide-in-from-bottom-1 duration-200"
    >
      <Message align={isUser ? "end" : "start"}>
        <MessageContent>
          <Bubble variant={isUser ? "default" : "muted"}>
            <BubbleContent className="whitespace-pre-wrap">
              {isEmptyStreamingAssistant ? (
                <span className="inline-flex items-center gap-2 text-muted-foreground">
                  <Spinner aria-hidden="true" />
                  Thinking...
                </span>
              ) : (
                message.content
              )}
            </BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
    </MessageScrollerItem>
  );
}

function CustomerSearchLoadingScreen({
  painPoints,
}: {
  painPoints: PainPoint[];
}) {
  const cells = React.useMemo(
    () =>
      Array.from({ length: 120 }, (_, index) => ({
        id: index,
        value: ((index * 137 + 41) % 997).toString().padStart(3, "0"),
        delay: `${(index % 18) * 85}ms`,
        duration: `${700 + (index % 7) * 120}ms`,
      })),
    []
  );

  return (
    <main className="flex min-h-dvh items-center justify-center overflow-hidden bg-background px-4">
      <Card className="relative w-full max-w-4xl overflow-hidden">
        <div className="pointer-events-none absolute inset-0 opacity-60">
          <div className="hacker-scan absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-primary/20 to-transparent" />
        </div>
        <CardHeader className="relative">
          <CardTitle>Finding customers</CardTitle>
          <CardDescription>
            Scoring lead fit against {painPoints.length} developer pain points.
          </CardDescription>
        </CardHeader>
        <CardContent className="relative flex flex-col gap-5">
          <div className="grid grid-cols-10 gap-1 rounded-lg border bg-muted/30 p-3 font-mono text-xs sm:grid-cols-15">
            {cells.map((cell) => (
              <span
                key={cell.id}
                className="hacker-cell rounded-sm px-1 py-0.5 text-center text-primary"
                style={{
                  animationDelay: cell.delay,
                  animationDuration: cell.duration,
                }}
              >
                {cell.value}
              </span>
            ))}
          </div>
          <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-3">
            <div className="rounded-lg border p-3">
              <Badge variant="secondary">01</Badge>
              <p className="mt-2">Mapping technical symptoms</p>
            </div>
            <div className="rounded-lg border p-3">
              <Badge variant="secondary">02</Badge>
              <p className="mt-2">Clustering likely buyers</p>
            </div>
            <div className="rounded-lg border p-3">
              <Badge variant="secondary">03</Badge>
              <p className="mt-2">Ranking account fit</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}

function LeadsTablePanel({
  companyName,
  leads,
}: {
  companyName: string;
  leads: Lead[];
}) {
  const [selectedLead, setSelectedLead] = React.useState<Lead | null>(null);

  function openLead(lead: Lead) {
    setSelectedLead(lead);
  }

  return (
    <>
      <Card className="min-h-0 gap-0 overflow-hidden">
        <CardHeader className="border-b">
          <CardTitle>Leads</CardTitle>
          <CardDescription>
            Placeholder accounts matched against {companyName} pain points.
          </CardDescription>
        </CardHeader>
        <CardContent className="min-h-0 flex-1 overflow-auto p-0">
          <div className="min-w-[960px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Profile</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead>Evidence</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leads.map((lead) => (
                  <TableRow
                    key={lead.id}
                    role="button"
                    tabIndex={0}
                    className="cursor-pointer"
                    aria-label={`Open evidence for ${lead.name}`}
                    onClick={() => openLead(lead)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        openLead(lead);
                      }
                    }}
                  >
                    <TableCell className="font-medium">{lead.name}</TableCell>
                    <TableCell className="max-w-xs whitespace-normal">
                      {lead.profile}
                    </TableCell>
                    <TableCell>
                      <ScoreBadge score={lead.score} />
                    </TableCell>
                    <TableCell className="max-w-2xl whitespace-normal">
                      <EvidenceBullets evidence={lead.evidence} compact />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
      <LeadEvidencePanel
        lead={selectedLead}
        onClose={() => setSelectedLead(null)}
      />
    </>
  );
}

function ScoreBadge({ score }: { score: number }) {
  return (
    <Badge variant={score >= 80 ? "default" : "secondary"}>
      {Math.round(score)}
    </Badge>
  );
}

function EvidenceBullets({
  evidence,
  compact = false,
}: {
  evidence?: Lead["evidence"];
  compact?: boolean;
}) {
  const visibleEvidence = evidence ?? [];

  if (visibleEvidence.length === 0) {
    return (
      <p className={cn("text-muted-foreground", compact ? "text-xs" : "text-sm")}>
        No evidence yet.
      </p>
    );
  }

  return (
    <ul className={cn("flex flex-col", compact ? "gap-1.5" : "gap-3")}>
      {visibleEvidence.map((item) => (
        <li key={item.id} className="flex gap-2">
          <ScoreBadge score={item.score} />
          <div className="min-w-0">
            <p
              className={cn(
                "text-foreground",
                compact ? "line-clamp-2 text-xs" : "text-sm"
              )}
            >
              {compact ? item.description : item.painPointTitle}
            </p>
            {compact ? null : (
              <p className="mt-1 text-sm text-muted-foreground">
                {item.description}
              </p>
            )}
            <a
              href={item.href}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-flex text-xs font-medium text-foreground underline-offset-4 hover:underline"
              onClick={(event) => event.stopPropagation()}
            >
              {item.source}
            </a>
          </div>
        </li>
      ))}
    </ul>
  );
}

function LeadEvidencePanel({
  lead,
  onClose,
}: {
  lead: Lead | null;
  onClose: () => void;
}) {
  if (!lead) {
    return null;
  }

  return (
    <aside
      role="dialog"
      aria-modal="true"
      aria-label={`${lead.name} evidence details`}
      className="fixed inset-y-0 right-0 z-40 flex w-full max-w-xl flex-col border-l bg-background shadow-xl"
    >
      <div className="flex items-start justify-between gap-4 border-b p-4">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">{lead.name}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{lead.profile}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Close lead evidence"
          onClick={onClose}
        >
          <XIcon />
        </Button>
      </div>
      <div className="border-b p-4">
        <p className="text-xs font-medium text-muted-foreground">Average score</p>
        <div className="mt-2 text-3xl font-semibold">{Math.round(lead.score)}</div>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-4">
          <EvidenceBullets evidence={lead.evidence} />
        </div>
      </ScrollArea>
    </aside>
  );
}

const PREVIEW_COMPANY_NAME = "Linear";

const PREVIEW_PAIN_POINTS: PainPoint[] = [
  {
    id: "pain_preview_triage",
    title: "Engineering signal is scattered across support and sales tools",
    description:
      "Teams lose the technical context behind customer problems when tickets, call notes, and GitHub issues live in separate systems.",
    subpoints: [
      {
        id: "code_preview_triage_1",
        title: "Bug reports arrive without reproduction context",
        description:
          "Support escalations mention a failing workflow but omit request IDs, deploy versions, or the frontend route where the issue appeared.",
      },
      {
        id: "code_preview_triage_2",
        title: "Issue deduping happens manually",
        description:
          "Engineers scan Slack threads, CRM notes, and issue comments to decide whether a new report maps to an existing defect.",
      },
    ],
  },
  {
    id: "pain_preview_planning",
    title: "Roadmap planning misses code-level implementation constraints",
    description:
      "Product requests are ranked by revenue and volume, but the engineering surface area is unclear until planning meetings.",
    subpoints: [
      {
        id: "code_preview_planning_1",
        title: "Ownership boundaries are hard to infer",
        description:
          "A seemingly small feature touches billing events, webhook retries, and permission checks across multiple packages.",
      },
      {
        id: "code_preview_planning_2",
        title: "Risk is discovered after commitment",
        description:
          "Teams only find migration, performance, or API contract risks after a roadmap item is already scheduled.",
      },
    ],
  },
  {
    id: "pain_preview_followup",
    title: "Customer follow-up loops are slow after fixes ship",
    description:
      "Engineering closes issues, but customer-facing teams often lack a clear list of impacted accounts and contacts to notify.",
    subpoints: [
      {
        id: "code_preview_followup_1",
        title: "Fix metadata is not tied to accounts",
        description:
          "Pull requests reference internal issue IDs while CRM records use opportunity names, making account-level follow-up manual.",
      },
    ],
  },
];

const PREVIEW_LEADS: Lead[] = [
  {
    id: "lead_preview_1",
    name: "OrbitOps",
    profile: "Developer productivity team consolidating feedback and issue triage",
    score: 87,
    evidence: [
      {
        id: "orbitops_evidence_1",
        painPointId: "pain_preview_triage",
        painPointTitle:
          "Engineering signal is scattered across support and sales tools",
        score: 91,
        description:
          "Hiring post asks for a developer productivity lead to unify support escalations, incident reports, and engineering work queues.",
        href: "https://orbitops.dev/careers/developer-productivity",
        source: "Careers page",
      },
      {
        id: "orbitops_evidence_2",
        painPointId: "pain_preview_planning",
        painPointTitle:
          "Roadmap planning misses code-level implementation constraints",
        score: 84,
        description:
          "Engineering blog describes planning delays caused by unclear ownership across billing, platform, and frontend teams.",
        href: "https://orbitops.dev/blog/planning-engineering-work",
        source: "Engineering blog",
      },
      {
        id: "orbitops_evidence_3",
        painPointId: "pain_preview_followup",
        painPointTitle: "Customer follow-up loops are slow after fixes ship",
        score: 86,
        description:
          "Changelog notes customer-requested fixes but does not tie shipped work back to affected accounts or contacts.",
        href: "https://orbitops.dev/changelog/customer-fixes",
        source: "Changelog",
      },
    ],
  },
  {
    id: "lead_preview_2",
    name: "Northstar Cloud",
    profile: "Cloud platform team automating support engineering handoffs",
    score: 82,
    evidence: [
      {
        id: "northstar_evidence_1",
        painPointId: "pain_preview_triage",
        painPointTitle:
          "Engineering signal is scattered across support and sales tools",
        score: 88,
        description:
          "Job description references support engineering automation and a backlog of customer-reported technical issues.",
        href: "https://northstarcloud.com/jobs/support-engineering-automation",
        source: "Open role",
      },
      {
        id: "northstar_evidence_2",
        painPointId: "pain_preview_planning",
        painPointTitle:
          "Roadmap planning misses code-level implementation constraints",
        score: 77,
        description:
          "Product update frames roadmap prioritization around enterprise escalations without visible engineering impact scoring.",
        href: "https://northstarcloud.com/product-updates/enterprise-roadmap",
        source: "Product update",
      },
      {
        id: "northstar_evidence_3",
        painPointId: "pain_preview_followup",
        painPointTitle: "Customer follow-up loops are slow after fixes ship",
        score: 81,
        description:
          "Public status notes multiple customer-facing fixes shipped together with no account-specific follow-up workflow.",
        href: "https://northstarcloud.com/status/fix-rollup",
        source: "Status post",
      },
    ],
  },
  {
    id: "lead_preview_3",
    name: "Stacklane",
    profile: "Enterprise SaaS team building technical escalation workflows",
    score: 73,
    evidence: [
      {
        id: "stacklane_evidence_1",
        painPointId: "pain_preview_triage",
        painPointTitle:
          "Engineering signal is scattered across support and sales tools",
        score: 76,
        description:
          "Case study mentions escalation workflows spanning customer success, engineering, and issue trackers.",
        href: "https://stacklane.io/customers/escalation-workflows",
        source: "Customer story",
      },
      {
        id: "stacklane_evidence_2",
        painPointId: "pain_preview_planning",
        painPointTitle:
          "Roadmap planning misses code-level implementation constraints",
        score: 71,
        description:
          "Roadmap post discusses enterprise feature prioritization but only lightly references engineering scope.",
        href: "https://stacklane.io/roadmap/enterprise-features",
        source: "Roadmap post",
      },
      {
        id: "stacklane_evidence_3",
        painPointId: "pain_preview_followup",
        painPointTitle: "Customer follow-up loops are slow after fixes ship",
        score: 72,
        description:
          "Release notes cite customer escalations as a source of fixes, but follow-up ownership is not visible.",
        href: "https://stacklane.io/releases/customer-escalations",
        source: "Release notes",
      },
    ],
  },
  {
    id: "lead_preview_4",
    name: "BuildPilot",
    profile: "Small engineering team improving roadmap visibility and release notes",
    score: 69,
    evidence: [
      {
        id: "buildpilot_evidence_1",
        painPointId: "pain_preview_triage",
        painPointTitle:
          "Engineering signal is scattered across support and sales tools",
        score: 70,
        description:
          "Founder update references manual issue triage from support threads and GitHub comments.",
        href: "https://buildpilot.co/updates/support-triage",
        source: "Founder update",
      },
      {
        id: "buildpilot_evidence_2",
        painPointId: "pain_preview_planning",
        painPointTitle:
          "Roadmap planning misses code-level implementation constraints",
        score: 68,
        description:
          "Public roadmap lists customer requests without visible engineering risk or implementation sizing.",
        href: "https://buildpilot.co/roadmap",
        source: "Roadmap",
      },
      {
        id: "buildpilot_evidence_3",
        painPointId: "pain_preview_followup",
        painPointTitle: "Customer follow-up loops are slow after fixes ship",
        score: 69,
        description:
          "Release notes group several account-requested fixes but do not expose impacted-account follow-up.",
        href: "https://buildpilot.co/releases/customer-requested-fixes",
        source: "Release notes",
      },
    ],
  },
];

function clonePainPoints(painPoints: PainPoint[]) {
  return painPoints.map((painPoint) => ({
    ...painPoint,
    subpoints: painPoint.subpoints.map((subpoint) => ({ ...subpoint })),
  }));
}

export function PainPointsTablePreview() {
  const [painPoints, setPainPoints] = React.useState<PainPoint[]>(() =>
    clonePainPoints(PREVIEW_PAIN_POINTS)
  );
  const [messages, setMessages] = React.useState<ChatMessage[]>([
    {
      id: "preview_assistant",
      role: "assistant",
      content:
        "This preview uses hardcoded data so the pain-points and leads table layout can be edited directly.",
    },
  ]);
  const [chatInput, setChatInput] = React.useState("");
  const [isChatExpanded, setIsChatExpanded] = React.useState(false);

  function handleChatSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const prompt = chatInput.trim();

    if (!prompt) {
      return;
    }

    setMessages((current) => [
      ...current,
      createMessage("user", prompt),
      createMessage(
        "assistant",
        "Preview mode keeps the table data hardcoded. Edit the panels and layout without calling the API."
      ),
    ]);
    setChatInput("");
  }

  function handleResetPreview() {
    setPainPoints(clonePainPoints(PREVIEW_PAIN_POINTS));
    setMessages([
      {
        id: "preview_assistant",
        role: "assistant",
        content:
          "This preview uses hardcoded data so the pain-points and leads table layout can be edited directly.",
      },
    ]);
    setChatInput("");
    setIsChatExpanded(false);
  }

  return (
    <LeadsWorkspace
      companyName={PREVIEW_COMPANY_NAME}
      painPoints={painPoints}
      leads={PREVIEW_LEADS}
      messages={messages}
      chatInput={chatInput}
      chatStatus="idle"
      isChatExpanded={isChatExpanded}
      onPainPointsChange={setPainPoints}
      onFindCustomers={() => undefined}
      onChatInputChange={setChatInput}
      onChatSubmit={handleChatSubmit}
      onStopChat={() => undefined}
      onChatExpandedChange={setIsChatExpanded}
      onReset={handleResetPreview}
    />
  );
}

function ChatSidebarPanel({
  companyName,
  messages,
  input,
  status,
  error,
  onInputChange,
  onSubmit,
  onStop,
  onReset,
}: {
  companyName: string;
  messages: ChatMessage[];
  input: string;
  status: ChatStatus;
  error: string;
  onInputChange: (value: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onStop: () => void;
  onReset: () => void;
}) {
  const { setOpen, setOpenMobile } = useSidebar();

  return (
    <ChatPanel
      companyName={companyName}
      messages={messages}
      input={input}
      status={status}
      error={error}
      compact
      onClose={() => {
        setOpen(false);
        setOpenMobile(false);
      }}
      onInputChange={onInputChange}
      onSubmit={onSubmit}
      onStop={onStop}
      onReset={onReset}
    />
  );
}

function CollapsedChatSidebarButton() {
  const { setOpen, setOpenMobile } = useSidebar();

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          type="button"
          tooltip="Open chat"
          aria-label="Open chat"
          onClick={() => {
            setOpen(true);
            setOpenMobile(true);
          }}
        >
          <MessageSquareIcon aria-hidden="true" />
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

function MobileChatSidebarButton() {
  const { setOpen, setOpenMobile, openMobile } = useSidebar();

  if (openMobile) {
    return null;
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      aria-label="Open chat"
      className="absolute top-4 left-4 z-10 md:hidden"
      onClick={() => {
        setOpen(true);
        setOpenMobile(true);
      }}
    >
      <MessageSquareIcon aria-hidden="true" />
    </Button>
  );
}
