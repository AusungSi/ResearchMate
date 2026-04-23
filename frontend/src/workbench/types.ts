export type TaskMode = "gpt_step" | "openclaw_auto";
export type Backend = "gpt" | "openclaw";

export type ProjectSummary = {
  project_id: string;
  name: string;
  description?: string | null;
  is_default: boolean;
  task_count: number;
  collection_count: number;
  created_at: string;
  updated_at: string;
};

export type ExportRecord = {
  id: number;
  task_id?: string | null;
  collection_id?: string | null;
  project_id?: string | null;
  format: string;
  output_path?: string | null;
  filename?: string | null;
  download_url?: string | null;
  status: string;
  error?: string | null;
  created_at: string;
};

export type ExportListResponse = {
  task_id?: string | null;
  collection_id?: string | null;
  items: ExportRecord[];
};

export type ExportResponse = {
  path?: string | null;
  filename?: string | null;
  download_url?: string | null;
};

export type ProjectRecentRun = {
  task_id: string;
  run_id: string;
  topic: string;
  mode: TaskMode;
  auto_status: string;
  updated_at: string;
};

export type CollectionItem = {
  item_id: number;
  task_id?: string | null;
  paper_id?: string | null;
  title: string;
  authors: string[];
  year?: number | null;
  venue?: string | null;
  doi?: string | null;
  url?: string | null;
  source: string;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type CollectionSummary = {
  collection_id: string;
  project_id: string;
  name: string;
  description?: string | null;
  source_type: string;
  source_ref?: string | null;
  summary_text?: string | null;
  item_count: number;
  items: CollectionItem[];
  offset: number;
  limit: number;
  has_more: boolean;
  created_at: string;
  updated_at: string;
};

export type CompareReport = {
  report_id: string;
  scope: string;
  title: string;
  focus?: string | null;
  overview: string;
  common_points: string[];
  differences: string[];
  recommended_next_steps: string[];
  items: Array<Record<string, unknown>>;
  created_at: string;
};

export type ProjectDashboard = {
  project: ProjectSummary;
  task_count: number;
  collection_count: number;
  paper_count: number;
  saved_paper_count: number;
  recent_tasks: TaskSummary[];
  recent_runs: ProjectRecentRun[];
  provider_status: ProviderStatus[];
  recent_exports: ExportRecord[];
  recent_collections: CollectionSummary[];
};

export type TaskSummary = {
  task_id: string;
  project_id?: string | null;
  project_name?: string | null;
  topic: string;
  status: string;
  mode: TaskMode;
  llm_backend: Backend;
  llm_model?: string | null;
  auto_status: string;
  last_checkpoint_id?: string | null;
  latest_run_id?: string | null;
  directions: Array<{ direction_index: number; name: string; papers_count: number }>;
  papers_total?: number;
  rounds_total?: number;
  graph_stats?: Record<string, unknown>;
  fulltext_stats?: Record<string, number>;
  created_at?: string;
  updated_at?: string;
};

export type ProviderStatus = {
  key: string;
  role: string;
  enabled: boolean;
  configured: boolean;
  detail?: string | null;
};

export type CanvasUiState = {
  left_sidebar_collapsed: boolean;
  right_sidebar_collapsed: boolean;
  left_sidebar_width: number;
  right_sidebar_width: number;
  show_minimap: boolean;
  layout_mode: string;
};

export type WorkbenchConfig = {
  default_mode: TaskMode;
  default_backend: Backend;
  default_gpt_model?: string | null;
  default_openclaw_model?: string | null;
  openclaw_enabled: boolean;
  available_modes: string[];
  available_backends: string[];
  discovery_providers: string[];
  citation_providers: string[];
  provider_status: ProviderStatus[];
  layout_defaults: Record<string, number | string | boolean>;
  default_canvas_ui: CanvasUiState;
};

export type GraphNode = {
  id: string;
  type: string;
  label: string;
  year?: number | null;
  source?: string | null;
  venue?: string | null;
  abstract?: string | null;
  method_summary?: string | null;
  card_summary?: string | null;
  summary_source?: string | null;
  summary_status?: string | null;
  direction_index?: number | null;
  papers_count?: number | null;
  status?: string | null;
  feedback_text?: string | null;
  summary?: string | null;
  action?: string | null;
  depth?: number | null;
  preview_kind?: string | null;
  preview_url?: string | null;
  visual_status?: string | null;
};

export type GraphEdge = {
  source: string;
  target: string;
  type: string;
  weight?: number;
};

export type GraphResponse = {
  task_id: string;
  status: string;
  view: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats?: Record<string, unknown>;
};

export type CanvasNode = {
  id: string;
  type: string;
  position: { x: number; y: number };
  data?: Record<string, unknown>;
  hidden?: boolean;
  width?: number | null;
  height?: number | null;
};

export type CanvasEdge = {
  id: string;
  source: string;
  target: string;
  type?: string;
  data?: Record<string, unknown>;
  hidden?: boolean;
};

export type CanvasResponse = {
  task_id: string;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  viewport: { x: number; y: number; zoom: number };
  ui: CanvasUiState;
  updated_at?: string | null;
};

export type RunEvent = {
  run_id: string;
  task_id: string;
  event_type: string;
  seq: number;
  payload: Record<string, unknown>;
  created_at: string;
};

export type RunPhaseSummary = {
  key: string;
  label: string;
  event_count: number;
  started_seq: number;
  latest_seq: number;
};

export type RunGuidanceItem = {
  seq: number;
  text: string;
  tags: string[];
  created_at: string;
};

export type RunStepCard = {
  key: string;
  title: string;
  status?: string | null;
  seq: number;
  details: Record<string, unknown>;
  result_refs: Record<string, unknown>;
  created_at?: string | null;
};

export type RunSummary = {
  total: number;
  latest_seq: number;
  phases: RunPhaseSummary[];
  phase_groups: RunPhaseSummary[];
  latest_checkpoint?: Record<string, unknown> | null;
  latest_report?: Record<string, unknown> | null;
  latest_report_excerpt?: string | null;
  guidance_history: RunGuidanceItem[];
  step_cards: RunStepCard[];
  artifacts: Array<Record<string, unknown>>;
};

export type RunEventsResponse = {
  task_id: string;
  run_id: string;
  items: RunEvent[];
  summary: RunSummary;
};

export type ChatItem = {
  id?: number | null;
  task_id: string;
  node_id: string;
  thread_id: string;
  question: string;
  answer: string;
  provider: string;
  model?: string | null;
  created_at: string;
};

export type ChatResponse = {
  task_id: string;
  node_id: string;
  thread_id?: string | null;
  item?: ChatItem | null;
  history: ChatItem[];
};

export type RoundCandidate = {
  candidate_id: number;
  candidate_index: number;
  name: string;
  queries: string[];
  reason?: string | null;
};

export type PaperDetail = {
  task_id: string;
  paper_id: string;
  title: string;
  authors: string[];
  year?: number | null;
  venue?: string | null;
  doi?: string | null;
  url?: string | null;
  abstract?: string | null;
  method_summary: string;
  card_summary?: string | null;
  summary_source?: string | null;
  summary_status?: string | null;
  source: string;
  fulltext_status?: string | null;
  saved: boolean;
  saved_path?: string | null;
  saved_bib_path?: string | null;
  saved_at?: string | null;
  key_points_status: string;
  key_points_source?: string | null;
  key_points?: string | null;
  key_points_error?: string | null;
  key_points_updated_at?: string | null;
  preview_kind?: string | null;
  preview_url?: string | null;
  visual_status?: string | null;
  venue_metrics?: VenueMetrics | null;
};

export type VenueMetrics = {
  venue?: string;
  venue_key?: string;
  matched_venue?: string | null;
  source_type?: string | null;
  ccf?: { rank?: string | null; category?: string | null; source?: string | null } | null;
  jcr?: { quartile?: string | null; year?: number | null; source?: string | null } | null;
  cas?: { quartile?: string | null; top?: string | null; source?: string | null } | null;
  ei?: { indexed?: boolean | null; source?: string | null } | null;
  sci?: { indexed?: boolean | null; source?: string | null } | null;
  impact_factor?: { value?: number | null; year?: number | null; source?: string | null } | null;
  venue_citation_count?: number | null;
  venue_works_count?: number | null;
  h_index?: number | null;
  i10_index?: number | null;
  paper_citation_count?: number | null;
  issn_l?: string | null;
  issn?: string[];
  openalex_id?: string | null;
  homepage_url?: string | null;
  host_organization_name?: string | null;
  data_sources?: string[];
};

export type TaskVenueMetricItem = {
  venue: string;
  venue_key: string;
  source_type?: string | null;
  paper_count: number;
  paper_ids: string[];
  metrics: VenueMetrics;
};

export type TaskVenueMetricsResponse = {
  task_id: string;
  items: TaskVenueMetricItem[];
};

export type PaperAssetItem = {
  kind: string;
  status: string;
  filename?: string | null;
  path?: string | null;
  open_url?: string | null;
  download_url?: string | null;
  mime_type?: string | null;
  width?: number | null;
  height?: number | null;
  source?: string | null;
};

export type PaperAssetResponse = {
  task_id: string;
  paper_id: string;
  primary_kind?: string | null;
  items: PaperAssetItem[];
};

export type ActionResponse = {
  queued?: boolean;
  noop_reason?: string | null;
  message?: string | null;
  run_id?: string | null;
};

export type FulltextItem = {
  paper_id: string;
  status: string;
  source_url?: string | null;
  pdf_path?: string | null;
  text_path?: string | null;
  text_chars: number;
  parser?: string | null;
  quality_score?: number | null;
  sections: Record<string, unknown>;
  fail_reason?: string | null;
  fetched_at?: string | null;
  parsed_at?: string | null;
};

export type FulltextStatusResponse = {
  task_id: string;
  summary: Record<string, number>;
  items: FulltextItem[];
};

export type FlowNodeData = GraphNode & {
  userNote?: string;
  isManual?: boolean;
  hiddenByUser?: boolean;
  assetHint?: string;
  collectionId?: string;
};

export type ActionStatus = {
  tone: "neutral" | "success" | "warning" | "danger";
  text: string;
};

export type CollectionGraphResponse = {
  collection_id: string;
  nodes: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
  stats: Record<string, unknown>;
};

export type ZoteroConfig = {
  enabled: boolean;
  mode: string;
  import_formats: string[];
  export_targets: string[];
  legacy_web_api_enabled: boolean;
  legacy_web_api_configured: boolean;
  base_url?: string | null;
  library_type?: string | null;
  library_id?: string | null;
  has_api_key: boolean;
};

export type ZoteroImportResponse = {
  project_id: string;
  collection: CollectionSummary;
  imported: number;
  total_items: number;
  imported_items: number;
  deduped_items: number;
  linked_existing_papers: number;
  format?: string | null;
};
