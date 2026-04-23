/**
 * ElectraScan — AS/NZS 3000 Compliance Checker
 * ===============================================
 * Rule-based checker that validates a detection result against key
 * requirements of AS/NZS 3000:2018 (Australian/New Zealand Wiring Rules).
 *
 * Inputs: DetectionResult (from analyze_pdf) and optionally SLDResult[]
 * (from sld_parser) for circuit-level validation.
 *
 * Rules implemented cover the most common residential/light-commercial
 * requirements that affect quoting: RCD protection, smoke detectors,
 * wet area circuits, socket outlet density, and safety switches.
 */

import type { DetectionResult, DetectedComponent, ComponentType } from "./analyze_pdf";
import type { SLDResult, Circuit } from "./sld_parser";

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────

export type ComplianceSeverity = "fail" | "warn" | "info";

export interface ComplianceIssue {
  rule_ref: string;          // AS/NZS 3000 clause reference
  title: string;
  description: string;
  severity: ComplianceSeverity;
  component_types: ComponentType[];
  rooms?: string[];
  recommendation: string;
}

export interface ComplianceResult {
  checked_at: string;
  overall_status: "PASS" | "WARNINGS" | "FAIL";
  fail_count: number;
  warn_count: number;
  info_count: number;
  issues: ComplianceIssue[];
  summary: string;
}

// ─────────────────────────────────────────────
// WET AREA DETECTION
// Clauses 2.6.3, 4.4 — circuits in wet areas need RCD/RCBO protection.
// We detect "wet" rooms by keyword matching.
// ─────────────────────────────────────────────

const WET_AREA_KEYWORDS = [
  "bathroom", "bath", "ensuite", "toilet", "wc", "laundry",
  "kitchen", "pool", "spa", "outdoor", "garage", "carport",
  "alfresco", "deck", "balcony", "external", "wet",
];

function isWetArea(room: string): boolean {
  const lower = room.toLowerCase();
  return WET_AREA_KEYWORDS.some((kw) => lower.includes(kw));
}

function getWetAreaComponents(components: DetectedComponent[]): DetectedComponent[] {
  return components.filter((c) => isWetArea(c.room));
}

function getRooms(components: DetectedComponent[]): string[] {
  return [...new Set(components.map((c) => c.room))];
}

// ─────────────────────────────────────────────
// RULE CHECKS
// ─────────────────────────────────────────────

function checkSmokeDetectors(components: DetectedComponent[]): ComplianceIssue | null {
  // AS/NZS 3786 (referenced by BCA/NCC) — smoke alarms required in all residential dwellings.
  // We check if there is at least one smoke alarm / detector in the component list.
  const smokeRelated = components.filter((c) =>
    c.catalogue_item_name?.toLowerCase().includes("smoke") ||
    c.notes?.toLowerCase().includes("smoke") ||
    c.catalogue_item_name?.toLowerCase().includes("alarm")
  );

  if (smokeRelated.length === 0) {
    return {
      rule_ref: "AS 3786 / NCC Vol 2",
      title: "No smoke detectors detected",
      description: "No smoke alarms or detectors were found in the drawing. Australian building code (NCC) requires interconnected smoke alarms in all bedrooms, hallways, and on every level of a dwelling.",
      severity: "warn",
      component_types: ["SECURITY_ALARM"],
      recommendation: "Confirm smoke alarm provision with architect. If residential, include interconnected smoke alarms on every level and in all bedrooms and corridors.",
    };
  }
  return null;
}

function checkSwitchboardPresence(components: DetectedComponent[]): ComplianceIssue | null {
  // AS/NZS 3000 Cl 2.2 — installation must have a main switchboard.
  const hasMSB = components.some((c) =>
    c.type === "SWITCHBOARD_MAIN" || c.type === "SWITCHBOARD_SUB"
  );
  if (!hasMSB) {
    return {
      rule_ref: "AS/NZS 3000:2018 Cl 2.2",
      title: "No switchboard detected on drawings",
      description: "Every electrical installation requires a main switchboard. No switchboard symbol was found in the detection results.",
      severity: "warn",
      component_types: ["SWITCHBOARD_MAIN"],
      recommendation: "Confirm MSB location with architect. May be on a separate drawing sheet not yet uploaded.",
    };
  }
  return null;
}

function checkExhaustFansInWetAreas(components: DetectedComponent[]): ComplianceIssue | null {
  // AS/NZS 3000 Cl 4.4.5 — bathrooms and toilets without operable windows must have exhaust fans.
  const bathroomComponents = components.filter((c) =>
    ["bathroom", "bath", "ensuite", "toilet", "wc"].some((kw) =>
      c.room.toLowerCase().includes(kw)
    )
  );
  const hasExhaustInWet = components.some(
    (c) => c.type === "EXHAUST_FAN" && isWetArea(c.room)
  );
  const hasBathroomOrToilet = bathroomComponents.length > 0;

  if (hasBathroomOrToilet && !hasExhaustInWet) {
    const wetRooms = [...new Set(bathroomComponents.map((c) => c.room))];
    return {
      rule_ref: "AS/NZS 3000:2018 Cl 4.4.5 / NCC F6.3",
      title: "No exhaust fan detected in wet areas",
      description: `Bathrooms/toilets detected (${wetRooms.join(", ")}) but no exhaust fan found in these rooms.`,
      severity: "warn",
      component_types: ["EXHAUST_FAN"],
      rooms: wetRooms,
      recommendation: "Confirm exhaust fan provision in each bathroom and toilet, particularly if no operable window is present.",
    };
  }
  return null;
}

function checkOutdoorIPRating(components: DetectedComponent[]): ComplianceIssue | null {
  // AS/NZS 3000 Cl 2.3 — outdoor fittings must have appropriate IP rating.
  const outdoorComponents = components.filter((c) =>
    ["outdoor", "external", "alfresco", "pool", "garage", "carport", "balcony", "deck"].some(
      (kw) => c.room.toLowerCase().includes(kw)
    )
  );
  if (outdoorComponents.length > 0) {
    const rooms = [...new Set(outdoorComponents.map((c) => c.room))];
    return {
      rule_ref: "AS/NZS 3000:2018 Cl 2.3 / AS 60529",
      title: "Outdoor/exposed area fittings — IP rating confirmation required",
      description: `${outdoorComponents.length} components detected in outdoor/exposed locations (${rooms.join(", ")}). These require appropriate ingress protection ratings.`,
      severity: "info",
      component_types: [...new Set(outdoorComponents.map((c) => c.type))],
      rooms,
      recommendation: "Ensure all outdoor GPOs are IP66 rated, outdoor light fittings are minimum IP44, and pool/spa equipment meets AS 3000 Clause 4.6 requirements.",
    };
  }
  return null;
}

function checkEVChargerCircuit(components: DetectedComponent[]): ComplianceIssue | null {
  // AS/NZS 3000 + ASNZS 3001.2 — EV chargers typically need dedicated 32A circuit.
  const evChargers = components.filter((c) => c.type === "EV_CHARGER");
  if (evChargers.length > 0) {
    return {
      rule_ref: "AS/NZS 3000:2018 + AS/NZS 3001.2",
      title: "EV charger — dedicated circuit required",
      description: `${evChargers.length} EV charger(s) detected. Each requires a dedicated circuit with appropriate breaker rating (typically 32A for 7kW single-phase).`,
      severity: "info",
      component_types: ["EV_CHARGER"],
      recommendation: "Confirm each EV charger has a dedicated 32A RCBO circuit. For 22kW 3-phase chargers, use a 32A 3-pole RCBO. Discuss load management with client if multiple EVs.",
    };
  }
  return null;
}

function checkAutomationSystems(components: DetectedComponent[]): ComplianceIssue | null {
  // Dynalite/DALI systems need separate programming and commissioning budget.
  const automationItems = components.filter((c) =>
    c.flags?.includes("AUTOMATION_DEPENDENCY") || c.type === "AUTOMATION_HUB"
  );
  if (automationItems.length > 0) {
    const totalQty = automationItems.reduce((s, c) => s + c.quantity, 0);
    return {
      rule_ref: "ElectraScan Best Practice",
      title: "Automation system detected — programmer budget required",
      description: `${totalQty} automation-dependent components found (Dynalite, DALI, or smart switching). These require a qualified programmer for commissioning.`,
      severity: "info",
      component_types: ["AUTOMATION_HUB", "SWITCHING_DIMMER", "SWITCHING_STANDARD"],
      recommendation: "Add a line item for Dynalite/DALI programming and commissioning. Typical residential Dynalite commissioning: $1,500–$4,000 depending on complexity.",
    };
  }
  return null;
}

function checkPoolSpaSafety(components: DetectedComponent[]): ComplianceIssue | null {
  // AS/NZS 3000 Cl 4.6 — pool and spa zones have strict requirements.
  const poolComponents = components.filter((c) =>
    ["pool", "spa", "pond"].some((kw) => c.room.toLowerCase().includes(kw)) ||
    c.type === "POOL_OUTDOOR"
  );
  if (poolComponents.length > 0) {
    return {
      rule_ref: "AS/NZS 3000:2018 Cl 4.6",
      title: "Pool/spa electrical — special zone requirements apply",
      description: "Pool or spa electrical detected. Zone 0/1/2 restrictions apply to fitting types, IP ratings, cable routing, and bonding requirements.",
      severity: "warn",
      component_types: ["POOL_OUTDOOR"],
      recommendation: "Ensure compliance with AS/NZS 3000 Cl 4.6 pool/spa zone requirements: Zone 0 (no electrical equipment), Zone 1 (SELV only), Zone 2 (IP44 minimum, RCBO protected). Include pool bonding conductor in quote.",
    };
  }
  return null;
}

// ─────────────────────────────────────────────
// SLD-BASED CHECKS (requires sld_parser output)
// ─────────────────────────────────────────────

function checkRCDCoverage(
  sldResults: SLDResult[],
  components: DetectedComponent[]
): ComplianceIssue[] {
  const issues: ComplianceIssue[] = [];

  for (const sld of sldResults) {
    const unprotected: Circuit[] = [];

    for (const panel of sld.panels) {
      for (const circuit of panel.circuits) {
        if (!circuit.final_circuit) continue;
        if (!circuit.rcd_protected) {
          unprotected.push(circuit);
        }
      }
    }

    if (unprotected.length > 0) {
      const wetCircuits = unprotected.filter((c) =>
        WET_AREA_KEYWORDS.some((kw) => c.description.toLowerCase().includes(kw))
      );

      if (wetCircuits.length > 0) {
        issues.push({
          rule_ref: "AS/NZS 3000:2018 Cl 2.6.3",
          title: `${wetCircuits.length} wet area circuit(s) without RCD protection`,
          description: `Circuits without RCD protection in wet areas: ${wetCircuits.map((c) => `${c.circuit_number} (${c.description})`).join(", ")}. AS/NZS 3000 Cl 2.6.3 requires RCD protection on all socket outlet and lighting circuits in wet areas.`,
          severity: "fail",
          component_types: ["GPO_STANDARD", "GPO_DOUBLE", "DOWNLIGHT_RECESSED"],
          recommendation: "Replace MCBs with RCBOs (30mA) on all wet area circuits, or install RCD protection at the switchboard covering these circuits.",
        });
      }

      // In AU, since 2018 amendment, ALL final sub-circuits require RCD in new residential work
      const dryUnprotected = unprotected.filter((c) =>
        !WET_AREA_KEYWORDS.some((kw) => c.description.toLowerCase().includes(kw))
      );
      if (dryUnprotected.length > 0) {
        issues.push({
          rule_ref: "AS/NZS 3000:2018 Cl 2.6.3 (2018 amendment)",
          title: `${dryUnprotected.length} circuit(s) without RCD protection`,
          description: `Since the 2018 amendment, ALL final sub-circuits in new residential work require RCD/RCBO protection. Unprotected circuits: ${dryUnprotected.slice(0, 5).map((c) => `${c.circuit_number} (${c.description})`).join(", ")}${dryUnprotected.length > 5 ? ` +${dryUnprotected.length - 5} more` : ""}.`,
          severity: "warn",
          component_types: ["GPO_STANDARD", "DOWNLIGHT_RECESSED"],
          recommendation: "Upgrade all MCB-only final circuits to RCBO. Include in quote if this is new work or a major alteration.",
        });
      }
    }
  }

  return issues;
}

function checkBreakerSizing(sldResults: SLDResult[]): ComplianceIssue[] {
  const issues: ComplianceIssue[] = [];

  for (const sld of sldResults) {
    for (const panel of sld.panels) {
      for (const circuit of panel.circuits) {
        // Cable size vs breaker rating sanity check (simplified AU cable table)
        if (circuit.cable_size_mm2 != null && circuit.breaker.rating_amps != null) {
          const maxRating = cableMaxRating(circuit.cable_size_mm2);
          if (maxRating && circuit.breaker.rating_amps > maxRating) {
            issues.push({
              rule_ref: "AS/NZS 3000:2018 Cl 4.3",
              title: `Circuit ${circuit.circuit_number}: breaker overrating`,
              description: `${circuit.description}: ${circuit.cable_size_mm2}mm² cable with ${circuit.breaker.rating_amps}A breaker. Maximum recommended breaker for ${circuit.cable_size_mm2}mm² cable is ${maxRating}A.`,
              severity: "warn",
              component_types: [],
              recommendation: `Reduce breaker to ${maxRating}A or upgrade cable to appropriate size. Verify with engineer.`,
            });
          }
        }
      }
    }
  }

  return issues;
}

// Simplified current rating table for PVC insulated cables in conduit (Table C7, AS/NZS 3008)
function cableMaxRating(mm2: number): number | null {
  const table: Record<number, number> = {
    1: 13, 1.5: 16, 2.5: 25, 4: 32, 6: 40, 10: 57, 16: 76, 25: 101, 35: 125,
  };
  return table[mm2] ?? null;
}

// ─────────────────────────────────────────────
// MAIN CHECKER
// ─────────────────────────────────────────────

export function checkCompliance(
  result: DetectionResult,
  sldResults?: SLDResult[]
): ComplianceResult {
  const issues: ComplianceIssue[] = [];

  // Takeoff-based checks (always run)
  const checks = [
    checkSmokeDetectors(result.components),
    checkSwitchboardPresence(result.components),
    checkExhaustFansInWetAreas(result.components),
    checkOutdoorIPRating(result.components),
    checkEVChargerCircuit(result.components),
    checkAutomationSystems(result.components),
    checkPoolSpaSafety(result.components),
  ];
  for (const issue of checks) {
    if (issue) issues.push(issue);
  }

  // SLD-based checks (only if SLD data available)
  if (sldResults && sldResults.length > 0) {
    issues.push(...checkRCDCoverage(sldResults, result.components));
    issues.push(...checkBreakerSizing(sldResults));
  }

  const failCount = issues.filter((i) => i.severity === "fail").length;
  const warnCount = issues.filter((i) => i.severity === "warn").length;
  const infoCount = issues.filter((i) => i.severity === "info").length;

  const overall: ComplianceResult["overall_status"] =
    failCount > 0 ? "FAIL" : warnCount > 0 ? "WARNINGS" : "PASS";

  const summary = [
    overall === "PASS" ? "No compliance issues detected." : "",
    failCount > 0 ? `${failCount} FAIL: immediate action required.` : "",
    warnCount > 0 ? `${warnCount} WARNING: review before quoting.` : "",
    infoCount > 0 ? `${infoCount} INFO: notes for the electrician.` : "",
  ].filter(Boolean).join(" ");

  return {
    checked_at: new Date().toISOString(),
    overall_status: overall,
    fail_count: failCount,
    warn_count: warnCount,
    info_count: infoCount,
    issues,
    summary,
  };
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

export function getFailingIssues(result: ComplianceResult): ComplianceIssue[] {
  return result.issues.filter((i) => i.severity === "fail");
}

export function getIssuesByRoom(
  result: ComplianceResult
): Record<string, ComplianceIssue[]> {
  const map: Record<string, ComplianceIssue[]> = { General: [] };
  for (const issue of result.issues) {
    if (issue.rooms && issue.rooms.length > 0) {
      for (const room of issue.rooms) {
        if (!map[room]) map[room] = [];
        map[room].push(issue);
      }
    } else {
      map.General.push(issue);
    }
  }
  return map;
}
