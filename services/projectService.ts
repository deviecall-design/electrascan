/**
 * ElectraScan — Project & Drawing Version Service
 */

import { supabase } from "./supabaseClient";
import type {
  Project,
  NewProject,
  DrawingVersion,
} from "../project.types";
import type { DetectionResult } from "../analyze_pdf";

// ─────────────────────────────────────────────
// PROJECTS
// ─────────────────────────────────────────────

export async function listProjects(): Promise<Project[]> {
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data as Project[];
}

export async function getProject(id: string): Promise<Project> {
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data as Project;
}

export async function createProject(input: NewProject): Promise<Project> {
  const { data, error } = await supabase
    .from("projects")
    .insert(input)
    .select()
    .single();
  if (error) throw error;
  return data as Project;
}

export async function updateProject(
  id: string,
  patch: Partial<Pick<Project, "name" | "address" | "client" | "builder" | "status" | "description">>
): Promise<Project> {
  const { data, error } = await supabase
    .from("projects")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as Project;
}

// ─────────────────────────────────────────────
// DRAWING VERSIONS
// ─────────────────────────────────────────────

export async function listVersions(projectId: string): Promise<DrawingVersion[]> {
  const { data, error } = await supabase
    .from("drawing_versions")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data as DrawingVersion[];
}

/** Create a new drawing version from a detection result. */
export async function createVersion(
  projectId: string,
  detection: DetectionResult,
  source: string = "Direct upload"
): Promise<DrawingVersion> {
  // Determine next version tag (V001, V002, …)
  const existing = await listVersions(projectId);
  const nextNum = existing.length + 1;
  const tag = `V${String(nextNum).padStart(3, "0")}`;

  // Mark previous active version as superseded
  if (existing.length > 0) {
    const activeIds = existing
      .filter((v) => v.status === "active")
      .map((v) => v.id);
    if (activeIds.length > 0) {
      await supabase
        .from("drawing_versions")
        .update({ status: "superseded" })
        .in("id", activeIds);
    }
  }

  const { data, error } = await supabase
    .from("drawing_versions")
    .insert({
      project_id: projectId,
      tag,
      label: `Version ${String(nextNum).padStart(3, "0")}`,
      source,
      page_count: detection.page_count,
      scale_detected: detection.scale_detected,
      legend_found: detection.legend_found,
      component_count: detection.components.length,
      status: "active",
    })
    .select()
    .single();
  if (error) throw error;
  return data as DrawingVersion;
}

/** Link an estimate ID back to the drawing version. */
export async function linkEstimateToVersion(
  versionId: string,
  estimateId: string
): Promise<void> {
  const { error } = await supabase
    .from("drawing_versions")
    .update({ estimate_id: estimateId })
    .eq("id", versionId);
  if (error) throw error;
}

// ─────────────────────────────────────────────
// PROJECT COLOURS (for card accents)
// ─────────────────────────────────────────────

const PROJECT_COLOURS = [
  "#1D6EFD", "#10B981", "#8B5CF6", "#F59E0B",
  "#EF4444", "#0EA5E9", "#EC4899", "#14B8A6",
];

export function nextProjectColour(existing: Project[]): string {
  return PROJECT_COLOURS[existing.length % PROJECT_COLOURS.length];
}
