/**
 * ElectraScan — PDF Detection Engine v4
 * =======================================
 * KEY CHANGE FROM v3:
 * Pass 1 now captures BOTH symbol descriptions AND text from the legend.
 * Pass 2 uses symbol patterns as a visual decoder key for the floor plan scan.
 *
 * Logic:
 *   Pass 1 — Read legend → extract symbol visual descriptions + quantities + Vesh pricing
 *   Pass 2 — Scan floor plan using symbol decoder → distribute by room
 *   Result — Symbol-matched quantities × Vesh catalogue prices = accurate estimate
 */

import Anthropic from "@anthropic-ai/sdk";
import * as pdfjsLib from "pdfjs-dist";
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
import { mapLegendItem, type CatalogueItem } from "./vesh_catalogue";
import { extractTextFromPDF, formatOCRForPrompt, type PageTextContent } from "./ocr_extract";

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────

export type ComponentType =
  | "GPO_STANDARD" | "GPO_DOUBLE" | "GPO_WEATHERPROOF" | "GPO_USB"
  | "DOWNLIGHT_RECESSED" | "PENDANT_FEATURE" | "EXHAUST_FAN"
  | "SWITCHING_STANDARD" | "SWITCHING_DIMMER" | "SWITCHING_2WAY"
  | "SWITCHBOARD_MAIN" | "SWITCHBOARD_SUB"
  | "AC_SPLIT" | "AC_DUCTED"
  | "DATA_CAT6" | "DATA_TV"
  | "SECURITY_CCTV" | "SECURITY_INTERCOM" | "SECURITY_ALARM"
  | "EV_CHARGER" | "POOL_OUTDOOR" | "GATE_ACCESS"
  | "AUTOMATION_HUB";

export type DetectionFlag =
  | "HEIGHT_RISK" | "AUTOMATION_DEPENDENCY" | "MISSING_CIRCUIT"
  | "SCOPE_CONFIRM" | "OUTDOOR_LOCATION" | "OFF_FORM_PREMIUM"
  | "CABLE_RUN_LONG" | "LOW_CONFIDENCE" | "SYMBOL_AMBIGUOUS"
  | "LEGEND_MISMATCH" | "NOT_ELECTRICAL_SCOPE" | "FROM_LEGEND";

export interface LegendItem {
  symbol_description: string;
  symbol_visual: string;        // Visual description of the symbol e.g. "small red filled circle"
  quantity: number;
  unit: string;
  mapped_type: ComponentType | null;
  catalogue_id: string | null;
  catalogue_price: number | null;
  in_electrical_scope: boolean;
  automation_flag: boolean;
  notes: string;
}

export interface DetectedComponent {
  type: ComponentType;
  quantity: number;
  room: string;
  drawing_ref: string;
  confidence: number;
  needs_review: boolean;
  flags: DetectionFlag[];
  notes: string;
  unit_price: number;
  line_total: number;
  legend_quantity?: number;
  legend_match?: boolean;
  catalogue_item_name?: string;
  symbol_visual?: string;
}

export interface DetectionResult {
  drawing_version: string;
  page_count: number;
  processed_at: string;
  scale_detected: string;
  legend_found: boolean;
  legend_items: LegendItem[];
  components: DetectedComponent[];
  risk_flags: RiskFlag[];
  estimate_subtotal: number;
  raw_response: string;
  raw_legend_response: string;
  ocr_pages?: PageTextContent[];
  title_block?: {
    drawingNumber: string | null;
    revision: string | null;
    projectName: string | null;
    drawingTitle: string | null;
    date: string | null;
    engineer: string | null;
    scale: string | null;
  } | null;
}

export interface RiskFlag {
  flag: DetectionFlag;
  level: "high" | "medium" | "info";
  component_type: ComponentType;
  description: string;
}

// ─────────────────────────────────────────────
// FALLBACK PRICING
// ─────────────────────────────────────────────

const FALLBACK_PRICING: Record<ComponentType, number> = {
  GPO_STANDARD: 260, GPO_DOUBLE: 260, GPO_WEATHERPROOF: 290, GPO_USB: 360,
  DOWNLIGHT_RECESSED: 200, PENDANT_FEATURE: 600, EXHAUST_FAN: 215,
  SWITCHING_STANDARD: 120, SWITCHING_DIMMER: 220, SWITCHING_2WAY: 200,
  SWITCHBOARD_MAIN: 1800, SWITCHBOARD_SUB: 950,
  AC_SPLIT: 480, AC_DUCTED: 620,
  DATA_CAT6: 360, DATA_TV: 550,
  SECURITY_CCTV: 300, SECURITY_INTERCOM: 250, SECURITY_ALARM: 360,
  EV_CHARGER: 1000, POOL_OUTDOOR: 380, GATE_ACCESS: 400,
  AUTOMATION_HUB: 1200,
};

const FLAG_RISK_LEVELS: Record<DetectionFlag, RiskFlag["level"]> = {
  HEIGHT_RISK: "high", AUTOMATION_DEPENDENCY: "medium",
  MISSING_CIRCUIT: "high", SCOPE_CONFIRM: "medium",
  OUTDOOR_LOCATION: "info", OFF_FORM_PREMIUM: "info",
  CABLE_RUN_LONG: "medium", LOW_CONFIDENCE: "info",
  SYMBOL_AMBIGUOUS: "medium", LEGEND_MISMATCH: "medium",
  NOT_ELECTRICAL_SCOPE: "info", FROM_LEGEND: "info",
};

// ─────────────────────────────────────────────
// PASS 1 — SYMBOL-AWARE LEGEND EXTRACTION
// ─────────────────────────────────────────────

const LEGEND_SYSTEM_PROMPT = `You are ElectraScan reading the legend/key/schedule from an Australian electrical or architectural drawing.

Find the LEGEND, KEY or SCHEDULE table — usually in a corner of the drawing.

For EVERY row in the legend extract:
1. The SYMBOL — describe its visual appearance precisely (e.g. "small red filled circle", "blue double horizontal line", "orange arrow pointing right", "X mark in circle", "grid square with H", "star burst shape")
2. The TEXT description exactly as written
3. The quantity shown
4. Whether it needs electrical wiring or a motor connection

SCOPE RULES — include ALL of these:
✓ All lighting (downlights, LED strip, wall lights, pendants, track lights, surface lights)
✓ Power points (GPO, double power point, Hager, Zetr, weatherproof)
✓ Switches (ZETR, Dynalite, conventional, dimmer)
✓ Motorised blinds — IN SCOPE (motor wiring required)
✓ Ceiling fans — IN SCOPE
✓ Exhaust fans — IN SCOPE
✓ Heated towel rails — IN SCOPE (hardwired)
✓ Underfloor heating — IN SCOPE (dedicated circuit)
✓ Automation touchscreens, sensors, keypads
✓ Door bell, intercom, CCTV
✓ EV chargers, car charger points
✓ Smoke detectors

Return ONLY valid JSON — no markdown:
{
  "legend_found": true,
  "scale_detected": "1:50",
  "items": [
    {
      "symbol_visual": "small red filled circle",
      "symbol_description": "Recessed pair of Down Lights",
      "quantity": 18,
      "unit": "EA",
      "in_electrical_scope": true,
      "notes": "Red dot symbol on ceiling plan"
    },
    {
      "symbol_visual": "orange right-pointing arrow",
      "symbol_description": "Motorised Blind",
      "quantity": 14,
      "unit": "EA",
      "in_electrical_scope": true,
      "notes": "Motor wiring and connection required"
    },
    {
      "symbol_visual": "X mark",
      "symbol_description": "Ceiling Fan",
      "quantity": 4,
      "unit": "EA",
      "in_electrical_scope": true,
      "notes": "Ceiling fan point including wiring"
    }
  ]
}`;

// ─────────────────────────────────────────────
// PASS 2 — FLOOR PLAN SCAN WITH SYMBOL DECODER
// ─────────────────────────────────────────────

const buildFloorPlanPrompt = (legendItems: LegendItem[]): string => {
  const inScope = legendItems.filter(l => l.in_electrical_scope && l.catalogue_price);

  const symbolDecoder = inScope.map(l =>
    `  SYMBOL: ${l.symbol_visual} → "${l.symbol_description}" → ${l.quantity} EA total across whole drawing → type: ${l.mapped_type}`
  ).join("\n");

  return `You are ElectraScan scanning an Australian electrical floor plan.

SYMBOL DECODER — use this to identify every mark on the drawing:
${symbolDecoder}

YOUR JOB:
1. Scan every room on the floor plan
2. Count each symbol type in each room using the decoder above
3. The room-by-room totals MUST add up to the legend quantities
4. Use exact room names from the drawing labels

RULES:
- One entry per room per symbol type
- If a symbol appears in a corridor or unlabelled space → use "Hallway" or "General"
- Confidence: 95 if clearly visible, 80 if partially visible, 65 if inferred
- Add AUTOMATION_DEPENDENCY flag for any Dynalite/Dali/motorised items
- Add HEIGHT_RISK flag for items in voids or double-height spaces

Return ONLY valid JSON:
{
  "scale_detected": "1:50",
  "components": [
    {
      "legend_description": "Recessed pair of Down Lights",
      "type": "DOWNLIGHT_RECESSED",
      "quantity": 6,
      "room": "Kitchen",
      "drawing_ref": "Sheet 1",
      "confidence": 95,
      "flags": [],
      "notes": "Red dot symbols counted in kitchen area"
    },
    {
      "legend_description": "Motorised Blind",
      "type": "AUTOMATION_HUB",
      "quantity": 4,
      "room": "Living/Dining",
      "drawing_ref": "Sheet 1",
      "confidence": 90,
      "flags": ["AUTOMATION_DEPENDENCY"],
      "notes": "Orange arrow symbols along north wall"
    }
  ]
}`;
};

// ─────────────────────────────────────────────
// PDF → IMAGES
// ─────────────────────────────────────────────

async function pdfToImages(file: File): Promise<string[]> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
  const images: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 2.0 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext("2d")!, viewport }).promise;
    images.push(canvas.toDataURL("image/png").split(",")[1]);
  }
  return images;
}

function extractJSON(raw: string): string {
  return raw.replace(/^```(?:json)?\s*/im, "").replace(/\s*```$/im, "").trim();
}

// ─────────────────────────────────────────────
// CATALOGUE MATCHING
// ─────────────────────────────────────────────

function matchToVesh(description: string): {
  catalogueItem: CatalogueItem | null;
  price: number;
  componentType: ComponentType;
  automationFlag: boolean;
} {
  const match = mapLegendItem(description);
  if (match) {
    return {
      catalogueItem: match,
      price: match.price,
      componentType: match.componentType as ComponentType,
      automationFlag: match.automationFlag ?? false,
    };
  }

  const d = description.toLowerCase()
    .replace(/zetr t3/g, "zetr 13")   // normalise T3 → 13
    .replace(/zetr t2/g, "zetr 12");  // normalise T2 → 12

  // ── Check SWITCHES first — before any GPO checks ──
  // This prevents "ZETR 13 series light switch" matching the $525 GPO price
  if (d.includes("light switch") || d.includes("series light switch") ||
      (d.includes("switch") && !d.includes("power") && !d.includes("gpo") && !d.includes("powerpoint"))) {
    if (d.includes("dynalite") || d.includes("dali")) return { catalogueItem: null, price: 180, componentType: "SWITCHING_STANDARD", automationFlag: true };
    if (d.includes("dimmer")) return { catalogueItem: null, price: 220, componentType: "SWITCHING_DIMMER", automationFlag: false };
    if (d.includes("2 way") || d.includes("2-way")) return { catalogueItem: null, price: 200, componentType: "SWITCHING_2WAY", automationFlag: false };
    if (d.includes("3 way") || d.includes("3-way")) return { catalogueItem: null, price: 250, componentType: "SWITCHING_STANDARD", automationFlag: false };
    return { catalogueItem: null, price: 120, componentType: "SWITCHING_STANDARD", automationFlag: false };
  }

  // ── Lighting ──
  if (d.includes("track light")) return { catalogueItem: null, price: 1000, componentType: "DOWNLIGHT_RECESSED", automationFlag: false };
  if (d.includes("led strip") && (d.includes("dali") || d.includes("dynalite"))) return { catalogueItem: null, price: 450, componentType: "DOWNLIGHT_RECESSED", automationFlag: true };
  if (d.includes("led strip") || d.includes("strip light")) return { catalogueItem: null, price: 400, componentType: "DOWNLIGHT_RECESSED", automationFlag: false };
  if (d.includes("wall light") || d.includes("art light")) return { catalogueItem: null, price: 250, componentType: "DOWNLIGHT_RECESSED", automationFlag: false };
  if (d.includes("pendant") || d.includes("feature light")) return { catalogueItem: null, price: 600, componentType: "PENDANT_FEATURE", automationFlag: false };
  if (d.includes("surface can") || d.includes("can light")) return { catalogueItem: null, price: 200, componentType: "DOWNLIGHT_RECESSED", automationFlag: false };
  if (d.includes("downlight") || d.includes("down light") || d.includes("recessed")) return { catalogueItem: null, price: 200, componentType: "DOWNLIGHT_RECESSED", automationFlag: false };

  // ── Automation & special ──
  if (d.includes("automation touchscreen")) return { catalogueItem: null, price: 1200, componentType: "AUTOMATION_HUB", automationFlag: true };
  if (d.includes("motorised blind") || d.includes("blind motor")) return { catalogueItem: null, price: 380, componentType: "AUTOMATION_HUB", automationFlag: true };
  if (d.includes("dynalite") || d.includes("dali")) return { catalogueItem: null, price: 180, componentType: "SWITCHING_STANDARD", automationFlag: true };

  // ── Fans ──
  if (d.includes("ceiling fan")) return { catalogueItem: null, price: 450, componentType: "EXHAUST_FAN", automationFlag: false };
  if (d.includes("exhaust fan")) return { catalogueItem: null, price: 215, componentType: "EXHAUST_FAN", automationFlag: false };

  // ── GPO / Power points — Zetr brand variants FIRST ──
  const isGPO = d.includes("gpo") || d.includes("power point") || d.includes("powerpoint") || d.includes("double power");
  if (isGPO || d.includes("zetr 13") || d.includes("zetr 12")) {
    if ((d.includes("zetr 13") || d.includes("zetr t3")) && d.includes("carbon")) return { catalogueItem: null, price: 750, componentType: "GPO_DOUBLE", automationFlag: false };
    if ((d.includes("zetr 13") || d.includes("zetr t3")) && d.includes("usb")) return { catalogueItem: null, price: 650, componentType: "GPO_USB", automationFlag: false };
    if (d.includes("zetr 13") || d.includes("zetr t3")) return { catalogueItem: null, price: 525, componentType: "GPO_DOUBLE", automationFlag: false };
    if (d.includes("zetr 12") || d.includes("zetr t2")) return { catalogueItem: null, price: 425, componentType: "GPO_DOUBLE", automationFlag: false };
    if (d.includes("weatherproof") || d.includes("wp")) return { catalogueItem: null, price: 290, componentType: "GPO_WEATHERPROOF", automationFlag: false };
    if (d.includes("usb")) return { catalogueItem: null, price: 360, componentType: "GPO_USB", automationFlag: false };
    return { catalogueItem: null, price: 260, componentType: "GPO_DOUBLE", automationFlag: false };
  }

  // ── Other ──
  if (d.includes("sensor") || d.includes("light sensor") || d.includes("pir")) return { catalogueItem: null, price: 380, componentType: "SWITCHING_STANDARD", automationFlag: false };
  if (d.includes("towel rail")) return { catalogueItem: null, price: 450, componentType: "GPO_STANDARD", automationFlag: false };
  if (d.includes("underfloor")) return { catalogueItem: null, price: 450, componentType: "GPO_STANDARD", automationFlag: false };
  if (d.includes("intercom") || d.includes("door bell")) return { catalogueItem: null, price: 250, componentType: "SECURITY_INTERCOM", automationFlag: false };
  if (d.includes("dual tv") || d.includes("tv/data") || d.includes("data outlet") || d.includes("tv data")) return { catalogueItem: null, price: 550, componentType: "DATA_TV", automationFlag: false };

  return { catalogueItem: null, price: 200, componentType: "DOWNLIGHT_RECESSED", automationFlag: false };
}

// ─────────────────────────────────────────────
// ENRICH LEGEND ITEMS
// ─────────────────────────────────────────────

function enrichLegendItems(rawItems: any[]): LegendItem[] {
  return rawItems.map(item => {
    const { catalogueItem, price, componentType, automationFlag } =
      matchToVesh(item.symbol_description ?? "");
    return {
      symbol_description: item.symbol_description ?? "",
      symbol_visual: item.symbol_visual ?? "unknown symbol",
      quantity: item.quantity ?? 0,
      unit: item.unit ?? "EA",
      mapped_type: componentType,
      catalogue_id: catalogueItem?.id ?? null,
      catalogue_price: price,
      in_electrical_scope: item.in_electrical_scope !== false,
      automation_flag: automationFlag,
      notes: item.notes ?? "",
    };
  });
}

// ─────────────────────────────────────────────
// BUILD FINAL COMPONENT LIST
// ─────────────────────────────────────────────

function buildComponents(legendItems: LegendItem[], roomComponents: any[]): DetectedComponent[] {
  const components: DetectedComponent[] = [];
  const legendByDesc = new Map<string, LegendItem>();
  legendItems.forEach(l => legendByDesc.set(l.symbol_description.toLowerCase(), l));

  // Process room distribution
  for (const c of roomComponents) {
    const legendDesc = (c.legend_description ?? "").toLowerCase();
    let legendItem: LegendItem | undefined = legendByDesc.get(legendDesc);

    if (!legendItem) {
      for (const [key, item] of legendByDesc) {
        if (key.includes(legendDesc) || legendDesc.includes(key)) {
          legendItem = item; break;
        }
      }
    }
    if (!legendItem) {
      legendItem = legendItems.find(l => l.mapped_type === c.type && l.in_electrical_scope);
    }

    const price = legendItem?.catalogue_price ?? FALLBACK_PRICING[c.type as ComponentType] ?? 200;
    const qty = c.quantity ?? 1;
    const flags: DetectionFlag[] = [...(c.flags ?? [])];
    if (legendItem?.automation_flag && !flags.includes("AUTOMATION_DEPENDENCY")) {
      flags.push("AUTOMATION_DEPENDENCY");
    }

    components.push({
      type: (c.type ?? "DOWNLIGHT_RECESSED") as ComponentType,
      quantity: qty,
      room: c.room ?? "General",
      drawing_ref: c.drawing_ref ?? "",
      confidence: c.confidence ?? 85,
      needs_review: (c.confidence ?? 85) < 90,
      flags,
      notes: c.notes ?? "",
      unit_price: price,
      line_total: price * qty,
      legend_quantity: legendItem?.quantity,
      legend_match: true,
      catalogue_item_name: legendItem?.symbol_description,
      symbol_visual: legendItem?.symbol_visual,
    });
  }

  // Add any legend items completely missed by room scan
  const coveredDescs = new Set(roomComponents.map(c => (c.legend_description ?? "").toLowerCase()));

  for (const l of legendItems) {
    if (!l.in_electrical_scope || !l.catalogue_price || l.quantity === 0) continue;
    const desc = l.symbol_description.toLowerCase();
    const covered = [...coveredDescs].some(d => d.includes(desc) || desc.includes(d));
    if (!covered) {
      console.log(`[ElectraScan v4] Adding missed legend item: ${l.symbol_description} ×${l.quantity} @ $${l.catalogue_price}`);
      const flags: DetectionFlag[] = ["FROM_LEGEND"];
      if (l.automation_flag) flags.push("AUTOMATION_DEPENDENCY");
      components.push({
        type: (l.mapped_type ?? "DOWNLIGHT_RECESSED") as ComponentType,
        quantity: l.quantity,
        room: "General",
        drawing_ref: "From legend",
        confidence: 85,
        needs_review: false,
        flags,
        notes: `${l.symbol_description} — ${l.quantity} ${l.unit} per legend. Symbol: ${l.symbol_visual}`,
        unit_price: l.catalogue_price,
        line_total: l.catalogue_price * l.quantity,
        legend_quantity: l.quantity,
        legend_match: true,
        catalogue_item_name: l.symbol_description,
        symbol_visual: l.symbol_visual,
      });
    }
  }

  return components;
}

function generateRiskFlags(components: DetectedComponent[]): RiskFlag[] {
  const descriptions: Record<DetectionFlag, string> = {
    HEIGHT_RISK: "Fitting above 3.5m — scaffold or EWP required.",
    AUTOMATION_DEPENDENCY: "Automation system detected — Dynalite/Dali programmer required. Budget separately.",
    MISSING_CIRCUIT: "Equipment shown but no dedicated circuit on electrical drawing.",
    SCOPE_CONFIRM: "Confirm scope with architect.",
    OUTDOOR_LOCATION: "External install — confirm IP rating.",
    OFF_FORM_PREMIUM: "Off-form concrete — premium applies.",
    CABLE_RUN_LONG: "Cable run exceeds 20m — verify and add allowance.",
    LOW_CONFIDENCE: "Verify quantity on drawing before quoting.",
    SYMBOL_AMBIGUOUS: "Symbol unclear — manual check required.",
    LEGEND_MISMATCH: "Detected count differs from legend — verify on drawing.",
    NOT_ELECTRICAL_SCOPE: "Item excluded from electrical scope.",
    FROM_LEGEND: "Quantity taken from legend — room location unconfirmed.",
  };

  const flags: RiskFlag[] = [];
  const seen = new Set<string>();
  for (const c of components) {
    for (const flag of c.flags) {
      if (flag === "FROM_LEGEND") continue;
      const key = `${flag}:${c.type}`;
      if (!seen.has(key)) {
        seen.add(key);
        flags.push({ flag, level: FLAG_RISK_LEVELS[flag], component_type: c.type, description: descriptions[flag] });
      }
    }
  }
  return flags;
}

// ─────────────────────────────────────────────
// MAIN — TWO-PASS WITH SYMBOL DECODER
// ─────────────────────────────────────────────

export async function detectElectricalComponents(
  file: File,
  drawingVersion: string = "001",
  apiKey?: string
): Promise<DetectionResult> {
  const client = new Anthropic({
    apiKey: apiKey ?? (import.meta as any).env.VITE_ANTHROPIC_API_KEY,
    dangerouslyAllowBrowser: true,
  });

  console.log(`[ElectraScan v4] Converting: ${file.name}`);
  const [pageImages, ocrPages] = await Promise.all([
    pdfToImages(file),
    extractTextFromPDF(file).catch(() => [] as PageTextContent[]),
  ]);

  const ocrContext = ocrPages.length > 0 ? formatOCRForPrompt(ocrPages) : "";
  const titleBlock = ocrPages[0]?.titleBlock ?? null;

  if (ocrContext) {
    console.log(`[ElectraScan v4] OCR: extracted text from ${ocrPages.length} pages`);
  }

  const imageBlocks: Anthropic.ImageBlockParam[] = pageImages.map(base64 => ({
    type: "image" as const,
    source: { type: "base64" as const, media_type: "image/png" as const, data: base64 },
  }));

  // ── PASS 1: Symbol-aware legend extraction ────
  console.log("[ElectraScan v4] Pass 1: Reading legend + symbols...");
  let rawLegendResponse = "";
  let legendItems: LegendItem[] = [];
  let legendFound = false;
  let scaleDetected = "unknown";

  try {
    const r = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2000,
      system: LEGEND_SYSTEM_PROMPT,
      messages: [{
        role: "user",
        content: [
          ...imageBlocks,
          {
            type: "text",
            text: `Drawing: ${file.name}. Find the legend table and extract every item including its visual symbol appearance. Include ALL items that need electrical wiring including motorised blinds, ceiling fans, LED strips, heated towel rails.${ocrContext ? `\n\nEMBEDDED TEXT LAYER (use to verify legend labels and quantities):\n${ocrContext}` : ""}`,
          },
        ],
      }],
    });
    rawLegendResponse = r.content[0].type === "text" ? r.content[0].text : "";
    const parsed = JSON.parse(extractJSON(rawLegendResponse));
    legendFound = parsed.legend_found ?? false;
    scaleDetected = parsed.scale_detected ?? "unknown";
    legendItems = enrichLegendItems(parsed.items ?? []);

    const legendSubtotal = legendItems.filter(l => l.in_electrical_scope && l.catalogue_price)
      .reduce((s, l) => s + (l.catalogue_price! * l.quantity), 0);
    console.log(`[ElectraScan v4] Legend: ${legendItems.length} items, $${legendSubtotal.toLocaleString()} subtotal`);
    legendItems.filter(l => l.in_electrical_scope).forEach(l => {
      console.log(`  [${l.symbol_visual}] ${l.symbol_description}: ${l.quantity} EA @ $${l.catalogue_price}`);
    });
  } catch (err) {
    console.warn("[ElectraScan v4] Legend extraction failed:", err);
  }

  // ── PASS 2: Floor plan scan with symbol decoder ─
  console.log("[ElectraScan v4] Pass 2: Scanning floor plan with symbol decoder...");
  let rawResponse = "";
  let roomComponents: any[] = [];

  try {
    const r = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: buildFloorPlanPrompt(legendItems),
      messages: [{
        role: "user",
        content: [
          ...imageBlocks,
          {
            type: "text",
            text: `Drawing: ${file.name}. Scan every room and count each symbol type using the decoder. Total quantities must match the legend.${ocrContext ? `\n\nEMBEDDED TEXT (use room labels and annotations from this layer to name rooms accurately):\n${ocrContext}` : ""}`,
          },
        ],
      }],
    });
    rawResponse = r.content[0].type === "text" ? r.content[0].text : "";
    const parsed = JSON.parse(extractJSON(rawResponse));
    if (parsed.scale_detected && scaleDetected === "unknown") scaleDetected = parsed.scale_detected;
    roomComponents = parsed.components ?? [];
    console.log(`[ElectraScan v4] Room distribution: ${roomComponents.length} entries across rooms`);
  } catch (err) {
    console.warn("[ElectraScan v4] Room scan failed:", err);
  }

  const components = buildComponents(legendItems, roomComponents);
  const riskFlags = generateRiskFlags(components);
  const estimateSubtotal = components.reduce((s, c) => s + c.line_total, 0);

  console.log(`[ElectraScan v4] Complete: ${components.length} items, $${estimateSubtotal.toLocaleString()}`);

  return {
    drawing_version: drawingVersion,
    page_count: pageImages.length,
    processed_at: new Date().toISOString(),
    scale_detected: scaleDetected,
    legend_found: legendFound,
    legend_items: legendItems,
    components,
    risk_flags: riskFlags,
    estimate_subtotal: estimateSubtotal,
    raw_response: rawResponse,
    raw_legend_response: rawLegendResponse,
    ocr_pages: ocrPages,
    title_block: titleBlock,
  };
}

// ── HELPERS ────────────────────────────────────

export function groupByRoom(components: DetectedComponent[]): Record<string, DetectedComponent[]> {
  return components.reduce((acc, c) => {
    const room = c.room || "General";
    if (!acc[room]) acc[room] = [];
    acc[room].push(c);
    return acc;
  }, {} as Record<string, DetectedComponent[]>);
}

export function getReviewItems(components: DetectedComponent[]): DetectedComponent[] {
  return components.filter(c => c.needs_review);
}
