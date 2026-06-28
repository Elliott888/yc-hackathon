import type {
  RawCommit,
  RawComment,
  RawContributorStat,
  RawIssue,
  RawManifest,
  RawPullRequest,
  RawPullRequestReview,
  RawPullRequestReviewComment,
  RawRepo,
  RawRepoExpansion,
  RawWorkflowRun,
  RawUser
} from "../../track-a-harvester/src/types.js";

export type {
  RawCommit,
  RawComment,
  RawContributorStat,
  RawIssue,
  RawManifest,
  RawPullRequest,
  RawPullRequestReview,
  RawPullRequestReviewComment,
  RawRepo,
  RawRepoExpansion,
  RawWorkflowRun,
  RawUser
};

export type Recipe = {
  id: string;
  label: string;
  target_product: string;
  target_entity: string;
  time_window_days: number;
  repo_categories: string[];
  topic_terms: string[];
  strong_stacks: string[];
  negative_terms: string[];
};

export type RawTrackBData = {
  repos: RawRepo[];
  pullRequests: RawPullRequest[];
  issues: RawIssue[];
  comments: RawComment[];
  commits: RawCommit[];
  manifests: RawManifest[];
  pullRequestReviews: RawPullRequestReview[];
  pullRequestReviewComments: RawPullRequestReviewComment[];
  workflowRuns: RawWorkflowRun[];
  contributorStats: RawContributorStat[];
  repoExpansions: RawRepoExpansion[];
  users: RawUser[];
};

export type RepoCategoryRecord = {
  repo: string;
  categories: string[];
  category_scores: Record<string, number>;
  negative_flags: string[];
};

export type EvidenceRecord = {
  type: "pull_request" | "issue" | "comment" | "commit" | "review" | "review_comment" | "workflow_run";
  repo: string;
  title: string;
  text: string;
  url: string;
  created_at: string;
  matched_topics: string[];
  repo_categories: string[];
  contribution_weight: number;
  neural_intent_score?: number;
  burning_problem_score?: number;
  buyer_intent_label?: string;
  pain_signals?: string[];
  code_signals?: CodeSignal[];
};

export type CodeSignal = {
  id: string;
  label: string;
  pain_point: string;
  code_manifestation?: string;
  matched_terms: string[];
  score: number;
};

export type CodeSignalContext = CodeSignal & {
  repo: string;
  title: string;
  url: string;
};

export type ProductFitExplanation = {
  target_product: string;
  severity: "none" | "low" | "medium" | "high";
  burning_problem: string;
  why_it_is_burning: string;
  why_product_can_help: string;
  evidence_title: string;
  evidence_url: string;
  urgency_signals: string[];
  product_fit_signals: string[];
  detected_pain_points?: string[];
  code_manifestations?: string[];
};

export type PainPointEvidence = {
  pain_point: string;
  code_manifestation: string;
  matched_terms: string[];
  evidence_title: string;
  evidence_url: string;
  repo: string;
  score: number;
  why_it_matters: string;
};

export type ContributionTopicRecord = {
  repo: string;
  actor_login: string;
  evidence_url: string;
  evidence_type: EvidenceRecord["type"];
  matched_topics: string[];
  created_at: string;
};

export type EngineerProfile = {
  login: string;
  name: string | null;
  company: string | null;
  location: string | null;
  blog: string | null;
  email: string | null;
  bio: string | null;
  url: string | null;
  followers: number;
  public_repos: number;
  top_repos: string[];
  top_topics: string[];
  repo_categories: string[];
  primary_languages: string[];
  stack_signals: string[];
  code_signals: CodeSignal[];
  contribution_counts: Record<string, number>;
  last_active_at: string;
  evidence: EvidenceRecord[];
  negative_flags: string[];
  profile_text: string;
};

export type EngineerEmbedding = {
  engineer_login: string;
  dimensions: string[];
  vector: number[];
};

export type ScoreBreakdown = {
  recent_activity: number;
  repo_category_fit: number;
  topic_fit: number;
  contribution_depth: number;
  stack_fit: number;
  evidence_quality: number;
  penalties: number;
};

export type AnswerContext = {
  problem_signals: string[];
  pain_signals?: string[];
  burning_problem_score?: number;
  code_signals: CodeSignal[];
  code_signal_context: CodeSignalContext[];
  pain_point_evidence?: PainPointEvidence[];
  product_fit_explanations?: ProductFitExplanation[];
  stack_signals: string[];
  repo_signals: string[];
  evidence_snippets: Array<{
    type: string;
    repo: string;
    title: string;
    url: string;
    occurred_at: string;
    matched_terms: string[];
    pain_score?: number;
    buyer_intent_label?: string;
    pain_signals?: string[];
    code_signals?: CodeSignal[];
    snippet: string;
  }>;
  outreach_hooks: string[];
};

export type ProblemContext = {
  score: number;
  severity: "none" | "low" | "medium" | "high";
  summary: string;
  evidence_url: string;
  repo: string;
  title: string;
  signals: string[];
  current_tools: string[];
  code_signals?: CodeSignal[];
};

export type RankedLead = {
  engineer_login: string;
  name: string | null;
  score: number;
  neural_intent_score?: number;
  burning_problem_score?: number;
  pain_signals?: string[];
  code_signals?: CodeSignal[];
  why_relevant: string;
  outreach_angle: string;
  score_breakdown: ScoreBreakdown;
  evidence: EvidenceRecord[];
  top_repos: string[];
  top_topics: string[];
  repo_categories: string[];
  primary_languages: string[];
  last_active_at: string;
  window_start_at: string;
  time_window_days: number;
  answer_context?: AnswerContext;
  semantic_document: string;
};

export type BuildIntelligenceOptions = {
  rootDir?: string;
  now?: Date;
};

export type BuildIntelligenceResult = {
  leadCount: number;
  profileCount: number;
  repoCategoryCount: number;
  topLead: RankedLead | null;
};

export type QueryPlan = {
  raw_query: string;
  target_entity: string;
  target_product: string;
  time_window_days: number;
  topics: string[];
  categories?: string[];
  indexes_used: string[];
};

export type SearchResultLead = Omit<RankedLead, "semantic_document"> & {
  keyword_score: number;
  semantic_score: number;
  topic_score: number;
  evidence_score: number;
  problem_score?: number;
  code_signal_score?: number;
  top_problem?: ProblemContext | null;
  first_party_repo?: boolean;
  final_score: number;
};

export type SearchResponse = {
  query_plan: QueryPlan;
  results: SearchResultLead[];
};

export type RankingMode = "keyword" | "semantic" | "intent";

export type BaselineComparisonResponse = {
  query_plan: QueryPlan;
  baselines: Record<
    RankingMode,
    {
      label: string;
      results: SearchResultLead[];
    }
  >;
};

export type EvalReport = {
  query_id: string;
  query?: string;
  k_values: number[];
  metrics: Record<string, number>;
  baseline_metrics?: Record<RankingMode, Record<string, number>>;
  baseline_top_leads?: Record<RankingMode, string[]>;
  lead_count: number;
  labeled_lead_count: number;
};
