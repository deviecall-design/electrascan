/**
 * ElectraScan — Single-Line Diagram (SLD) Parser
 * ================================================
 * Detects whether a drawing page is a single-line diagram (as opposed to a
 * floor plan) and, if so, extracts the electrical circuit topology including
 * panel hierarchy, circuit numbers, breaker ratings, and load descriptions.
 *
 * SLDs are the "wiring schematic" view of an electrical installation. They
 * show how circuits connect from the main switchboard → sub-boards → final
 * circuits. Parsing them unlocks:
 *   - Circuit count validation (cross-check against floor plan takeoff)
 *   - Breaker sizing and load calculation
 *   - Panel schedule generation
 *   - Scope completeness checking
 */

import Anthropic from "@anthropic-ai/sdk";

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────

export type BreakerType = "MCB" | "RCBO" | "RCD" | "MCCB" | "FUSE" | "ISOLATOR" | "UNKNOWN";
export type CircuitPhase = "1PH" | "3PH" | "UNKNOWN";

export interface BreakerSpec {
  type: BreakerType;
  rating_amps: number | null;
  poles: number | null;
  breaking_capacity_ka: number | null;
  rcd_ma: number | null;           // RCD trip current in mA (typically 30mA)
  brand: string | null;
}

export interface Circuit {
  circuit_number: string;
  description: string;
  breaker: BreakerSpec;
  phase: CircuitPhase;
  cable_size_mm2: number | null;   // Conductor cross-section e.g. 2.5 for 2.5mm²
  load_watts: number | null;
  load_amps: number | null;
  rcd_protected: boolean;
  final_circuit: boolean;          // True if this feeds outlets/lights directly
  notes: string;
}

export interface Panel {
  id: string;
  name: string;
  drawing_ref: string;
  panel_type: "MAIN_SWITCHBOARD" | "SUB_BOARD" | "DISTRIBUTION_BOARD" | "METER_BOARD" | "UNKNOWN";
  supply_voltage: string | null;   // e.g. "230V" or "415V 3PH"
  main_breaker: BreakerSpec | null;
  circuits: Circuit[];
  child_panels: string[];          // IDs of sub-boards fed from this panel
  parent_panel_id: string | null;
}

export interface SLDResult {
  is_sld: boolean;                 // False if the page doesn't look like an SLD
  confidence: number;
  drawing_ref: string;
  panels: Panel[];
  total_circuits: number;
  total_load_kw: number | null;
  supply_voltage: string | null;
  meter_present: boolean;
  solar_pv_present: boolean;
  battery_present: boolean;
  ev_charger_circuits: number;
  scope_notes: string[];           // Free-text observations (e.g. "3-phase supply confirmed")
  raw_response: string;
}

// ─────────────────────────────────────────────
// PROMPTS
// ─────────────────────────────────────────────

const SLD_DETECTION_PROMPT = `You are reviewing an electrical drawing page.
Determine if this page is a SINGLE-LINE DIAGRAM (SLD), also called a switchboard schedule, riser diagram, or electrical schematic.

A single-line diagram shows:
- Rectangular boxes representing switchboards or distribution boards
- Lines representing circuits between panels
- Breaker symbols (rectangles with diagonal lines, or just breaker ratings like "20A MCB", "32A RCBO")
- Circuit numbers and load descriptions
- It does NOT show floor plan room layouts or building geometry

Respond ONLY with JSON:
{"is_sld": true|false, "confidence": 0-100, "reason": "brief explanation"}`;

const SLD_EXTRACTION_PROMPT = `You are ElectraScan extracting the complete electrical circuit schedule from an Australian single-line diagram (SLD) or switchboard schedule.

Extract EVERY panel and EVERY circuit shown.

For each PANEL extract:
- Panel name (e.g. "MSB", "Main Switchboard", "Sub Board 1", "DB-GF")
- Panel type (MAIN_SWITCHBOARD, SUB_BOARD, DISTRIBUTION_BOARD, METER_BOARD)
- Supply voltage (e.g. "230V 1PH", "415V 3PH")
- Main incoming breaker rating and type
- Which circuits it feeds

For each CIRCUIT extract:
- Circuit number or label (e.g. "C1", "1", "L1")
- Description (e.g. "Kitchen Lighting", "Bedroom GPOs", "Pool Pump")
- Breaker type: MCB, RCBO, RCD, MCCB, FUSE, ISOLATOR
- Breaker rating in amps
- Number of poles (1 or 3)
- Cable size in mm² if shown (e.g. 2.5, 4, 6, 10)
- Whether protected by RCD (RCBO counts as RCD-protected)
- Estimated load in watts or amps if shown
- Phase: 1PH or 3PH

Also extract top-level project data:
- Supply voltage (from meter or main breaker)
- Whether a meter board is shown
- Whether solar PV connection is shown
- Whether battery/inverter connection is shown
- Number of EV charger circuits

Return ONLY valid JSON — no markdown:
{
  "supply_voltage": "230V 1PH",
  "meter_present": true,
  "solar_pv_present": false,
  "battery_present": false,
  "ev_charger_circuits": 1,
  "scope_notes": ["3-phase supply confirmed", "All wet area circuits on RCBO"],
  "panels": [
    {
      "id": "MSB",
      "name": "Main Switchboard",
      "drawing_ref": "Sheet 3",
      "panel_type": "MAIN_SWITCHBOARD",
      "supply_voltage": "230V 1PH",
      "main_breaker": {
        "type": "MCCB",
        "rating_amps": 100,
        "poles": 2,
        "breaking_capacity_ka": 10,
        "rcd_ma": null,
        "brand": null
      },
      "child_panels": ["SB1"],
      "parent_panel_id": null,
      "circuits": [
        {
          "circuit_number": "C1",
          "description": "Kitchen Lighting",
          "breaker": {
            "type": "RCBO",
            "rating_amps": 16,
            "poles": 1,
            "breaking_capacity_ka": 6,
            "rcd_ma": 30,
            "brand": null
          },
          "phase": "1PH",
          "cable_size_mm2": 2.5,
          "load_watts": null,
          "load_amps": null,
          "rcd_protected": true,
          "final_circuit": true,
          "notes": ""
        }
      ]
    }
  ]
}`;

// ─────────────────────────────────────────────
// CORE FUNCTIONS
// ─────────────────────────────────────────────

async function isPageSLD(
  client: Anthropic,
  imageBase64: string
): Promise<{ is_sld: boolean; confidence: number }> {
  try {
    const r = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 256,
      system: SLD_DETECTION_PROMPT,
      messages: [{
        role: "user",
        content: [{
          type: "image",
          source: { type: "base64", media_type: "image/png", data: imageBase64 },
        }],
      }],
    });
    const text = r.content[0].type === "text" ? r.content[0].text : "{}";
    const parsed = JSON.parse(text.replace(/^```(?:json)?\s*/im, "").replace(/\s*```$/im, "").trim());
    return { is_sld: parsed.is_sld ?? false, confidence: parsed.confidence ?? 0 };
  } catch {
    return { is_sld: false, confidence: 0 };
  }
}

/**
 * Detects SLD pages from a set of page images and parses any found.
 * Pass in the same base64 images produced by pdfToImages() in analyze_pdf.ts.
 */
export async function parseSingleLineDiagrams(
  pageImages: string[],
  drawingRef: string = "Drawing",
  apiKey?: string
): Promise<SLDResult[]> {
  const client = new Anthropic({
    apiKey: apiKey ?? (import.meta as any).env.VITE_ANTHROPIC_API_KEY,
    dangerouslyAllowBrowser: true,
  });

  const results: SLDResult[] = [];

  for (let i = 0; i < pageImages.length; i++) {
    const pageRef = `${drawingRef} — Page ${i + 1}`;
    console.log(`[ElectraScan SLD] Checking page ${i + 1} of ${pageImages.length}...`);

    const { is_sld, confidence } = await isPageSLD(client, pageImages[i]);

    if (!is_sld || confidence < 60) {
      console.log(`[ElectraScan SLD] Page ${i + 1}: not an SLD (confidence ${confidence})`);
      continue;
    }

    console.log(`[ElectraScan SLD] Page ${i + 1}: SLD detected (confidence ${confidence}) — extracting circuits...`);

    let rawResponse = "";
    let parsed: any = {};

    try {
      const r = await client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        system: SLD_EXTRACTION_PROMPT,
        messages: [{
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: "image/png", data: pageImages[i] },
            },
            {
              type: "text",
              text: `Extract the complete circuit schedule from this single-line diagram. Reference: ${pageRef}`,
            },
          ],
        }],
      });
      rawResponse = r.content[0].type === "text" ? r.content[0].text : "";
      parsed = JSON.parse(rawResponse.replace(/^```(?:json)?\s*/im, "").replace(/\s*```$/im, "").trim());
    } catch (err) {
      console.warn(`[ElectraScan SLD] Extraction failed for page ${i + 1}:`, err);
      parsed = {};
    }

    const panels: Panel[] = (parsed.panels ?? []).map((p: any) => ({
      id: p.id ?? `PANEL-${i + 1}`,
      name: p.name ?? "Unknown Panel",
      drawing_ref: pageRef,
      panel_type: p.panel_type ?? "UNKNOWN",
      supply_voltage: p.supply_voltage ?? null,
      main_breaker: p.main_breaker ? normaliseBreakerSpec(p.main_breaker) : null,
      circuits: (p.circuits ?? []).map(normaliseCircuit),
      child_panels: p.child_panels ?? [],
      parent_panel_id: p.parent_panel_id ?? null,
    }));

    const totalCircuits = panels.reduce((s, p) => s + p.circuits.length, 0);
    const totalLoadW = panels.reduce((s, p) =>
      s + p.circuits.reduce((cs, c) => cs + (c.load_watts ?? 0), 0), 0);

    results.push({
      is_sld: true,
      confidence,
      drawing_ref: pageRef,
      panels,
      total_circuits: totalCircuits,
      total_load_kw: totalLoadW > 0 ? Math.round(totalLoadW / 100) / 10 : null,
      supply_voltage: parsed.supply_voltage ?? null,
      meter_present: parsed.meter_present ?? false,
      solar_pv_present: parsed.solar_pv_present ?? false,
      battery_present: parsed.battery_present ?? false,
      ev_charger_circuits: parsed.ev_charger_circuits ?? 0,
      scope_notes: parsed.scope_notes ?? [],
      raw_response: rawResponse,
    });

    console.log(`[ElectraScan SLD] Page ${i + 1}: ${panels.length} panels, ${totalCircuits} circuits extracted`);
  }

  return results;
}

// ─────────────────────────────────────────────
// NORMALISATION HELPERS
// ─────────────────────────────────────────────

function normaliseBreakerSpec(raw: any): BreakerSpec {
  return {
    type: (raw.type ?? "UNKNOWN") as BreakerType,
    rating_amps: raw.rating_amps ?? null,
    poles: raw.poles ?? null,
    breaking_capacity_ka: raw.breaking_capacity_ka ?? null,
    rcd_ma: raw.rcd_ma ?? null,
    brand: raw.brand ?? null,
  };
}

function normaliseCircuit(raw: any): Circuit {
  const breaker = normaliseBreakerSpec(raw.breaker ?? {});
  const rcdProtected =
    raw.rcd_protected === true ||
    breaker.type === "RCBO" ||
    breaker.type === "RCD" ||
    breaker.rcd_ma != null;

  return {
    circuit_number: raw.circuit_number ?? "",
    description: raw.description ?? "",
    breaker,
    phase: (raw.phase ?? "UNKNOWN") as CircuitPhase,
    cable_size_mm2: raw.cable_size_mm2 ?? null,
    load_watts: raw.load_watts ?? null,
    load_amps: raw.load_amps ?? null,
    rcd_protected: rcdProtected,
    final_circuit: raw.final_circuit !== false,
    notes: raw.notes ?? "",
  };
}

// ─────────────────────────────────────────────
// ANALYSIS HELPERS
// ─────────────────────────────────────────────

/** Returns all circuits that are NOT RCD-protected — useful for compliance checking. */
export function getUnprotectedCircuits(sld: SLDResult): Circuit[] {
  return sld.panels.flatMap((p) => p.circuits.filter((c) => !c.rcd_protected && c.final_circuit));
}

/** Summarise circuit count by type for a quick overview. */
export function summariseSLD(sld: SLDResult): Record<string, number> {
  const summary: Record<string, number> = {
    total_circuits: sld.total_circuits,
    rcbo_circuits: 0,
    rcd_circuits: 0,
    mcb_only: 0,
    three_phase_circuits: 0,
    ev_charger: sld.ev_charger_circuits,
  };
  for (const panel of sld.panels) {
    for (const circuit of panel.circuits) {
      if (circuit.breaker.type === "RCBO") summary.rcbo_circuits++;
      else if (circuit.breaker.type === "RCD") summary.rcd_circuits++;
      else if (!circuit.rcd_protected) summary.mcb_only++;
      if (circuit.phase === "3PH") summary.three_phase_circuits++;
    }
  }
  return summary;
}
