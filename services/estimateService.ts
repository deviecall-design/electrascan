/**
 * ElectraScan — Estimate Service
 */

import { supabase } from "./supabaseClient";
import type {
  Estimate,
  EstimateLineItem,
  NewLineItem,
} from "../project.types";
import type { DetectionResult } from "../analyze_pdf";

// ─────────────────────────────────────────────
// ID GENERATION
// ─────────────────────────────────────────────

async function nextEstimateId(projectId: string): Promise<string> {
  const year = new Date().getFullYear();
  // Count existing estimates for this project to get the next sequence number
  const { count } = await supabase
    .from("estimates")
    .select("*", { count: "exact", head: true })
    .eq("project_id", projectId);

  // Use the project's numeric suffix from UUID (last 4 hex chars → int)
  const projectNum = parseInt(projectId.slice(-4), 16) % 1000;
  const seq = (count ?? 0) + 1;

  return `EST-${year}-${String(projectNum).padStart(3, "0")}-${String(seq).padStart(3, "0")}`;
}

// ─────────────────────────────────────────────
// CONVERSION: DetectionResult → LineItems
// ─────────────────────────────────────────────

const LABELS: Record<string, string> = {
  GPO_STANDARD:       "Power Point (Single)",
  GPO_DOUBLE:         "Power Point (Double)",
  GPO_WEATHERPROOF:   "Weatherproof GPO",
  GPO_USB:            "USB Power Point",
  DOWNLIGHT_RECESSED: "Downlight (Recessed)",
  PENDANT_FEATURE:    "Pendant / Feature Light",
  EXHAUST_FAN:        "Exhaust Fan",
  SWITCHING_STANDARD: "Light Switch",
  SWITCHING_DIMMER:   "Dimmer Switch",
  SWITCHING_2WAY:     "2-Way Switch",
  SWITCHBOARD_MAIN:   "Main Switchboard (MSB)",
  SWITCHBOARD_SUB:    "Sub Board",
  AC_SPLIT:           "Split System AC",
  AC_DUCTED:          "Ducted AC",
  DATA_CAT6:          "Data Point (Cat6)",
  DATA_TV:            "TV / Antenna Point",
  SECURITY_CCTV:      "CCTV Camera",
  SECURITY_INTERCOM:  "Intercom",
  SECURITY_ALARM:     "Alarm Sensor",
  EV_CHARGER:         "EV Charger",
  POOL_OUTDOOR:       "Pool / Outdoor Equipment",
  GATE_ACCESS:        "Gate / Access Control",
  AUTOMATION_HUB:     "Home Automation",
};

export function detectionToLineItems(
  estimateId: string,
  detection: DetectionResult
): NewLineItem[] {
  return detection.components.map((c, i) => ({
    estimate_id: estimateId,
    description: c.catalogue_item_name
      ? `${LABELS[c.type] ?? c.type} — ${c.catalogue_item_name}`
      : (LABELS[c.type] ?? c.type),
    unit: "EA" as const,
    qty: c.quantity,
    rate: c.unit_price,
    component_type: c.type,
    room: c.room,
    confidence: c.confidence,
    flags: c.flags as string[],
    voice_note: null,
    sort_order: i,
  }));
}

// ─────────────────────────────────────────────
// ESTIMATE CRUD
// ─────────────────────────────────────────────

export async function createEstimate(
  projectId: string,
  versionId: string,
  detection: DetectionResult,
  marginPct: number = 0
): Promise<Estimate> {
  const id = await nextEstimateId(projectId);
  const subtotal = detection.estimate_subtotal;
  const marginAmount = subtotal * (marginPct / 100);
  const gst = (subtotal + marginAmount) * 0.1;
  const total = subtotal + marginAmount + gst;

  const { data: estimateData, error: estimateError } = await supabase
    .from("estimates")
    .insert({ id, project_id: projectId, version_id: versionId, margin_pct: marginPct, subtotal, margin_amount: marginAmount, gst, total })
    .select()
    .single();
  if (estimateError) throw estimateError;

  // Insert line items
  const lineItems = detectionToLineItems(id, detection);
  if (lineItems.length > 0) {
    const { error: itemError } = await supabase
      .from("estimate_line_items")
      .insert(lineItems);
    if (itemError) throw itemError;
  }

  return { ...(estimateData as Estimate), line_items: [] };
}

export async function getEstimate(id: string): Promise<Estimate> {
  const { data, error } = await supabase
    .from("estimates")
    .select("*, line_items:estimate_line_items(*)")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data as Estimate;
}

export async function updateEstimateMargin(
  id: string,
  subtotal: number,
  marginPct: number
): Promise<Estimate> {
  const marginAmount = subtotal * (marginPct / 100);
  const gst = (subtotal + marginAmount) * 0.1;
  const total = subtotal + marginAmount + gst;

  const { data, error } = await supabase
    .from("estimates")
    .update({ margin_pct: marginPct, margin_amount: marginAmount, gst, total })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as Estimate;
}

export async function lockEstimate(id: string): Promise<Estimate> {
  const { data, error } = await supabase
    .from("estimates")
    .update({ status: "locked", locked_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as Estimate;
}

// ─────────────────────────────────────────────
// LINE ITEM CRUD
// ─────────────────────────────────────────────

export async function updateLineItem(
  id: string,
  patch: Partial<Pick<EstimateLineItem, "description" | "unit" | "qty" | "rate" | "voice_note">>
): Promise<EstimateLineItem> {
  const { data, error } = await supabase
    .from("estimate_line_items")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as EstimateLineItem;
}

export async function deleteLineItem(id: string): Promise<void> {
  const { error } = await supabase
    .from("estimate_line_items")
    .delete()
    .eq("id", id);
  if (error) throw error;
}

export async function addLineItem(item: NewLineItem): Promise<EstimateLineItem> {
  const { data, error } = await supabase
    .from("estimate_line_items")
    .insert(item)
    .select()
    .single();
  if (error) throw error;
  return data as EstimateLineItem;
}

export async function saveVoiceNote(
  itemId: string,
  transcript: string
): Promise<void> {
  const { error } = await supabase
    .from("estimate_line_items")
    .update({ voice_note: transcript })
    .eq("id", itemId);
  if (error) throw error;
}

// ─────────────────────────────────────────────
// TOTALS RECALCULATION
// ─────────────────────────────────────────────

export function recalcTotals(
  items: EstimateLineItem[],
  marginPct: number
): { subtotal: number; marginAmount: number; gst: number; total: number } {
  const subtotal = items.reduce((s, i) => s + i.qty * i.rate, 0);
  const marginAmount = subtotal * (marginPct / 100);
  const gst = (subtotal + marginAmount) * 0.1;
  const total = subtotal + marginAmount + gst;
  return { subtotal, marginAmount, gst, total };
}
