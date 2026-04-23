/**
 * ElectraScan — Vesh Electrical Services Catalogue
 * ==================================================
 * Pricing: Vesh Electrical Services Pty Ltd — Per Point Costs 31.3.2026
 * All prices exclude GST.
 *
 * Exports:
 *   CatalogueItem — the shape returned by mapLegendItem()
 *   VESH_CATALOGUE — full item list (use for UI display, export, auditing)
 *   mapLegendItem(description) — maps a legend text description to the
 *     best-matching Vesh item, or null if no match with sufficient confidence
 */

import type { ComponentType } from "./analyze_pdf";

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────

export interface CatalogueItem {
  id: string;
  description: string;         // Vesh's official item description
  price: number;               // Standard price excl. GST
  offFormPrice: number | null; // Off-form concrete premium excl. GST
  componentType: ComponentType;
  automationFlag?: boolean;    // True if item requires Dynalite/DALI programming
  notes?: string;
}

// ─────────────────────────────────────────────
// CATALOGUE
// Source: Vesh Electrical Services Pty Ltd — 31.3.2026
// ─────────────────────────────────────────────

export const VESH_CATALOGUE: CatalogueItem[] = [
  // ── Power Points (GPO) ───────────────────────
  { id: "vesh-gpo-single",       description: "Single GPO (standard PVC)",                     price: 260,  offFormPrice: 360,  componentType: "GPO_STANDARD" },
  { id: "vesh-gpo-double",       description: "Double GPO (standard PVC)",                     price: 260,  offFormPrice: 360,  componentType: "GPO_DOUBLE" },
  { id: "vesh-gpo-wp",           description: "Double GPO – weatherproof",                     price: 290,  offFormPrice: 390,  componentType: "GPO_WEATHERPROOF" },
  { id: "vesh-gpo-usb",          description: "Double GPO with USB (standard PVC)",             price: 360,  offFormPrice: 460,  componentType: "GPO_USB" },
  { id: "vesh-gpo-zetr13-white", description: "Double GPO – Zetr 13 series – white",           price: 525,  offFormPrice: 725,  componentType: "GPO_DOUBLE" },
  { id: "vesh-gpo-zetr12-white", description: "Double GPO – Zetr 12 series – white",           price: 425,  offFormPrice: 625,  componentType: "GPO_DOUBLE" },
  { id: "vesh-gpo-usb-zetr13",   description: "Double GPO with USB – Zetr 13 series – white",  price: 650,  offFormPrice: 850,  componentType: "GPO_USB" },
  { id: "vesh-gpo-zetr13-carbon",description: "Double GPO – Zetr 13 series Carbon",            price: 750,  offFormPrice: 950,  componentType: "GPO_DOUBLE" },
  { id: "vesh-gpo-circuit",      description: "GPO on own circuit",                            price: 450,  offFormPrice: null, componentType: "GPO_STANDARD" },
  { id: "vesh-gpo-switched",     description: "GPO switched",                                  price: 450,  offFormPrice: null, componentType: "GPO_STANDARD" },
  { id: "vesh-floor-box",        description: "Floor box point – wire & connect",              price: 600,  offFormPrice: null, componentType: "GPO_STANDARD" },

  // ── Cooktop / Oven Connections ────────────────
  { id: "vesh-cooktop-20a",      description: "20amp cooktop/oven connection",                 price: 450,  offFormPrice: null, componentType: "GPO_STANDARD" },
  { id: "vesh-cooktop-25a",      description: "25amp cooktop/oven connection",                 price: 600,  offFormPrice: null, componentType: "GPO_STANDARD" },
  { id: "vesh-cooktop-32a",      description: "32amp cooktop/oven connection",                 price: 750,  offFormPrice: null, componentType: "GPO_STANDARD" },
  { id: "vesh-cooktop-3ph",      description: "3-phase cooktop/oven connection",               price: 1000, offFormPrice: null, componentType: "GPO_STANDARD" },

  // ── Lighting ──────────────────────────────────
  { id: "vesh-downlight",              description: "Single down light point",                      price: 200,  offFormPrice: 350,  componentType: "DOWNLIGHT_RECESSED" },
  { id: "vesh-downlight-trimless",     description: "Single down light point – trim-less",          price: 240,  offFormPrice: null, componentType: "DOWNLIGHT_RECESSED" },
  { id: "vesh-downlight-dali",         description: "Single down light point – Dali",               price: 220,  offFormPrice: 370,  componentType: "DOWNLIGHT_RECESSED", automationFlag: true },
  { id: "vesh-downlight-dali-trim",    description: "Single down light point – Dali – trim-less",   price: 260,  offFormPrice: null, componentType: "DOWNLIGHT_RECESSED", automationFlag: true },
  { id: "vesh-led-strip",              description: "Single LED strip",                              price: 400,  offFormPrice: null, componentType: "DOWNLIGHT_RECESSED" },
  { id: "vesh-led-strip-dali",         description: "Single LED strip inc Dali driver",              price: 450,  offFormPrice: null, componentType: "DOWNLIGHT_RECESSED", automationFlag: true },
  { id: "vesh-wall-light-surface",     description: "Single wall light – surface mounted",           price: 250,  offFormPrice: 350,  componentType: "DOWNLIGHT_RECESSED" },
  { id: "vesh-wall-light-recessed",    description: "Single wall light – recessed or Dali",          price: 300,  offFormPrice: 400,  componentType: "DOWNLIGHT_RECESSED", automationFlag: false },
  { id: "vesh-garden-light",           description: "Single garden light point",                     price: 150,  offFormPrice: null, componentType: "DOWNLIGHT_RECESSED" },
  { id: "vesh-pendant",                description: "Single standard pendant light",                 price: 600,  offFormPrice: 750,  componentType: "PENDANT_FEATURE" },
  { id: "vesh-track-light",            description: "Track light point",                             price: 1000, offFormPrice: null, componentType: "DOWNLIGHT_RECESSED" },

  // ── Fans ──────────────────────────────────────
  { id: "vesh-exhaust-conv",     description: "Exhaust fan point – conventional",              price: 180,  offFormPrice: null, componentType: "EXHAUST_FAN" },
  { id: "vesh-exhaust-auto",     description: "Exhaust fan point – automated",                 price: 250,  offFormPrice: null, componentType: "EXHAUST_FAN", automationFlag: true },
  { id: "vesh-ceiling-fan",      description: "Ceiling fan point",                             price: 450,  offFormPrice: null, componentType: "EXHAUST_FAN" },

  // ── Specialised Circuits ──────────────────────
  { id: "vesh-underfloor",       description: "Under floor heat circuit inc. remote sensor",   price: 450,  offFormPrice: null, componentType: "GPO_STANDARD" },
  { id: "vesh-heated-towel",     description: "Heated towel rail point – wire & connect",      price: 450,  offFormPrice: null, componentType: "GPO_STANDARD" },
  { id: "vesh-toilet",           description: "Toilet",                                        price: 450,  offFormPrice: null, componentType: "GPO_STANDARD" },
  { id: "vesh-ext-heater",       description: "External Heater",                               price: 850,  offFormPrice: null, componentType: "GPO_WEATHERPROOF" },

  // ── EV / Car Charger ──────────────────────────
  { id: "vesh-car-charger",      description: "Car charger point – wire & connect (max 15m)",  price: 1000, offFormPrice: null, componentType: "EV_CHARGER" },

  // ── Automation & Smart ────────────────────────
  { id: "vesh-motorised-blind",  description: "Motorised blind point – wire & connect",        price: 380,  offFormPrice: null, componentType: "AUTOMATION_HUB", automationFlag: true },
  { id: "vesh-keypad",           description: "Keypad point – 1 x 6-core",                    price: 185,  offFormPrice: null, componentType: "AUTOMATION_HUB", automationFlag: true },
  { id: "vesh-access-keypad",    description: "Access Key Pad",                                price: 400,  offFormPrice: null, componentType: "GATE_ACCESS" },

  // ── Switching ─────────────────────────────────
  { id: "vesh-switch-dynalite",  description: "Switch point – Dynalite – wire only",           price: 180,  offFormPrice: null, componentType: "SWITCHING_STANDARD", automationFlag: true },
  { id: "vesh-switch-conv",      description: "Switch point – conventional",                   price: 120,  offFormPrice: null, componentType: "SWITCHING_STANDARD" },
  { id: "vesh-switch-dimmer",    description: "Switch point – conventional inc. dimmer",       price: 220,  offFormPrice: null, componentType: "SWITCHING_DIMMER" },
  { id: "vesh-switch-2way",      description: "2-way switch point – conventional",             price: 200,  offFormPrice: null, componentType: "SWITCHING_2WAY" },
  { id: "vesh-switch-3way",      description: "3-way switch point – conventional",             price: 250,  offFormPrice: null, componentType: "SWITCHING_STANDARD" },
  { id: "vesh-sensor-dynalite",  description: "Sensor point – Dynalite – wire only",           price: 180,  offFormPrice: null, componentType: "SWITCHING_STANDARD", automationFlag: true },
  { id: "vesh-sensor-conv",      description: "Sensor point – conventional",                   price: 200,  offFormPrice: null, componentType: "SWITCHING_STANDARD" },
  { id: "vesh-sensor-supply",    description: "Sensor – supply & install",                     price: 380,  offFormPrice: null, componentType: "SWITCHING_STANDARD" },
  { id: "vesh-pir",              description: "PIR point – 1 x 6-core",                       price: 185,  offFormPrice: null, componentType: "SWITCHING_STANDARD" },

  // ── Data & AV ────────────────────────────────
  { id: "vesh-combo-tv",         description: "Combo TV point – 3 x Cat6 + 1 x RG6 (inc. media box)", price: 550, offFormPrice: null, componentType: "DATA_TV" },
  { id: "vesh-data-cat6",        description: "Data point – 2 x Cat6",                        price: 360,  offFormPrice: null, componentType: "DATA_CAT6" },
  { id: "vesh-wifi",             description: "Wi-Fi point – 1 x Cat6",                       price: 185,  offFormPrice: null, componentType: "DATA_CAT6" },
  { id: "vesh-speaker",          description: "Speaker point – wire & connect x 2 (max 30m)", price: 660,  offFormPrice: null, componentType: "DATA_TV" },
  { id: "vesh-intercom",         description: "Intercom point – 1 x Cat6 + 1 x 6-core",      price: 250,  offFormPrice: null, componentType: "SECURITY_INTERCOM" },

  // ── Security ─────────────────────────────────
  { id: "vesh-cctv",             description: "CCTV",                                          price: 300,  offFormPrice: null, componentType: "SECURITY_CCTV" },
  { id: "vesh-smoke",            description: "Smoke detector",                                price: 360,  offFormPrice: null, componentType: "SECURITY_ALARM" },
];

// ─────────────────────────────────────────────
// LOOKUP MAP (id → item)
// ─────────────────────────────────────────────

export const CATALOGUE_BY_ID = new Map<string, CatalogueItem>(
  VESH_CATALOGUE.map((item) => [item.id, item])
);

// ─────────────────────────────────────────────
// MATCHING ENGINE
// Maps a legend description (as extracted by Claude) to the best
// Vesh catalogue item. Returns null if no confident match found.
// ─────────────────────────────────────────────

type MatchRule = {
  test: (d: string) => boolean;
  item: string; // Catalogue ID
};

const MATCH_RULES: MatchRule[] = [
  // ── Zetr brand GPOs — check these FIRST (most specific) ────────────
  { test: d => (d.includes("zetr 13") || d.includes("zetr t3")) && d.includes("carbon"),      item: "vesh-gpo-zetr13-carbon" },
  { test: d => (d.includes("zetr 13") || d.includes("zetr t3")) && d.includes("usb"),         item: "vesh-gpo-usb-zetr13" },
  { test: d => d.includes("zetr 13") || d.includes("zetr t3"),                                item: "vesh-gpo-zetr13-white" },
  { test: d => d.includes("zetr 12") || d.includes("zetr t2"),                                item: "vesh-gpo-zetr12-white" },

  // ── Switches — check before generic GPO to prevent cross-match ─────
  { test: d => (d.includes("switch") || d.includes("light switch")) && (d.includes("dynalite") || d.includes("dali")), item: "vesh-switch-dynalite" },
  { test: d => d.includes("sensor") && (d.includes("dynalite") || d.includes("dali")),        item: "vesh-sensor-dynalite" },
  { test: d => d.includes("switch") && d.includes("dimmer"),                                  item: "vesh-switch-dimmer" },
  { test: d => (d.includes("2-way") || d.includes("2 way") || d.includes("two way")) && d.includes("switch"), item: "vesh-switch-2way" },
  { test: d => (d.includes("3-way") || d.includes("3 way") || d.includes("three way")) && d.includes("switch"), item: "vesh-switch-3way" },
  { test: d => d.includes("switch") && !d.includes("board") && !d.includes("gpo") && !d.includes("power"), item: "vesh-switch-conv" },
  { test: d => d.includes("pir"),                                                              item: "vesh-pir" },
  { test: d => d.includes("keypad") && (d.includes("access") || d.includes("gate")),          item: "vesh-access-keypad" },
  { test: d => d.includes("keypad"),                                                           item: "vesh-keypad" },
  { test: d => d.includes("sensor") && d.includes("supply"),                                  item: "vesh-sensor-supply" },
  { test: d => d.includes("sensor"),                                                           item: "vesh-sensor-conv" },

  // ── Lighting ───────────────────────────────────────────────────────
  { test: d => d.includes("track light") || d.includes("track-light"),                        item: "vesh-track-light" },
  { test: d => d.includes("led strip") && (d.includes("dali") || d.includes("dynalite")),     item: "vesh-led-strip-dali" },
  { test: d => d.includes("led strip") || d.includes("strip light"),                          item: "vesh-led-strip" },
  { test: d => (d.includes("wall light") || d.includes("art light")) && (d.includes("recessed") || d.includes("dali")), item: "vesh-wall-light-recessed" },
  { test: d => d.includes("wall light") || d.includes("wall lamp"),                           item: "vesh-wall-light-surface" },
  { test: d => d.includes("garden light") || d.includes("garden lamp"),                       item: "vesh-garden-light" },
  { test: d => d.includes("pendant") || d.includes("feature light") || d.includes("chandelier"), item: "vesh-pendant" },
  { test: d => (d.includes("downlight") || d.includes("down light") || d.includes("recessed")) && (d.includes("dali") || d.includes("dynalite")) && d.includes("trim"), item: "vesh-downlight-dali-trim" },
  { test: d => (d.includes("downlight") || d.includes("down light") || d.includes("recessed")) && (d.includes("dali") || d.includes("dynalite")), item: "vesh-downlight-dali" },
  { test: d => (d.includes("downlight") || d.includes("down light") || d.includes("recessed")) && d.includes("trim"), item: "vesh-downlight-trimless" },
  { test: d => d.includes("downlight") || d.includes("down light") || d.includes("recessed light") || d.includes("ceiling light"), item: "vesh-downlight" },

  // ── Fans ───────────────────────────────────────────────────────────
  { test: d => d.includes("ceiling fan"),                                                      item: "vesh-ceiling-fan" },
  { test: d => d.includes("exhaust fan") && (d.includes("auto") || d.includes("smart") || d.includes("timer")), item: "vesh-exhaust-auto" },
  { test: d => d.includes("exhaust fan") || d.includes("exhaust point"),                      item: "vesh-exhaust-conv" },

  // ── GPO / Power Points ─────────────────────────────────────────────
  { test: d => (d.includes("gpo") || d.includes("power point") || d.includes("powerpoint") || d.includes("double power")) && d.includes("weatherproof"), item: "vesh-gpo-wp" },
  { test: d => (d.includes("gpo") || d.includes("power point") || d.includes("powerpoint")) && d.includes("usb"), item: "vesh-gpo-usb" },
  { test: d => (d.includes("gpo") || d.includes("power point") || d.includes("powerpoint")) && (d.includes("own circuit") || d.includes("dedicated")), item: "vesh-gpo-circuit" },
  { test: d => (d.includes("gpo") || d.includes("power point") || d.includes("powerpoint")) && d.includes("switched"), item: "vesh-gpo-switched" },
  { test: d => d.includes("floor box"),                                                        item: "vesh-floor-box" },
  { test: d => d.includes("single gpo") || (d.includes("gpo") && d.includes("single")),       item: "vesh-gpo-single" },
  { test: d => d.includes("gpo") || d.includes("power point") || d.includes("powerpoint") || d.includes("double power") || d.includes("outlet"), item: "vesh-gpo-double" },

  // ── Cooktop / Oven ─────────────────────────────────────────────────
  { test: d => (d.includes("cooktop") || d.includes("oven") || d.includes("stove")) && d.includes("3-phase"), item: "vesh-cooktop-3ph" },
  { test: d => (d.includes("cooktop") || d.includes("oven") || d.includes("stove")) && (d.includes("32") || d.includes("32a")), item: "vesh-cooktop-32a" },
  { test: d => (d.includes("cooktop") || d.includes("oven") || d.includes("stove")) && (d.includes("25") || d.includes("25a")), item: "vesh-cooktop-25a" },
  { test: d => d.includes("cooktop") || d.includes("oven") || d.includes("stove"),            item: "vesh-cooktop-20a" },

  // ── Specialised Circuits ───────────────────────────────────────────
  { test: d => d.includes("motorised blind") || d.includes("blind motor") || d.includes("electric blind"), item: "vesh-motorised-blind" },
  { test: d => d.includes("underfloor") || d.includes("under floor") || d.includes("floor heat") || d.includes("heated floor"), item: "vesh-underfloor" },
  { test: d => d.includes("heated towel") || d.includes("towel rail"),                        item: "vesh-heated-towel" },
  { test: d => d.includes("toilet") || d.includes("bidet"),                                   item: "vesh-toilet" },
  { test: d => d.includes("external heater") || d.includes("outdoor heater") || d.includes("alfresco heater"), item: "vesh-ext-heater" },

  // ── EV / Car Charger ───────────────────────────────────────────────
  { test: d => d.includes("car charger") || d.includes("ev charger") || d.includes("ev point") || d.includes("electric vehicle"), item: "vesh-car-charger" },

  // ── Data / AV ──────────────────────────────────────────────────────
  { test: d => d.includes("speaker") || d.includes("audio point"),                            item: "vesh-speaker" },
  { test: d => d.includes("combo tv") || (d.includes("tv") && d.includes("cat6")),            item: "vesh-combo-tv" },
  { test: d => d.includes("tv") || d.includes("television") || d.includes("aerial") || d.includes("rg6"), item: "vesh-combo-tv" },
  { test: d => d.includes("wifi") || d.includes("wi-fi") || d.includes("wireless access"),    item: "vesh-wifi" },
  { test: d => d.includes("data") && (d.includes("cat6") || d.includes("cat 6")),             item: "vesh-data-cat6" },
  { test: d => d.includes("data point") || d.includes("network point") || d.includes("ethernet"), item: "vesh-data-cat6" },

  // ── Security ───────────────────────────────────────────────────────
  { test: d => d.includes("intercom") || d.includes("door bell") || d.includes("doorbell"),   item: "vesh-intercom" },
  { test: d => d.includes("cctv") || d.includes("camera") || d.includes("security camera"),   item: "vesh-cctv" },
  { test: d => d.includes("smoke") || d.includes("heat detector") || d.includes("fire alarm"), item: "vesh-smoke" },
  { test: d => d.includes("access") && (d.includes("keypad") || d.includes("gate") || d.includes("door")), item: "vesh-access-keypad" },
];

/**
 * Maps a legend item description to the best-matching Vesh catalogue item.
 * Description is normalised before matching (lowercase, brand abbreviations expanded).
 * Returns null if no rule matches.
 */
export function mapLegendItem(description: string): CatalogueItem | null {
  const d = description
    .toLowerCase()
    .replace(/zetr t3/g, "zetr 13")
    .replace(/zetr t2/g, "zetr 12")
    .replace(/\bex\.?\s*fan\b/g, "exhaust fan")
    .replace(/\bpower pt\b/g, "power point")
    .replace(/\bgpo\b/, "gpo") // keep normalised
    .trim();

  for (const rule of MATCH_RULES) {
    if (rule.test(d)) {
      return CATALOGUE_BY_ID.get(rule.item) ?? null;
    }
  }

  return null;
}

/**
 * Returns all catalogue items for a given ComponentType.
 * Useful for building pricing tables or dropdown selectors in the UI.
 */
export function getItemsByType(type: ComponentType): CatalogueItem[] {
  return VESH_CATALOGUE.filter((item) => item.componentType === type);
}

/**
 * Returns the off-form price for an item, falling back to the standard price
 * if no off-form rate is defined (i.e. Vesh doesn't charge a premium for that item).
 */
export function getOffFormPrice(item: CatalogueItem): number {
  return item.offFormPrice ?? item.price;
}
