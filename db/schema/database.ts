/**
 * Kysely table types. Must mirror db/migrations/*.sql.
 * Timestamps are unix epoch milliseconds; JSON columns are stored as TEXT.
 */

export interface UsersTable {
  id: string;
  name: string;
  email: string;
  email_verified: number;
  image: string | null;
  created_at: string;
  updated_at: string;
}

export interface BreweriesTable {
  id: string;
  name: string;
  created_by: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export interface BreweryMembersTable {
  brewery_id: string;
  user_id: string;
  role: "admin" | "member";
  created_at: number;
}

export interface BreweryInvitesTable {
  id: string;
  brewery_id: string;
  email: string;
  role: "admin" | "member";
  invited_by: string;
  created_at: number;
  expires_at: number;
  accepted_at: number | null;
  accepted_by: string | null;
  revoked_at: number | null;
}

export interface EquipmentTable {
  id: string;
  brewery_id: string;
  kind: string;
  name: string;
  capacity_l: number | null;
  notes: string | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export interface EquipmentProfilesTable {
  id: string;
  brewery_id: string;
  version: number;
  name: string;
  is_active: number;
  change_note: string | null;
  created_by: string;
  created_at: number;
}

export interface EquipmentProfileValuesTable {
  profile_id: string;
  key: string;
  value: number;
  source: "manual" | "calibration" | "default";
  note: string | null;
}

export interface RecipesTable {
  id: string;
  brewery_id: string;
  name: string;
  style: string | null;
  current_version_id: string | null;
  created_by: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export interface AssistantUsageTable {
  brewery_id: string;
  /** YYYY-MM-DD (UTC). */
  day: string;
  model: string;
  requests: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
}

export interface AssistantDailyRequestsTable {
  brewery_id: string;
  /** YYYY-MM-DD (UTC). */
  day: string;
  requests: number;
}

export interface AssistantMessagesTable {
  id: string;
  brewery_id: string;
  batch_id: string;
  role: "user" | "assistant";
  content: string;
  /** JSON serialized AssistantMessageAction[]; null when the assistant proposed no actions. */
  actions: string | null;
  created_by: string | null;
  created_at: number;
}

export interface RecipeSourcesTable {
  id: string;
  recipe_id: string;
  kind: string;
  original_text: string | null;
  url: string | null;
  attachment_id: string | null;
  /** Name of the imported file (BeerSmith). */
  filename: string | null;
  /** JSON: what the importer read besides the recipe (BsmxSourceData for BeerSmith). */
  data: string | null;
  created_by: string;
  created_at: number;
}

export interface RecipeVersionsTable {
  id: string;
  recipe_id: string;
  version: number;
  kind: "normalized" | "adaptation";
  parent_version_id: string | null;
  source_id: string | null;
  equipment_profile_id: string | null;
  data: string;
  change_note: string | null;
  created_by: string;
  created_at: number;
}

export interface BatchesTable {
  id: string;
  brewery_id: string;
  number: number;
  name: string;
  recipe_id: string;
  recipe_version_id: string;
  status: "planned" | "brewing" | "fermenting" | "conditioning" | "completed";
  current_stage: string | null;
  stage_started_at: number | null;
  brew_date: string | null;
  created_by: string;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
  deleted_at: number | null;
}

export interface BatchRecipeSnapshotsTable {
  batch_id: string;
  recipe_version_id: string;
  data: string;
  created_at: number;
}

export interface BatchEquipmentSnapshotsTable {
  batch_id: string;
  equipment_profile_id: string | null;
  profile_version: number | null;
  data: string;
  created_at: number;
}

export interface BatchSplitsTable {
  id: string;
  brewery_id: string;
  batch_id: string;
  name: string;
  vessel: string | null;
  equipment_id: string | null;
  volume_l: number | null;
  notes: string | null;
  sort_order: number;
  created_by: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export interface BrewEventsTable {
  id: string;
  brewery_id: string;
  batch_id: string;
  split_id: string | null;
  type: string;
  stage: string | null;
  occurred_at: number;
  data: string | null;
  created_by: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export interface MeasurementsTable {
  id: string;
  brewery_id: string;
  batch_id: string;
  split_id: string | null;
  event_id: string;
  kind: string;
  label: string | null;
  value: number;
  unit: string;
  entered_value: number | null;
  entered_unit: string | null;
  value_min: number | null;
  value_max: number | null;
  stage: string | null;
  measured_at: number;
  sample_temp_c: number | null;
  instrument: string | null;
  comment: string | null;
  created_by: string;
  created_at: number;
  deleted_at: number | null;
}

export interface CommentsTable {
  id: string;
  brewery_id: string;
  batch_id: string;
  event_id: string;
  body: string;
  created_by: string;
  created_at: number;
  updated_at: number;
  edited_at: number | null;
  deleted_at: number | null;
}

export interface AttachmentsTable {
  id: string;
  brewery_id: string;
  batch_id: string | null;
  recipe_id: string | null;
  event_id: string | null;
  r2_key: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  caption: string | null;
  created_by: string;
  created_at: number;
  deleted_at: number | null;
}

export interface BatchOutcomesTable {
  id: string;
  brewery_id: string;
  batch_id: string;
  split_id: string | null;
  og: number | null;
  og_source: "sg" | "brix" | "manual" | null;
  fg: number | null;
  fg_source: "sg" | "brix" | "manual" | null;
  packaged_volume_l: number | null;
  packaged_on: string | null;
  packaging: "cans" | "keg" | "bottles" | "other" | null;
  carbonation_vols: number | null;
  tasting_notes: string | null;
  rating: number | null;
  next_time: string | null;
  created_by: string;
  created_at: number;
  updated_by: string;
  updated_at: number;
}

export interface RecipeLibraryTable {
  id: string;
  source: string;
  source_ref: string;
  source_url: string | null;
  name: string;
  tagline: string | null;
  category: string;
  abv: number | null;
  ibu: number | null;
  og: number | null;
  fg: number | null;
  ebc: number | null;
  batch_size_l: number;
  search_text: string;
  data: string;
  source_data: string;
  warnings: string;
  imported_at: number;
}

export interface Database {
  users: UsersTable;
  breweries: BreweriesTable;
  brewery_members: BreweryMembersTable;
  brewery_invites: BreweryInvitesTable;
  equipment: EquipmentTable;
  equipment_profiles: EquipmentProfilesTable;
  equipment_profile_values: EquipmentProfileValuesTable;
  recipes: RecipesTable;
  recipe_sources: RecipeSourcesTable;
  assistant_usage: AssistantUsageTable;
  assistant_daily_requests: AssistantDailyRequestsTable;
  assistant_messages: AssistantMessagesTable;
  recipe_versions: RecipeVersionsTable;
  batches: BatchesTable;
  batch_recipe_snapshots: BatchRecipeSnapshotsTable;
  batch_equipment_snapshots: BatchEquipmentSnapshotsTable;
  batch_splits: BatchSplitsTable;
  brew_events: BrewEventsTable;
  measurements: MeasurementsTable;
  comments: CommentsTable;
  attachments: AttachmentsTable;
  batch_outcomes: BatchOutcomesTable;
  recipe_library: RecipeLibraryTable;
}
