import { useState, useCallback } from "react";
import {
  detectElectricalComponents,
  DetectionResult,
  DetectedComponent,
  groupByRoom,
  getReviewItems,
} from "./analyze_pdf";

// ─── Theme colours matching ElectraScan design system ───
const C = {
  bgDark:  "#0D1B2A",
  navy:    "#112236",
  blue:    "#1D6EFD",
  blueLt:  "#3B82F6",
  green:   "#10B981",
  amber:   "#F59E0B",
  red:     "#EF4444",
  purple:  "#8B5CF6",
  text:    "#E2E8F0",
  muted:   "#64748B",
  border:  "#1E3A5F",
};

// ─── Screen type ─────────────────────────────────────────
type Screen = "upload" | "scanning" | "results";

// ─── Component label map (plain English for tradies) ─────
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

const FLAG_LABELS: Record<string, string> = {
  HEIGHT_RISK:            "Height Risk — scaffold required",
  AUTOMATION_DEPENDENCY:  "Automation — programmer needed",
  MISSING_CIRCUIT:        "Missing circuit on drawing",
  SCOPE_CONFIRM:          "Confirm scope with architect",
  OUTDOOR_LOCATION:       "Outdoor — weatherproof required",
  OFF_FORM_PREMIUM:       "Off-form premium applies",
  CABLE_RUN_LONG:         "Long cable run — verify length",
  LOW_CONFIDENCE:         "Low confidence — verify on drawing",
  SYMBOL_AMBIGUOUS:       "Ambiguous symbol — check manually",
};

// ─── Styles (inline for single-file simplicity) ──────────
const s: Record<string, React.CSSProperties> = {
  app: {
    minHeight: "100vh",
    background: C.bgDark,
    color: C.text,
    fontFamily: "'DM Sans', system-ui, sans-serif",
  },
  header: {
    background: C.navy,
    borderBottom: `1px solid ${C.border}`,
    padding: "0 24px",
    height: 56,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  logo: {
    fontSize: 18,
    fontWeight: 700,
    color: C.blue,
    letterSpacing: "-0.02em",
  },
  logoSpan: { color: C.text },
  badge: {
    fontSize: 11,
    background: "#1E3A5F",
    color: C.blueLt,
    padding: "2px 8px",
    borderRadius: 4,
    fontWeight: 500,
  },
  main: {
    maxWidth: 720,
    margin: "0 auto",
    padding: "40px 24px",
  },
  card: {
    background: C.navy,
    border: `1px solid ${C.border}`,
    borderRadius: 12,
    padding: 24,
    marginBottom: 16,
  },
  uploadZone: {
    border: `2px dashed ${C.border}`,
    borderRadius: 12,
    padding: "48px 24px",
    textAlign: "center" as const,
    cursor: "pointer",
    transition: "all 0.2s",
  },
  uploadZoneActive: {
    border: `2px dashed ${C.blue}`,
    background: "#0D2347",
  },
  h1: {
    fontSize: 28,
    fontWeight: 700,
    marginBottom: 8,
    letterSpacing: "-0.02em",
  },
  h2: {
    fontSize: 20,
    fontWeight: 600,
    marginBottom: 16,
  },
  p: {
    color: C.muted,
    fontSize: 15,
    lineHeight: 1.6,
    marginBottom: 0,
  },
  btn: {
    background: C.blue,
    color: "#fff",
    border: "none",
    borderRadius: 8,
    padding: "12px 24px",
    fontSize: 15,
    fontWeight: 600,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
  },
  btnGhost: {
    background: "transparent",
    color: C.muted,
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    padding: "10px 20px",
    fontSize: 14,
    cursor: "pointer",
  },
  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  tag: (color: string) => ({
    display: "inline-block",
    fontSize: 11,
    fontWeight: 500,
    padding: "2px 8px",
    borderRadius: 4,
    background: color + "22",
    color: color,
    marginRight: 4,
  }),
  componentRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 0",
    borderBottom: `1px solid ${C.border}`,
    gap: 12,
  },
  confBar: (pct: number) => ({
    width: 60,
    height: 4,
    background: "#1E3A5F",
    borderRadius: 2,
    overflow: "hidden" as const,
    display: "inline-block",
    verticalAlign: "middle",
  }),
  confFill: (pct: number) => ({
    height: "100%",
    width: `${pct}%`,
    background: pct >= 90 ? C.green : pct >= 70 ? C.amber : C.red,
    borderRadius: 2,
  }),
  totalRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "16px 0 0",
    borderTop: `1px solid ${C.border}`,
    marginTop: 8,
  },
  scanAnim: {
    textAlign: "center" as const,
    padding: "60px 24px",
  },
  pulse: {
    width: 80,
    height: 80,
    borderRadius: "50%",
    background: C.blue + "22",
    border: `2px solid ${C.blue}`,
    margin: "0 auto 24px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 32,
    animation: "pulse 1.5s ease-in-out infinite",
  },
  riskHigh:   { color: C.red,    fontSize: 13 },
  riskMed:    { color: C.amber,  fontSize: 13 },
  riskInfo:   { color: C.blueLt, fontSize: 13 },
};

// ─── Confidence bar component ─────────────────────────────
function ConfBar({ value }: { value: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={s.confBar(value)}>
        <div style={s.confFill(value)} />
      </div>
      <span style={{ fontSize: 12, color: C.muted }}>{value}%</span>
    </div>
  );
}

// ─── Upload screen ────────────────────────────────────────
function UploadScreen({
  onFile,
}: {
  onFile: (file: File) => void;
}) {
  const [dragging, setDragging] = useState(false);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file && file.type === "application/pdf") onFile(file);
    },
    [onFile]
  );

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onFile(file);
  };

  return (
    <div>
      <style>{`
        @keyframes pulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.08); opacity: 0.8; }
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: ${C.bgDark}; }
      `}</style>

      <div style={{ marginBottom: 32 }}>
        <h1 style={s.h1}>Scan a drawing</h1>
        <p style={s.p}>
          Upload an electrical drawing PDF from your email or files. ElectraScan will automatically detect every GPO, downlight, switchboard and more — then build your estimate.
        </p>
      </div>

      <label style={{ display: "block", cursor: "pointer" }}>
        <div
          style={{
            ...s.uploadZone,
            ...(dragging ? s.uploadZoneActive : {}),
          }}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
        >
          <div style={{ fontSize: 48, marginBottom: 16 }}>📄</div>
          <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 8 }}>
            Drop your PDF here
          </div>
          <div style={{ color: C.muted, fontSize: 14, marginBottom: 20 }}>
            or tap to choose from your files or email
          </div>
          <span style={s.btn}>
            Choose PDF
          </span>
        </div>
        <input
          type="file"
          accept="application/pdf"
          style={{ display: "none" }}
          onChange={handleInput}
        />
      </label>

      <div style={{ ...s.card, marginTop: 24 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.muted, marginBottom: 12, textTransform: "uppercase" as const, letterSpacing: "0.06em" }}>
          What gets detected
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {[
            "Power points (GPO)",
            "Downlights & fans",
            "Switches & dimmers",
            "Main & sub boards",
            "AC units",
            "Data & TV points",
            "Security & CCTV",
            "EV chargers",
            "Pool equipment",
            "Home automation",
          ].map((item) => (
            <div key={item} style={{ fontSize: 13, color: C.muted, display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ color: C.green }}>✓</span> {item}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Scanning screen ──────────────────────────────────────
function ScanningScreen({ fileName }: { fileName: string }) {
  return (
    <div style={s.scanAnim}>
      <div style={s.pulse}>⚡</div>
      <h2 style={{ ...s.h2, marginBottom: 8 }}>Scanning drawing...</h2>
      <p style={s.p}>
        Claude Vision is reading <strong style={{ color: C.text }}>{fileName}</strong>
        <br />and detecting electrical components.
        <br />This takes about 20–40 seconds.
      </p>
      <div style={{ marginTop: 24, color: C.muted, fontSize: 13 }}>
        Detecting GPOs · Lighting · Switchboards · AC · Security · EV...
      </div>
    </div>
  );
}

// ─── Results screen ───────────────────────────────────────
function ResultsScreen({
  result,
  fileName,
  onReset,
}: {
  result: DetectionResult;
  fileName: string;
  onReset: () => void;
}) {
  const [activeTab, setActiveTab] = useState<"schedule" | "risks">("schedule");
  const byRoom = groupByRoom(result.components);
  const reviewItems = getReviewItems(result.components);
  const highRisks = result.risk_flags.filter((f) => f.level === "high");

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: "8px 16px",
    fontSize: 14,
    fontWeight: 500,
    borderRadius: 6,
    border: "none",
    cursor: "pointer",
    background: active ? C.blue : "transparent",
    color: active ? "#fff" : C.muted,
  });

  return (
    <div>
      {/* Summary header */}
      <div style={s.card}>
        <div style={s.row}>
          <div>
            <div style={{ fontSize: 13, color: C.muted, marginBottom: 4 }}>
              {fileName} · {result.page_count} page{result.page_count !== 1 ? "s" : ""} · Scale {result.scale_detected}
            </div>
            <h2 style={{ ...s.h2, marginBottom: 0 }}>
              {result.components.length} components detected
            </h2>
          </div>
          <button style={s.btnGhost} onClick={onReset}>
            New scan
          </button>
        </div>

        {/* Stats row */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginTop: 20 }}>
          <div style={{ background: "#0D1B2A", borderRadius: 8, padding: 14 }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: C.text }}>
              ${result.estimate_subtotal.toLocaleString()}
            </div>
            <div style={{ fontSize: 12, color: C.muted }}>Estimate subtotal ex GST</div>
          </div>
          <div style={{ background: "#0D1B2A", borderRadius: 8, padding: 14 }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: reviewItems.length > 0 ? C.amber : C.green }}>
              {reviewItems.length}
            </div>
            <div style={{ fontSize: 12, color: C.muted }}>Items need review</div>
          </div>
          <div style={{ background: "#0D1B2A", borderRadius: 8, padding: 14 }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: highRisks.length > 0 ? C.red : C.green }}>
              {highRisks.length}
            </div>
            <div style={{ fontSize: 12, color: C.muted }}>High risk flags</div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 16 }}>
        <button style={tabStyle(activeTab === "schedule")} onClick={() => setActiveTab("schedule")}>
          Component schedule
        </button>
        <button style={tabStyle(activeTab === "risks")} onClick={() => setActiveTab("risks")}>
          Risk flags {result.risk_flags.length > 0 && `(${result.risk_flags.length})`}
        </button>
      </div>

      {/* Schedule tab */}
      {activeTab === "schedule" && (
        <div>
          {Object.entries(byRoom).map(([room, components]) => (
            <div key={room} style={s.card}>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.muted, marginBottom: 12, textTransform: "uppercase" as const, letterSpacing: "0.06em" }}>
                {room}
              </div>
              {components.map((c: DetectedComponent, i: number) => (
                <div key={i} style={s.componentRow}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>
                      {LABELS[c.type] ?? c.type}
                      {c.flags.includes("LOW_CONFIDENCE") && (
                        <span style={{ ...s.tag(C.amber), marginLeft: 6 }}>Review</span>
                      )}
                    </div>
                    {c.flags.filter(f => f !== "LOW_CONFIDENCE").map(f => (
                      <span key={f} style={s.tag(C.muted)}>{FLAG_LABELS[f] ?? f}</span>
                    ))}
                    {c.notes && (
                      <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>{c.notes}</div>
                    )}
                  </div>
                  <div style={{ textAlign: "center" as const, minWidth: 32 }}>
                    <div style={{ fontSize: 18, fontWeight: 700 }}>{c.quantity}</div>
                    <div style={{ fontSize: 11, color: C.muted }}>qty</div>
                  </div>
                  <div style={{ textAlign: "right" as const, minWidth: 80 }}>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>
                      ${c.line_total.toLocaleString()}
                    </div>
                    <ConfBar value={c.confidence} />
                  </div>
                </div>
              ))}
              <div style={{ textAlign: "right" as const, paddingTop: 10, fontSize: 13, color: C.muted }}>
                Room total: <strong style={{ color: C.text }}>
                  ${components.reduce((s: number, c: DetectedComponent) => s + c.line_total, 0).toLocaleString()}
                </strong>
              </div>
            </div>
          ))}

          {/* Grand total */}
          <div style={s.card}>
            <div style={s.totalRow}>
              <span style={{ fontSize: 16, fontWeight: 600 }}>Subtotal (ex GST)</span>
              <span style={{ fontSize: 22, fontWeight: 700, color: C.blue }}>
                ${result.estimate_subtotal.toLocaleString()}
              </span>
            </div>
            <div style={{ ...s.totalRow, borderTop: "none", paddingTop: 8 }}>
              <span style={{ fontSize: 14, color: C.muted }}>GST (10%)</span>
              <span style={{ fontSize: 14, color: C.muted }}>
                ${(result.estimate_subtotal * 0.1).toLocaleString()}
              </span>
            </div>
            <div style={{ ...s.totalRow, borderTop: `1px solid ${C.border}`, paddingTop: 16, marginTop: 8 }}>
              <span style={{ fontSize: 16, fontWeight: 700 }}>Total inc GST</span>
              <span style={{ fontSize: 24, fontWeight: 700, color: C.green }}>
                ${(result.estimate_subtotal * 1.1).toLocaleString()}
              </span>
            </div>
            <div style={{ marginTop: 20, display: "flex", gap: 10 }}>
              <button style={s.btn}>Export PDF quote</button>
              <button style={s.btnGhost}>Export CSV</button>
            </div>
          </div>
        </div>
      )}

      {/* Risks tab */}
      {activeTab === "risks" && (
        <div>
          {result.risk_flags.length === 0 ? (
            <div style={{ ...s.card, textAlign: "center" as const, padding: 40 }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>✓</div>
              <div style={{ color: C.green, fontWeight: 600 }}>No risk flags detected</div>
            </div>
          ) : (
            result.risk_flags.map((flag, i) => (
              <div key={i} style={s.card}>
                <div style={s.row}>
                  <div>
                    <span style={
                      flag.level === "high" ? s.riskHigh :
                      flag.level === "medium" ? s.riskMed : s.riskInfo
                    }>
                      {flag.level === "high" ? "⚠ HIGH" : flag.level === "medium" ? "● MEDIUM" : "ℹ INFO"}
                    </span>
                    <div style={{ fontSize: 15, fontWeight: 600, marginTop: 6 }}>
                      {LABELS[flag.component_type] ?? flag.component_type}
                    </div>
                  </div>
                </div>
                <p style={{ ...s.p, marginTop: 8, fontSize: 14 }}>{flag.description}</p>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ─── Root App ─────────────────────────────────────────────
export default function App() {
  const [screen, setScreen] = useState<Screen>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<DetectionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (f: File) => {
    setFile(f);
    setError(null);
    setScreen("scanning");

    try {
      const detection = await detectElectricalComponents(f, "001");
      setResult(detection);
      setScreen("results");
    } catch (err: any) {
      setError(err?.message ?? "Detection failed. Please try again.");
      setScreen("upload");
    }
  };

  const handleReset = () => {
    setFile(null);
    setResult(null);
    setError(null);
    setScreen("upload");
  };

  return (
    <div style={s.app}>
      {/* Header */}
      <div style={s.header}>
        <div style={s.logo}>
          Electra<span style={s.logoSpan}>Scan</span>
        </div>
        <div style={s.badge}>Vesh Electrical · Beta</div>
      </div>

      {/* Main content */}
      <div style={s.main}>
        {error && (
          <div style={{ ...s.card, borderColor: C.red, marginBottom: 20 }}>
            <div style={{ color: C.red, fontWeight: 600, marginBottom: 4 }}>Detection error</div>
            <div style={{ color: C.muted, fontSize: 14 }}>{error}</div>
          </div>
        )}

        {screen === "upload" && <UploadScreen onFile={handleFile} />}
        {screen === "scanning" && file && <ScanningScreen fileName={file.name} />}
        {screen === "results" && result && file && (
          <ResultsScreen result={result} fileName={file.name} onReset={handleReset} />
        )}
      </div>
    </div>
  );
}
