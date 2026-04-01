/**
 * ElectraScan — PDF Detection Engine
 * ====================================
 * Accepts a PDF file (from email attachment, upload, or camera capture),
 * converts each page to a base64 image, sends to Claude Vision,
 * and returns a structured list of detected electrical components
 * mapped to Vesh pricing ready for the estimate engine.
 *
 * Based on DetectionSpec v1.0 — 31 March 2026
 * Do not modify component type keys or flag identifiers without
 * updating the pricing map and Zod schema simultaneously.
 */

import Anthropic from "@anthropic-ai/sdk";
import * as pdfjsLib from "pdfjs-dist";

// ─────────────────────────────────────────────
// 1. COMPONENT TYPES  (must match DetectionSpec §2 exactly)
// ─────────────────────────────────────────────

export type ComponentType =
  // Power
  | "GPO_STANDARD"
  | "GPO_DOUBLE"
  | "GPO_WEATHERPROOF"
  | "GPO_USB"
  // Lighting
  | "DOWNLIGHT_RECESSED"
  | "PENDANT_FEATURE"
  | "EXHAUST_FAN"
  // Switching
  | "SWITCHING_STANDARD"
  | "SWITCHING_DIMMER"
  | "SWITCHING_2WAY"
  // Switchboard
  | "SWITCHBOARD_MAIN"
  | "SWITCHBOARD_SUB"
  // Air conditioning
  | "AC_SPLIT"
  | "AC_DUCTED"
  // Data / Comms
  | "DATA_CAT6"
  | "DATA_TV"
  // Security
  | "SECURITY_CCTV"
  | "SECURITY_INTERCOM"
  | "SECURITY_ALARM"
  // EV / Pool / Access
  | "EV_CHARGER"
  | "POOL_OUTDOOR"
  | "GATE_ACCESS"
  // Automation
  | "AUTOMATION_HUB";

// ─────────────────────────────────────────────
// 2. FLAG IDENTIFIERS  (DetectionSpec §3)
// ─────────────────────────────────────────────

export type DetectionFlag =
  | "HEIGHT_RISK"         // Fitting > 3.5m — scaffold/crane required
  | "AUTOMATION_DEPENDENCY" // Requires C-Bus/KNX/Dali programmer
  | "MISSING_CIRCUIT"     // Equipment shown but no circuit on drawing
  | "SCOPE_CONFIRM"       // Unclear if in-scope — needs estimator call
  | "OUTDOOR_LOCATION"    // External install — weatherproof required
  | "OFF_FORM_PREMIUM"    // Off-form concrete — premium applies
  | "CABLE_RUN_LONG"      // Cable run > 20m from MSB
  | "LOW_CONFIDENCE"      // Confidence 50–69 — estimator must verify
  | "SYMBOL_AMBIGUOUS";   // Confidence < 50 — excluded from estimate

// ─────────────────────────────────────────────
// 3. DETECTED COMPONENT  (DetectionSpec §4)
// ─────────────────────────────────────────────

export interface DetectedComponent {
  type: ComponentType;
  quantity: number;
  room: string;               // e.g. "Kitchen", "Bed 2", "Outdoor"
  drawing_ref: string;        // e.g. "E-01 Sheet 3"
  confidence: number;         // 0–100
  needs_review: boolean;      // true if confidence < 90
  flags: DetectionFlag[];
  notes: string;              // Any extra context from drawing
  unit_price: number;         // From Vesh pricing map
  line_total: number;         // unit_price × quantity (+ off-form if flagged)
}

// ─────────────────────────────────────────────
// 4. DETECTION RESULT  (full response shape)
// ─────────────────────────────────────────────

export interface DetectionResult {
  drawing_version: string;    // e.g. "001"
  page_count: number;
  processed_at: string;       // ISO timestamp
  scale_detected: string;     // e.g. "1:100" or "unknown"
  components: DetectedComponent[];
  risk_flags: RiskFlag[];
  estimate_subtotal: number;  // Sum of all line_totals (excludes GST)
  raw_response: string;       // Always stored for debugging
}

export interface RiskFlag {
  flag: DetectionFlag;
  level: "high" | "medium" | "info";
  component_type: ComponentType;
  description: string;
}

// ─────────────────────────────────────────────
// 5. VESH PRICING MAP  (DetectionSpec §7)
// ─────────────────────────────────────────────

const VESH_PRICING: Record<ComponentType, number> = {
  // Power
  GPO_STANDARD:       260,
  GPO_DOUBLE:         310,
  GPO_WEATHERPROOF:   410,
  GPO_USB:            380,
  // Lighting
  DOWNLIGHT_RECESSED: 220,
  PENDANT_FEATURE:    260,
  EXHAUST_FAN:        195,
  // Switching
  SWITCHING_STANDARD: 120,
  SWITCHING_DIMMER:   285,
  SWITCHING_2WAY:     165,
  // Switchboard
  SWITCHBOARD_MAIN:   1800,
  SWITCHBOARD_SUB:    950,
  // Air conditioning
  AC_SPLIT:           480,
  AC_DUCTED:          620,
  // Data / Comms
  DATA_CAT6:          185,
  DATA_TV:            145,
  // Security
  SECURITY_CCTV:      380,
  SECURITY_INTERCOM:  650,
  SECURITY_ALARM:     220,
  // EV / Pool / Access
  EV_CHARGER:         850,
  POOL_OUTDOOR:       420,
  GATE_ACCESS:        680,
  // Automation
  AUTOMATION_HUB:     1200,
};

const OFF_FORM_PREMIUM_DEFAULT = 150; // Per point when OFF_FORM_PREMIUM flagged

// Risk level map for flag → severity
const FLAG_RISK_LEVELS: Record<DetectionFlag, RiskFlag["level"]> = {
  HEIGHT_RISK:           "high",
  AUTOMATION_DEPENDENCY: "medium",
  MISSING_CIRCUIT:       "high",
  SCOPE_CONFIRM:         "medium",
  OUTDOOR_LOCATION:      "info",
  OFF_FORM_PREMIUM:      "info",
  CABLE_RUN_LONG:        "medium",
  LOW_CONFIDENCE:        "info",
  SYMBOL_AMBIGUOUS:      "medium",
};

// ─────────────────────────────────────────────
// 6. CLAUDE VISION SYSTEM PROMPT  (DetectionSpec §5)
// ─────────────────────────────────────────────

const ELECTRASCAN_SYSTEM_PROMPT = `You are ElectraScan, an AI assistant specialised in reading Australian residential and light-commercial electrical drawings.

Your job is to detect every electrical component on the drawing and return a structured JSON response.

COMPONENT TYPES you must detect (use ONLY these exact type keys):
Power: GPO_STANDARD, GPO_DOUBLE, GPO_WEATHERPROOF, GPO_USB
Lighting: DOWNLIGHT_RECESSED, PENDANT_FEATURE, EXHAUST_FAN
Switching: SWITCHING_STANDARD, SWITCHING_DIMMER, SWITCHING_2WAY
Switchboard: SWITCHBOARD_MAIN, SWITCHBOARD_SUB
Air Conditioning: AC_SPLIT, AC_DUCTED
Data/Comms: DATA_CAT6, DATA_TV
Security: SECURITY_CCTV, SECURITY_INTERCOM, SECURITY_ALARM
EV/Pool/Access: EV_CHARGER, POOL_OUTDOOR, GATE_ACCESS
Automation: AUTOMATION_HUB

FLAGS to apply when conditions are met:
- HEIGHT_RISK: any fitting shown at > 3.5m height (void, double-height ceiling)
- AUTOMATION_DEPENDENCY: C-Bus, KNX, Dali, or smart switch annotations present
- MISSING_CIRCUIT: equipment shown on plan but no circuit shown on electrical drawing
- SCOPE_CONFIRM: symbol unclear or component may be in a different trade's scope
- OUTDOOR_LOCATION: component is on an external wall or outdoor area
- OFF_FORM_PREMIUM: component is in an off-form concrete area
- CABLE_RUN_LONG: estimated cable run from MSB exceeds 20 metres
- LOW_CONFIDENCE: symbol is present but unclear — confidence 50–69
- SYMBOL_AMBIGUOUS: symbol cannot be reliably identified — confidence < 50

CONFIDENCE RULES:
- 90–100: Clear, unambiguous symbol. Auto-confirm.
- 70–89: Symbol present but unclear annotation. Flag needs_review: true.
- 50–69: Context-based inference. Add LOW_CONFIDENCE flag.
- 0–49: Too uncertain. Add SYMBOL_AMBIGUOUS flag. Still include in response.

SCALE: Try to read the drawing scale from the scale bar or title block (e.g. "1:100"). Report it in scale_detected. If not found, report "unknown".

RESPONSE FORMAT: Return ONLY a valid JSON object — no markdown, no explanation, no code fences.

{
  "scale_detected": "1:100",
  "components": [
    {
      "type": "GPO_DOUBLE",
      "quantity": 6,
      "room": "Kitchen",
      "drawing_ref": "E-01 Sheet 1",
      "confidence": 95,
      "needs_review": false,
      "flags": [],
      "notes": "Shown above bench height on north wall"
    }
  ]
}

IMPORTANT RULES:
- Count every instance — do not group across rooms. One entry per room per type.
- If a symbol appears in multiple rooms, create separate entries.
- Never invent components not visible on the drawing.
- If in doubt, include the component with a LOW_CONFIDENCE flag rather than omit it.
- Return ONLY the JSON object. No other text.`;

// ─────────────────────────────────────────────
// 7. PDF → IMAGE CONVERSION
// ─────────────────────────────────────────────

/**
 * Converts a PDF file to an array of base64-encoded PNG images,
 * one per page, at high resolution suitable for Claude Vision.
 */
async function pdfToImages(file: File): Promise<string[]> {
  const arrayBuffer = await file.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);

  const pdfDoc = await pdfjsLib.getDocument({ data: uint8Array }).promise;
  const pageCount = pdfDoc.numPages;
  const images: string[] = [];

  for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
    const page = await pdfDoc.getPage(pageNum);

    // Render at 2x scale for better symbol recognition
    const scale = 2.0;
    const viewport = page.getViewport({ scale });

    // Create an offscreen canvas
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d")!;

    await page.render({
      canvasContext: ctx,
      viewport,
    }).promise;

    // Convert to base64 PNG (strip the data:image/png;base64, prefix)
    const dataUrl = canvas.toDataURL("image/png");
    const base64 = dataUrl.split(",")[1];
    images.push(base64);
  }

  return images;
}

// ─────────────────────────────────────────────
// 8. JSON EXTRACTION  (DetectionSpec §11)
// ─────────────────────────────────────────────

/**
 * Strip markdown fences Claude occasionally wraps around JSON
 * despite the system prompt instructing otherwise.
 */
function extractJSON(raw: string): string {
  return raw
    .replace(/^```(?:json)?\s*/im, "")
    .replace(/\s*```$/im, "")
    .trim();
}

// ─────────────────────────────────────────────
// 9. PRICING & FLAG ENRICHMENT
// ─────────────────────────────────────────────

/**
 * Takes raw Claude output components and enriches them with:
 * - Unit price from Vesh pricing map
 * - Line total (with off-form premium if flagged)
 * - Forced LOW_CONFIDENCE flag injection (DetectionSpec §11)
 * - needs_review enforcement
 */
function enrichComponents(
  rawComponents: Omit<
    DetectedComponent,
    "unit_price" | "line_total"
  >[]
): DetectedComponent[] {
  return rawComponents
    .filter((c) => c.confidence >= 50) // Exclude < 50 from estimate
    .map((c) => {
      // Force LOW_CONFIDENCE flag if confidence < 70 (DetectionSpec §11)
      const flags = [...c.flags];
      if (c.confidence < 70 && !flags.includes("LOW_CONFIDENCE")) {
        flags.push("LOW_CONFIDENCE");
      }

      const unitPrice = VESH_PRICING[c.type] ?? 0;
      const offFormPremium = flags.includes("OFF_FORM_PREMIUM")
        ? OFF_FORM_PREMIUM_DEFAULT
        : 0;
      const effectiveUnitPrice = unitPrice + offFormPremium;

      return {
        ...c,
        flags,
        needs_review: c.confidence < 90,
        unit_price: effectiveUnitPrice,
        line_total: effectiveUnitPrice * c.quantity,
      };
    });
}

/**
 * Generates risk flag records from component flags.
 */
function generateRiskFlags(components: DetectedComponent[]): RiskFlag[] {
  const flags: RiskFlag[] = [];

  const riskDescriptions: Record<DetectionFlag, string> = {
    HEIGHT_RISK:
      "Fitting installed above 3.5m — scaffold or EWP required. Add height allowance to estimate.",
    AUTOMATION_DEPENDENCY:
      "Smart switching or automation protocol detected. Requires licensed programmer — add to scope.",
    MISSING_CIRCUIT:
      "Equipment shown on architectural plan but no dedicated circuit on electrical drawing. Confirm scope with architect.",
    SCOPE_CONFIRM:
      "Symbol unclear — confirm with architect whether this item is in the electrical scope.",
    OUTDOOR_LOCATION:
      "External installation — confirm IP rating and weatherproofing requirement.",
    OFF_FORM_PREMIUM:
      "Off-form concrete finish. Off-form premium of $100–$200 per point applies.",
    CABLE_RUN_LONG:
      "Estimated cable run exceeds 20m from MSB. Verify run length and add cable allowance.",
    LOW_CONFIDENCE:
      "Symbol detected but unclear. Estimator should verify quantity and type on drawing.",
    SYMBOL_AMBIGUOUS:
      "Symbol could not be reliably identified. Manual check required before including in estimate.",
  };

  for (const component of components) {
    for (const flag of component.flags) {
      // Only add each flag type once per component type
      const alreadyAdded = flags.some(
        (f) => f.flag === flag && f.component_type === component.type
      );
      if (!alreadyAdded) {
        flags.push({
          flag,
          level: FLAG_RISK_LEVELS[flag],
          component_type: component.type,
          description: riskDescriptions[flag],
        });
      }
    }
  }

  return flags;
}

// ─────────────────────────────────────────────
// 10. MAIN DETECTION FUNCTION
// ─────────────────────────────────────────────

/**
 * Primary entry point for ElectraScan detection.
 *
 * Usage:
 *   const result = await detectElectricalComponents(file, "001");
 *
 * @param file          - The PDF file from the tradie's email or upload
 * @param drawingVersion - Version string e.g. "001", "002"
 * @param apiKey        - Anthropic API key (defaults to env var)
 */
export async function detectElectricalComponents(
  file: File,
  drawingVersion: string = "001",
  apiKey?: string
): Promise<DetectionResult> {
  const client = new Anthropic({
    apiKey: apiKey ?? import.meta.env.VITE_ANTHROPIC_API_KEY,
    dangerouslyAllowBrowser: true,
  });

  // Step 1: Convert PDF pages to images
  console.log(`[ElectraScan] Converting PDF: ${file.name}`);
  const pageImages = await pdfToImages(file);
  const pageCount = pageImages.length;
  console.log(`[ElectraScan] Converted ${pageCount} pages`);

  // Step 2: Build multi-image message — send all pages in one call
  // Claude Vision can handle multiple images in a single request
  const imageContent: Anthropic.ImageBlockParam[] = pageImages.map(
    (base64, i) => ({
      type: "image" as const,
      source: {
        type: "base64" as const,
        media_type: "image/png" as const,
        data: base64,
      },
    })
  );

  const userMessage = `Drawing file: ${file.name}. Drawing version: ${drawingVersion}. This PDF has ${pageCount} page(s). Detect all electrical components across all pages and return the JSON response.`;

  // Step 3: Call Claude Vision
  console.log(`[ElectraScan] Sending to Claude Vision...`);
  let rawResponse = "";

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: ELECTRASCAN_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            ...imageContent,
            {
              type: "text",
              text: userMessage,
            },
          ],
        },
      ],
    });

    rawResponse =
      response.content[0].type === "text" ? response.content[0].text : "";
  } catch (err) {
    console.error("[ElectraScan] Claude Vision API error:", err);
    throw new Error(`Detection failed: ${err}`);
  }

  // Step 4: Parse JSON (strip fences defensively)
  let parsedResponse: {
    scale_detected: string;
    components: Omit<DetectedComponent, "unit_price" | "line_total">[];
  };

  try {
    const cleaned = extractJSON(rawResponse);
    parsedResponse = JSON.parse(cleaned);
  } catch (err) {
    console.error("[ElectraScan] JSON parse error. Raw response:", rawResponse);
    throw new Error(
      `Failed to parse Claude response as JSON. Raw response stored for debugging.`
    );
  }

  // Step 5: Enrich with Vesh pricing + flag injection
  const enrichedComponents = enrichComponents(parsedResponse.components ?? []);

  // Step 6: Generate risk flags
  const riskFlags = generateRiskFlags(enrichedComponents);

  // Step 7: Calculate estimate subtotal
  const estimateSubtotal = enrichedComponents.reduce(
    (sum, c) => sum + c.line_total,
    0
  );

  const result: DetectionResult = {
    drawing_version: drawingVersion,
    page_count: pageCount,
    processed_at: new Date().toISOString(),
    scale_detected: parsedResponse.scale_detected ?? "unknown",
    components: enrichedComponents,
    risk_flags: riskFlags,
    estimate_subtotal: estimateSubtotal,
    raw_response: rawResponse, // Always store (DetectionSpec §11)
  };

  console.log(
    `[ElectraScan] Detection complete: ${enrichedComponents.length} components, $${estimateSubtotal.toLocaleString()} subtotal`
  );

  return result;
}

// ─────────────────────────────────────────────
// 11. HELPER — FORMAT RESULT FOR UI
// ─────────────────────────────────────────────

/**
 * Groups detected components by room for the component schedule UI.
 */
export function groupByRoom(
  components: DetectedComponent[]
): Record<string, DetectedComponent[]> {
  return components.reduce(
    (acc, component) => {
      const room = component.room || "Unknown";
      if (!acc[room]) acc[room] = [];
      acc[room].push(component);
      return acc;
    },
    {} as Record<string, DetectedComponent[]>
  );
}

/**
 * Returns only components that need estimator review.
 */
export function getReviewItems(
  components: DetectedComponent[]
): DetectedComponent[] {
  return components.filter((c) => c.needs_review);
}

/**
 * Returns a summary count by component type.
 */
export function getComponentSummary(
  components: DetectedComponent[]
): Record<string, number> {
  return components.reduce(
    (acc, c) => {
      acc[c.type] = (acc[c.type] ?? 0) + c.quantity;
      return acc;
    },
    {} as Record<string, number>
  );
}
