/**
 * ElectraScan — Project / Estimate Data Models
 * =============================================
 * Canonical TypeScript interfaces for the persistence layer.
 * Mirrors the Supabase schema in supabase/migrations/001_phase1_schema.sql.
 */

// ─────────────────────────────────────────────
// ENUMS / UNION TYPES
// ─────────────────────────────────────────────

export type ProjectStatus  = "active" | "pending" | "complete";
export type VersionStatus  = "active" | "superseded";
export type EstimateStatus = "draft" | "locked" | "submitted" | "approved" | "rejected" | "superseded";
export type LineItemUnit   = "EA" | "LM" | "LS" | "HR";

// ─────────────────────────────────────────────
// PROJECT
// ─────────────────────────────────────────────

export interface Project {
  id: string;                  // uuid
  name: string;
  address: string;
  client: string;
  builder: string;
  status: ProjectStatus;
  color: string;               // hex accent for cards
  description: string;
  version_count: number;       // computed / denormalised for list view
  last_estimate: number;       // denormalised: latest estimate total
  created_at: string;
  updated_at: string;
}

export type NewProject = Omit<Project, "id" | "version_count" | "last_estimate" | "created_at" | "updated_at">;

// ─────────────────────────────────────────────
// DRAWING VERSION
// ─────────────────────────────────────────────

export interface DrawingVersion {
  id: string;                  // uuid
  project_id: string;
  tag: string;                 // "V001", "V002"
  label: string;               // "Version 001"
  source: string;              // "Direct upload", "Email from architect"
  page_count: number;
  scale_detected: string;
  legend_found: boolean;
  component_count: number;
  estimate_id: string | null;  // linked estimate
  status: VersionStatus;
  created_at: string;
}

// ─────────────────────────────────────────────
// ESTIMATE LINE ITEM
// ─────────────────────────────────────────────

export interface EstimateLineItem {
  id: string;                  // uuid
  estimate_id: string;
  description: string;
  unit: LineItemUnit;
  qty: number;
  rate: number;
  line_total: number;          // qty × rate (computed)
  component_type: string | null;
  room: string | null;
  confidence: number | null;   // 0–100
  flags: string[];
  voice_note: string | null;
  sort_order: number;
  created_at: string;
}

export type NewLineItem = Omit<EstimateLineItem, "id" | "line_total" | "created_at">;

// ─────────────────────────────────────────────
// ESTIMATE
// ─────────────────────────────────────────────

export interface Estimate {
  id: string;                  // "EST-2026-{project#}-{estimate#}"
  project_id: string;
  version_id: string;
  margin_pct: number;
  status: EstimateStatus;
  locked_at: string | null;
  subtotal: number;
  margin_amount: number;
  gst: number;
  total: number;
  created_at: string;
  updated_at: string;
  line_items?: EstimateLineItem[];
}

// ─────────────────────────────────────────────
// AUDIT LOG (schema created now, used in Phase 3)
// ─────────────────────────────────────────────

export type AuditAction =
  | "created" | "submitted" | "reviewed" | "issued"
  | "requested" | "pending" | "approved" | "rejected" | "locked";

export interface AuditEntry {
  id: string;
  project_id: string;
  estimate_id: string | null;
  actor: string;
  action: AuditAction;
  label: string;
  note: string;
  doc: string | null;
  signature: string | null;
  hash: string | null;          // SHA-256
  created_at: string;
}
