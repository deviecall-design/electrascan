/**
 * ElectraScan — Multi-Sheet Batch Processor
 * ===========================================
 * Processes a set of PDF drawings (or a ZIP archive containing PDFs) as a
 * single project. Each file is run through the standard two-pass vision
 * pipeline, then results are aggregated, cross-validated, and de-duplicated
 * across sheets.
 *
 * Typical use: a builder sends a 12-sheet architectural + electrical plan set.
 * Upload the ZIP → get a single consolidated estimate with per-sheet breakdown.
 */

import JSZip from "jszip";
import {
  detectElectricalComponents,
  type DetectionResult,
  type DetectedComponent,
  type LegendItem,
  type ComponentType,
  type RiskFlag,
} from "./analyze_pdf";

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────

export interface SheetResult {
  filename: string;
  drawing_number: string | null;
  drawing_title: string | null;
  revision: string | null;
  result: DetectionResult;
}

export interface BatchDetectionResult {
  project_id: string;
  processed_at: string;
  files_processed: number;
  total_pages: number;
  sheets: SheetResult[];
  components: DetectedComponent[];     // Aggregated across all sheets
  legend_items: LegendItem[];          // Union of all legends (de-duplicated by description)
  risk_flags: RiskFlag[];
  estimate_subtotal: number;
  cross_sheet_warnings: CrossSheetWarning[];
}

export interface CrossSheetWarning {
  type: "DUPLICATE_COMPONENT" | "QUANTITY_MISMATCH" | "MISSING_SHEET_TYPE" | "SYMBOL_INCONSISTENCY";
  message: string;
  sheets: string[];
  severity: "high" | "medium" | "info";
}

export type BatchProgressCallback = (
  filename: string,
  index: number,
  total: number
) => void;

// ─────────────────────────────────────────────
// ZIP EXTRACTION
// ─────────────────────────────────────────────

export async function extractPDFsFromZip(zipFile: File): Promise<File[]> {
  const zip = await JSZip.loadAsync(await zipFile.arrayBuffer());
  const pdfFiles: File[] = [];

  const entries = Object.entries(zip.files).filter(
    ([name, entry]) => !entry.dir && name.toLowerCase().endsWith(".pdf")
  );

  // Sort by filename so sheet order is deterministic
  entries.sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));

  for (const [name, entry] of entries) {
    const blob = await entry.async("blob");
    const filename = name.split("/").pop() ?? name;
    pdfFiles.push(new File([blob], filename, { type: "application/pdf" }));
  }

  return pdfFiles;
}

// ─────────────────────────────────────────────
// BATCH PROCESSOR
// ─────────────────────────────────────────────

export async function processProjectDrawings(
  files: File[],
  apiKey?: string,
  onProgress?: BatchProgressCallback
): Promise<BatchDetectionResult> {
  const sheets: SheetResult[] = [];
  let totalPages = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    onProgress?.(file.name, i + 1, files.length);

    console.log(`[ElectraScan Batch] Processing ${i + 1}/${files.length}: ${file.name}`);

    const result = await detectElectricalComponents(file, `${i + 1}`.padStart(3, "0"), apiKey);
    totalPages += result.page_count;

    sheets.push({
      filename: file.name,
      drawing_number: result.title_block?.drawingNumber ?? null,
      drawing_title: result.title_block?.drawingTitle ?? null,
      revision: result.title_block?.revision ?? null,
      result,
    });
  }

  const aggregated = aggregateResults(sheets);

  return {
    project_id: `proj-${Date.now()}`,
    processed_at: new Date().toISOString(),
    files_processed: files.length,
    total_pages: totalPages,
    sheets,
    ...aggregated,
  };
}

// Convenience wrapper: accept a ZIP file and process all PDFs inside it
export async function processZipDrawings(
  zipFile: File,
  apiKey?: string,
  onProgress?: BatchProgressCallback
): Promise<BatchDetectionResult> {
  const pdfs = await extractPDFsFromZip(zipFile);
  if (pdfs.length === 0) throw new Error("No PDF files found inside the ZIP archive.");
  console.log(`[ElectraScan Batch] Extracted ${pdfs.length} PDFs from ${zipFile.name}`);
  return processProjectDrawings(pdfs, apiKey, onProgress);
}

// ─────────────────────────────────────────────
// AGGREGATION
// ─────────────────────────────────────────────

function aggregateResults(sheets: SheetResult[]): {
  components: DetectedComponent[];
  legend_items: LegendItem[];
  risk_flags: RiskFlag[];
  estimate_subtotal: number;
  cross_sheet_warnings: CrossSheetWarning[];
} {
  // Tag each component with its sheet reference
  const allComponents: DetectedComponent[] = sheets.flatMap((sheet) =>
    sheet.result.components.map((c) => ({
      ...c,
      drawing_ref: sheet.drawing_number
        ? `${sheet.drawing_number} — ${c.drawing_ref || "Sheet"}`
        : `${sheet.filename} — ${c.drawing_ref || "Sheet"}`,
    }))
  );

  // De-duplicate legend items by description (keep first occurrence)
  const legendMap = new Map<string, LegendItem>();
  for (const sheet of sheets) {
    for (const item of sheet.result.legend_items) {
      const key = item.symbol_description.toLowerCase().trim();
      if (!legendMap.has(key)) legendMap.set(key, item);
    }
  }

  // Aggregate risk flags (de-duplicate by flag+type)
  const riskMap = new Map<string, RiskFlag>();
  for (const sheet of sheets) {
    for (const flag of sheet.result.risk_flags) {
      const key = `${flag.flag}:${flag.component_type}`;
      if (!riskMap.has(key)) riskMap.set(key, flag);
    }
  }

  const estimateSubtotal = allComponents.reduce((s, c) => s + c.line_total, 0);
  const crossSheetWarnings = detectCrossSheetWarnings(sheets, allComponents);

  return {
    components: allComponents,
    legend_items: Array.from(legendMap.values()),
    risk_flags: Array.from(riskMap.values()),
    estimate_subtotal: estimateSubtotal,
    cross_sheet_warnings: crossSheetWarnings,
  };
}

// ─────────────────────────────────────────────
// CROSS-SHEET VALIDATION
// ─────────────────────────────────────────────

function detectCrossSheetWarnings(
  sheets: SheetResult[],
  allComponents: DetectedComponent[]
): CrossSheetWarning[] {
  const warnings: CrossSheetWarning[] = [];

  // Warn if the same component type appears at suspiciously similar quantities
  // across multiple sheets (may indicate the same sheet was uploaded twice)
  const sheetsWithSwitchboards = sheets.filter((s) =>
    s.result.components.some((c) => c.type === "SWITCHBOARD_MAIN")
  );
  if (sheetsWithSwitchboards.length > 1) {
    warnings.push({
      type: "DUPLICATE_COMPONENT",
      message: `Main switchboard detected on ${sheetsWithSwitchboards.length} separate sheets — verify only one main board is being quoted.`,
      sheets: sheetsWithSwitchboards.map((s) => s.filename),
      severity: "high",
    });
  }

  // Warn if no electrical legend was found on any sheet
  const noLegendSheets = sheets.filter((s) => !s.result.legend_found);
  if (noLegendSheets.length > 0 && noLegendSheets.length === sheets.length) {
    warnings.push({
      type: "MISSING_SHEET_TYPE",
      message: "No legend/key table found on any sheet. Quantities may be unreliable — verify manually.",
      sheets: noLegendSheets.map((s) => s.filename),
      severity: "high",
    });
  } else if (noLegendSheets.length > 0) {
    warnings.push({
      type: "MISSING_SHEET_TYPE",
      message: `${noLegendSheets.length} sheet(s) had no legend — components from these sheets are approximate.`,
      sheets: noLegendSheets.map((s) => s.filename),
      severity: "medium",
    });
  }

  // Check for symbol inconsistencies: same description mapped to different types across sheets
  const descTypeMap = new Map<string, Set<ComponentType>>();
  for (const sheet of sheets) {
    for (const item of sheet.result.legend_items) {
      if (!item.mapped_type) continue;
      const key = item.symbol_description.toLowerCase().trim();
      if (!descTypeMap.has(key)) descTypeMap.set(key, new Set());
      descTypeMap.get(key)!.add(item.mapped_type);
    }
  }
  for (const [desc, types] of descTypeMap) {
    if (types.size > 1) {
      warnings.push({
        type: "SYMBOL_INCONSISTENCY",
        message: `"${desc}" mapped to different component types across sheets: ${Array.from(types).join(", ")}. Check symbol consistency.`,
        sheets: sheets.map((s) => s.filename),
        severity: "medium",
      });
    }
  }

  // Quantity sanity check: flag if any single sheet has >500 components of one type
  for (const sheet of sheets) {
    const byType = new Map<ComponentType, number>();
    for (const c of sheet.result.components) {
      byType.set(c.type, (byType.get(c.type) ?? 0) + c.quantity);
    }
    for (const [type, qty] of byType) {
      if (qty > 500) {
        warnings.push({
          type: "QUANTITY_MISMATCH",
          message: `${sheet.filename}: ${type} shows ${qty} units — unusually high, verify detection accuracy.`,
          sheets: [sheet.filename],
          severity: "medium",
        });
      }
    }
  }

  return warnings;
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

export function groupBatchByType(
  result: BatchDetectionResult
): Record<ComponentType, { quantity: number; total: number; sheets: string[] }> {
  const map = {} as Record<ComponentType, { quantity: number; total: number; sheets: Set<string> }>;

  for (const c of result.components) {
    if (!map[c.type]) map[c.type] = { quantity: 0, total: 0, sheets: new Set() };
    map[c.type].quantity += c.quantity;
    map[c.type].total += c.line_total;
    // Extract the sheet name from drawing_ref
    const sheet = c.drawing_ref.split(" — ")[0];
    map[c.type].sheets.add(sheet);
  }

  return Object.fromEntries(
    Object.entries(map).map(([type, val]) => [
      type,
      { quantity: val.quantity, total: val.total, sheets: Array.from(val.sheets) },
    ])
  ) as Record<ComponentType, { quantity: number; total: number; sheets: string[] }>;
}

export function getBatchSummary(result: BatchDetectionResult): string {
  const lines = [
    `Project: ${result.project_id}`,
    `Sheets: ${result.files_processed} | Pages: ${result.total_pages}`,
    `Components: ${result.components.reduce((s, c) => s + c.quantity, 0)} items`,
    `Estimate: $${result.estimate_subtotal.toLocaleString()}`,
  ];
  if (result.cross_sheet_warnings.length > 0) {
    lines.push(`Warnings: ${result.cross_sheet_warnings.length}`);
  }
  return lines.join("\n");
}
