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
  created_at: string;
  updated_at: string;
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
  latest_run_id?: string | null;
  directions: Array<{ direction_index: number; name: string; papers_count: number }>;
  graph_stats?: Record<string, unknown>;
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
  direction_index?: number | null;
  status?: string | null;
  feedback_text?: string | null;
  summary?: string | null;
  action?: string | null;
  depth?: number | null;
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

export type RunSummary = {
  total: number;
  latest_seq: number;
  phases: RunPhaseSummary[];
  latest_checkpoint?: Record<string, unknown> | null;
  latest_report?: Record<string, unknown> | null;
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
  thread_id: string;
  item: ChatItem;
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
};

export type PaperAssetItem = {
  kind: string;
  status: string;
  filename?: string | null;
  path?: string | null;
  download_url?: string | null;
};

export type PaperAssetResponse = {
  task_id: string;
  paper_id: string;
  primary_kind?: string | null;
  items: PaperAssetItem[];
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
  base_url?: string | null;
  library_type?: string | null;
  library_id?: string | null;
  has_api_key: boolean;
};

export type ZoteroImportResponse = {
  project_id: string;
  collection: CollectionSummary;
  imported: number;
};
