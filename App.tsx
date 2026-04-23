import { useState, useCallback, useEffect } from "react";
import {
  detectElectricalComponents,
  type DetectionResult,
  type DetectedComponent,
  groupByRoom,
  getReviewItems,
} from "./analyze_pdf";
import {
  listProjects,
  createProject,
  createVersion,
  linkEstimateToVersion,
  nextProjectColour,
} from "./services/projectService";
import { createEstimate, getEstimate } from "./services/estimateService";
import EstimateEditor from "./EstimateEditor";
import type { Project, DrawingVersion, Estimate } from "./project.types";

// ─── Theme ───────────────────────────────────────────────────
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

// ─── Screen ───────────────────────────────────────────────────
type Screen = "projects" | "upload" | "scanning" | "results" | "estimate";

// ─── Label maps ──────────────────────────────────────────────
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
  HEIGHT_RISK:           "Height Risk — scaffold required",
  AUTOMATION_DEPENDENCY: "Automation — programmer needed",
  MISSING_CIRCUIT:       "Missing circuit on drawing",
  SCOPE_CONFIRM:         "Confirm scope with architect",
  OUTDOOR_LOCATION:      "Outdoor — weatherproof required",
  OFF_FORM_PREMIUM:      "Off-form premium applies",
  CABLE_RUN_LONG:        "Long cable run — verify length",
  LOW_CONFIDENCE:        "Low confidence — verify on drawing",
  SYMBOL_AMBIGUOUS:      "Ambiguous symbol — check manually",
};

// ─── Shared styles ────────────────────────────────────────────
const sh: Record<string, React.CSSProperties> = {
  app:      { minHeight: "100vh", background: C.bgDark, color: C.text, fontFamily: "'DM Sans', system-ui, sans-serif" },
  header:   { background: C.navy, borderBottom: `1px solid ${C.border}`, padding: "0 24px", height: 56, display: "flex", alignItems: "center", justifyContent: "space-between" },
  logo:     { fontSize: 18, fontWeight: 700, color: C.blue, letterSpacing: "-0.02em" },
  badge:    { fontSize: 11, background: "#1E3A5F", color: C.blueLt, padding: "2px 8px", borderRadius: 4, fontWeight: 500 },
  main:     { maxWidth: 760, margin: "0 auto", padding: "40px 24px" },
  card:     { background: C.navy, border: `1px solid ${C.border}`, borderRadius: 12, padding: 24, marginBottom: 16 },
  btn:      { background: C.blue, color: "#fff", border: "none", borderRadius: 8, padding: "11px 22px", fontSize: 14, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 8 },
  btnGhost: { background: "transparent", color: C.muted, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 18px", fontSize: 14, cursor: "pointer" },
  row:      { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 },
};

function tag(color: string): React.CSSProperties {
  return { display: "inline-block", fontSize: 11, fontWeight: 500, padding: "2px 8px", borderRadius: 4, background: color + "22", color, marginRight: 4 };
}

// ─── Confidence bar ───────────────────────────────────────────
function ConfBar({ value }: { value: number }) {
  const fill = value >= 90 ? C.green : value >= 70 ? C.amber : C.red;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ width: 60, height: 4, background: "#1E3A5F", borderRadius: 2, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${value}%`, background: fill, borderRadius: 2 }} />
      </div>
      <span style={{ fontSize: 12, color: C.muted }}>{value}%</span>
    </div>
  );
}

// ─── Status badge ─────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    active: C.blue, pending: C.amber, complete: C.green, superseded: C.muted,
    draft: C.muted, locked: C.green, submitted: C.blue, approved: C.green, rejected: C.red,
  };
  return <span style={tag(map[status] ?? C.muted)}>{status}</span>;
}

// ─────────────────────────────────────────────────────────────
// PROJECTS SCREEN
// ─────────────────────────────────────────────────────────────

function ProjectsScreen({
  projects,
  loading,
  onNewScan,
  onOpenProject,
}: {
  projects: Project[];
  loading: boolean;
  onNewScan: () => void;
  onOpenProject: (p: Project) => void;
}) {
  const [filter, setFilter] = useState<"all" | "active" | "pending" | "complete">("all");
  const filtered = filter === "all" ? projects : projects.filter(p => p.status === filter);

  return (
    <div>
      <div style={{ ...sh.row, marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 4 }}>Projects</h1>
          <p style={{ color: C.muted, fontSize: 14 }}>{projects.length} project{projects.length !== 1 ? "s" : ""}</p>
        </div>
        <button style={sh.btn as React.CSSProperties} onClick={onNewScan}>+ New Scan</button>
      </div>

      {/* Filter pills */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        {(["all", "active", "pending", "complete"] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{ padding: "6px 14px", borderRadius: 20, border: "none", fontSize: 13, fontWeight: 500, cursor: "pointer", background: filter === f ? C.blue : "#1E3A5F", color: filter === f ? "#fff" : C.muted }}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: 60, color: C.muted }}>Loading projects…</div>
      ) : filtered.length === 0 ? (
        <div style={{ ...sh.card, textAlign: "center", padding: 60 }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>📁</div>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>No projects yet</div>
          <div style={{ color: C.muted, fontSize: 14, marginBottom: 24 }}>Upload an electrical drawing to create your first estimate.</div>
          <button style={sh.btn as React.CSSProperties} onClick={onNewScan}>Start your first scan</button>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16 }}>
          {filtered.map(p => (
            <div
              key={p.id}
              onClick={() => onOpenProject(p)}
              style={{ ...sh.card, borderLeft: `4px solid ${p.color}`, cursor: "pointer", transition: "opacity 0.15s", marginBottom: 0 }}
            >
              <div style={{ ...sh.row, marginBottom: 10 }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{p.name}</div>
                <StatusBadge status={p.status} />
              </div>
              {p.address && <div style={{ fontSize: 13, color: C.muted, marginBottom: 6 }}>📍 {p.address}</div>}
              {p.builder && <div style={{ fontSize: 13, color: C.muted, marginBottom: 6 }}>👷 {p.builder}</div>}
              <div style={{ display: "flex", gap: 16, marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.border}` }}>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>{p.version_count}</div>
                  <div style={{ fontSize: 11, color: C.muted }}>Versions</div>
                </div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: C.green }}>
                    {p.last_estimate ? `$${Math.round(p.last_estimate).toLocaleString()}` : "—"}
                  </div>
                  <div style={{ fontSize: 11, color: C.muted }}>Last estimate</div>
                </div>
                <div style={{ textAlign: "center", marginLeft: "auto" }}>
                  <div style={{ fontSize: 12, color: C.muted }}>
                    {new Date(p.updated_at).toLocaleDateString("en-AU")}
                  </div>
                  <div style={{ fontSize: 11, color: C.muted }}>Updated</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// NEW PROJECT MODAL
// ─────────────────────────────────────────────────────────────

function NewProjectModal({
  onSave,
  onCancel,
  saving,
}: {
  onSave: (data: { name: string; address: string; builder: string; client: string }) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [name, setName]       = useState("");
  const [address, setAddress] = useState("");
  const [builder, setBuilder] = useState("");
  const [client, setClient]   = useState("");

  const inputStyle: React.CSSProperties = {
    width: "100%", background: "#0D1B2A", color: C.text,
    border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 14px",
    fontSize: 14, outline: "none", marginBottom: 12,
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999 }}>
      <div style={{ ...sh.card, width: 440, margin: 0, borderRadius: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 20 }}>Save to Project</h2>
        <label style={{ fontSize: 12, color: C.muted, display: "block", marginBottom: 4 }}>Project name *</label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. 12 Smith St — Renovation" style={inputStyle} />
        <label style={{ fontSize: 12, color: C.muted, display: "block", marginBottom: 4 }}>Address</label>
        <input value={address} onChange={e => setAddress(e.target.value)} placeholder="e.g. 12 Smith St, Surry Hills NSW" style={inputStyle} />
        <label style={{ fontSize: 12, color: C.muted, display: "block", marginBottom: 4 }}>Builder</label>
        <input value={builder} onChange={e => setBuilder(e.target.value)} placeholder="e.g. Allen Build" style={inputStyle} />
        <label style={{ fontSize: 12, color: C.muted, display: "block", marginBottom: 4 }}>Client</label>
        <input value={client} onChange={e => setClient(e.target.value)} placeholder="e.g. Private Client" style={inputStyle} />
        <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
          <button
            style={{ ...sh.btn as React.CSSProperties, opacity: (!name.trim() || saving) ? 0.5 : 1 }}
            disabled={!name.trim() || saving}
            onClick={() => onSave({ name: name.trim(), address, builder, client })}
          >
            {saving ? "Saving…" : "Save & Build Estimate"}
          </button>
          <button style={sh.btnGhost as React.CSSProperties} onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// UPLOAD SCREEN
// ─────────────────────────────────────────────────────────────

function UploadScreen({ onFile, onBack }: { onFile: (f: File) => void; onBack: () => void }) {
  const [dragging, setDragging] = useState(false);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f?.type === "application/pdf") onFile(f);
  }, [onFile]);

  return (
    <div>
      <style>{`
        @keyframes pulse { 0%,100%{transform:scale(1);opacity:1} 50%{transform:scale(1.08);opacity:0.8} }
        *{box-sizing:border-box;margin:0;padding:0} body{background:${C.bgDark}}
      `}</style>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 28 }}>
        <button onClick={onBack} style={{ background: "transparent", border: "none", color: C.muted, cursor: "pointer", fontSize: 20 }}>‹</button>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700 }}>New scan</h1>
          <p style={{ color: C.muted, fontSize: 14 }}>Upload an electrical drawing PDF to detect components and build an estimate.</p>
        </div>
      </div>
      <label style={{ display: "block", cursor: "pointer" }}>
        <div
          style={{ border: `2px dashed ${dragging ? C.blue : C.border}`, borderRadius: 12, padding: "48px 24px", textAlign: "center", background: dragging ? "#0D2347" : "transparent", transition: "all 0.2s" }}
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
        >
          <div style={{ fontSize: 48, marginBottom: 16 }}>📄</div>
          <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 8 }}>Drop your PDF here</div>
          <div style={{ color: C.muted, fontSize: 14, marginBottom: 20 }}>or tap to choose from your files</div>
          <span style={sh.btn as React.CSSProperties}>Choose PDF</span>
        </div>
        <input type="file" accept="application/pdf" style={{ display: "none" }} onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
      </label>
      <div style={{ ...sh.card, marginTop: 24 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.06em" }}>What gets detected</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {["Power points (GPO)","Downlights & fans","Switches & dimmers","Main & sub boards","AC units","Data & TV points","Security & CCTV","EV chargers","Pool equipment","Home automation"].map(item => (
            <div key={item} style={{ fontSize: 13, color: C.muted, display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ color: C.green }}>✓</span> {item}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// SCANNING SCREEN
// ─────────────────────────────────────────────────────────────

function ScanningScreen({ fileName }: { fileName: string }) {
  return (
    <div style={{ textAlign: "center", padding: "60px 24px" }}>
      <div style={{ width: 80, height: 80, borderRadius: "50%", background: C.blue + "22", border: `2px solid ${C.blue}`, margin: "0 auto 24px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32, animation: "pulse 1.5s ease-in-out infinite" }}>⚡</div>
      <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>Scanning drawing…</h2>
      <p style={{ color: C.muted, fontSize: 14 }}>
        Claude Vision is reading <strong style={{ color: C.text }}>{fileName}</strong><br />
        and detecting electrical components. About 20–40 seconds.
      </p>
      <div style={{ marginTop: 24, color: C.muted, fontSize: 13 }}>Detecting GPOs · Lighting · Switchboards · AC · Security · EV…</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// RESULTS SCREEN
// ─────────────────────────────────────────────────────────────

function ResultsScreen({
  result,
  fileName,
  onReset,
  onSaveToProject,
  onBuildEstimate,
  saving,
  project,
}: {
  result: DetectionResult;
  fileName: string;
  onReset: () => void;
  onSaveToProject: () => void;
  onBuildEstimate: () => void;
  saving: boolean;
  project: Project | null;
}) {
  const [activeTab, setActiveTab] = useState<"schedule" | "risks">("schedule");
  const byRoom = groupByRoom(result.components);
  const reviewItems = getReviewItems(result.components);
  const highRisks = result.risk_flags.filter(f => f.level === "high");

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: "8px 16px", fontSize: 14, fontWeight: 500, borderRadius: 6,
    border: "none", cursor: "pointer",
    background: active ? C.blue : "transparent",
    color: active ? "#fff" : C.muted,
  });

  return (
    <div>
      {/* Summary */}
      <div style={sh.card}>
        <div style={sh.row}>
          <div>
            <div style={{ fontSize: 13, color: C.muted, marginBottom: 4 }}>
              {fileName} · {result.page_count} page{result.page_count !== 1 ? "s" : ""} · Scale {result.scale_detected}
              {result.title_block?.drawingNumber && ` · ${result.title_block.drawingNumber}`}
            </div>
            <h2 style={{ fontSize: 20, fontWeight: 600 }}>{result.components.length} components detected</h2>
          </div>
          <button style={sh.btnGhost as React.CSSProperties} onClick={onReset}>New scan</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginTop: 20 }}>
          {[
            { value: `$${result.estimate_subtotal.toLocaleString()}`, label: "Estimate subtotal ex GST", color: C.text },
            { value: reviewItems.length, label: "Items need review", color: reviewItems.length > 0 ? C.amber : C.green },
            { value: highRisks.length, label: "High risk flags", color: highRisks.length > 0 ? C.red : C.green },
          ].map((stat, i) => (
            <div key={i} style={{ background: "#0D1B2A", borderRadius: 8, padding: 14 }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: stat.color }}>{stat.value}</div>
              <div style={{ fontSize: 12, color: C.muted }}>{stat.label}</div>
            </div>
          ))}
        </div>

        {/* Action bar */}
        <div style={{ display: "flex", gap: 10, marginTop: 20, paddingTop: 20, borderTop: `1px solid ${C.border}` }}>
          {project ? (
            <>
              <span style={{ fontSize: 13, color: C.green }}>✓ Saved to {project.name}</span>
              <button style={sh.btn as React.CSSProperties} onClick={onBuildEstimate}>Build Estimate →</button>
            </>
          ) : (
            <>
              <button style={sh.btn as React.CSSProperties} onClick={onSaveToProject} disabled={saving}>
                {saving ? "Saving…" : "💾 Save to Project"}
              </button>
              <button style={sh.btnGhost as React.CSSProperties} onClick={onBuildEstimate}>
                Build Estimate (unsaved)
              </button>
            </>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 16 }}>
        <button style={tabStyle(activeTab === "schedule")} onClick={() => setActiveTab("schedule")}>Component schedule</button>
        <button style={tabStyle(activeTab === "risks")} onClick={() => setActiveTab("risks")}>
          Risk flags {result.risk_flags.length > 0 && `(${result.risk_flags.length})`}
        </button>
      </div>

      {/* Schedule tab */}
      {activeTab === "schedule" && (
        <div>
          {Object.entries(byRoom).map(([room, components]) => (
            <div key={room} style={sh.card}>
              <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.06em" }}>{room}</div>
              {(components as DetectedComponent[]).map((c, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 0", borderBottom: `1px solid ${C.border}`, gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>
                      {LABELS[c.type] ?? c.type}
                      {c.flags.includes("LOW_CONFIDENCE") && <span style={{ ...tag(C.amber), marginLeft: 6 }}>Review</span>}
                    </div>
                    {c.flags.filter(f => f !== "LOW_CONFIDENCE").map(f => (
                      <span key={f} style={tag(C.muted)}>{FLAG_LABELS[f] ?? f}</span>
                    ))}
                    {c.notes && <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>{c.notes}</div>}
                  </div>
                  <div style={{ textAlign: "center", minWidth: 32 }}>
                    <div style={{ fontSize: 18, fontWeight: 700 }}>{c.quantity}</div>
                    <div style={{ fontSize: 11, color: C.muted }}>qty</div>
                  </div>
                  <div style={{ textAlign: "right", minWidth: 80 }}>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>${c.line_total.toLocaleString()}</div>
                    <ConfBar value={c.confidence} />
                  </div>
                </div>
              ))}
              <div style={{ textAlign: "right", paddingTop: 10, fontSize: 13, color: C.muted }}>
                Room total: <strong style={{ color: C.text }}>${(components as DetectedComponent[]).reduce((s, c) => s + c.line_total, 0).toLocaleString()}</strong>
              </div>
            </div>
          ))}

          {/* Totals */}
          <div style={sh.card}>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "16px 0 0", borderTop: `1px solid ${C.border}` }}>
              <span style={{ fontSize: 16, fontWeight: 600 }}>Subtotal (ex GST)</span>
              <span style={{ fontSize: 22, fontWeight: 700, color: C.blue }}>${result.estimate_subtotal.toLocaleString()}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderTop: "none" }}>
              <span style={{ fontSize: 14, color: C.muted }}>GST (10%)</span>
              <span style={{ fontSize: 14, color: C.muted }}>${(result.estimate_subtotal * 0.1).toLocaleString()}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "16px 0 0", borderTop: `1px solid ${C.border}`, marginTop: 8 }}>
              <span style={{ fontSize: 16, fontWeight: 700 }}>Total inc GST</span>
              <span style={{ fontSize: 24, fontWeight: 700, color: C.green }}>${(result.estimate_subtotal * 1.1).toLocaleString()}</span>
            </div>
          </div>
        </div>
      )}

      {/* Risks tab */}
      {activeTab === "risks" && (
        <div>
          {result.risk_flags.length === 0 ? (
            <div style={{ ...sh.card, textAlign: "center", padding: 40 }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>✓</div>
              <div style={{ color: C.green, fontWeight: 600 }}>No risk flags detected</div>
            </div>
          ) : (
            result.risk_flags.map((flag, i) => (
              <div key={i} style={{ ...sh.card, borderLeft: `3px solid ${flag.level === "high" ? C.red : flag.level === "medium" ? C.amber : C.blueLt}` }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: flag.level === "high" ? C.red : flag.level === "medium" ? C.amber : C.blueLt }}>
                  {flag.level === "high" ? "⚠ HIGH" : flag.level === "medium" ? "● MEDIUM" : "ℹ INFO"}
                </span>
                <div style={{ fontSize: 15, fontWeight: 600, marginTop: 6 }}>{LABELS[flag.component_type] ?? flag.component_type}</div>
                <p style={{ color: C.muted, fontSize: 14, lineHeight: 1.6, marginTop: 8 }}>{flag.description}</p>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// ROOT APP
// ─────────────────────────────────────────────────────────────

export default function App() {
  const [screen, setScreen]               = useState<Screen>("projects");
  const [projects, setProjects]           = useState<Project[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [currentProject, setCurrentProject]   = useState<Project | null>(null);
  const [currentVersion, setCurrentVersion]   = useState<DrawingVersion | null>(null);
  const [currentEstimate, setCurrentEstimate] = useState<Estimate | null>(null);
  const [file, setFile]                   = useState<File | null>(null);
  const [result, setResult]               = useState<DetectionResult | null>(null);
  const [error, setError]                 = useState<string | null>(null);
  const [saving, setSaving]               = useState(false);
  const [showNewProjectModal, setShowNewProjectModal] = useState(false);

  // Load projects on mount
  useEffect(() => {
    listProjects()
      .then(setProjects)
      .catch(() => {})
      .finally(() => setProjectsLoading(false));
  }, []);

  const handleFile = async (f: File) => {
    setFile(f); setError(null); setScreen("scanning");
    try {
      const detection = await detectElectricalComponents(f, "001");
      setResult(detection);
      setScreen("results");
    } catch (err: any) {
      setError(err?.message ?? "Detection failed. Please try again.");
      setScreen("upload");
    }
  };

  const handleSaveToProject = async (data: { name: string; address: string; builder: string; client: string }) => {
    if (!result) return;
    setSaving(true);
    setShowNewProjectModal(false);
    try {
      const project = await createProject({
        name: data.name, address: data.address,
        builder: data.builder, client: data.client,
        status: "active", color: nextProjectColour(projects), description: "",
      });
      const version = await createVersion(project.id, result, `Direct upload — ${file?.name ?? ""}`);
      const estimate = await createEstimate(project.id, version.id, result);
      await linkEstimateToVersion(version.id, estimate.id);

      const fullEstimate = await getEstimate(estimate.id);
      setCurrentProject(project);
      setCurrentVersion(version);
      setCurrentEstimate(fullEstimate);
      setProjects(prev => [project, ...prev]);
    } catch (err: any) {
      setError(err?.message ?? "Failed to save project.");
    } finally {
      setSaving(false);
    }
  };

  const handleBuildEstimate = async () => {
    // If no project saved yet, create an unsaved estimate in memory
    if (!result) return;
    if (!currentEstimate) {
      // Create a temporary in-memory project for unsaved estimates
      const tempProject: Project = {
        id: "temp", name: file?.name?.replace(".pdf", "") ?? "Unsaved Estimate",
        address: "", client: "", builder: "", status: "active",
        color: C.blue, description: "", version_count: 1, last_estimate: result.estimate_subtotal,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      };
      // Build a local estimate without persisting
      const { detectionToLineItems } = await import("./services/estimateService");
      const tempId = `EST-TEMP-${Date.now()}`;
      const items = detectionToLineItems(tempId, result).map((item, i) => ({
        ...item, id: `temp-${i}`, line_total: item.qty * item.rate, created_at: new Date().toISOString(),
      }));
      const tempEst: Estimate = {
        id: tempId, project_id: "temp", version_id: "temp",
        margin_pct: 0, status: "draft", locked_at: null,
        subtotal: result.estimate_subtotal,
        margin_amount: 0, gst: result.estimate_subtotal * 0.1,
        total: result.estimate_subtotal * 1.1,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        line_items: items,
      };
      setCurrentProject(tempProject);
      setCurrentEstimate(tempEst);
    }
    setScreen("estimate");
  };

  const handleReset = () => {
    setFile(null); setResult(null); setError(null);
    setCurrentProject(null); setCurrentVersion(null); setCurrentEstimate(null);
    setScreen("projects");
  };

  // Show estimate editor full-screen
  if (screen === "estimate" && currentProject && currentEstimate) {
    return (
      <EstimateEditor
        project={currentProject}
        estimate={currentEstimate}
        onBack={() => result ? setScreen("results") : setScreen("projects")}
      />
    );
  }

  return (
    <div style={sh.app}>
      {/* Header */}
      <div style={sh.header}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <button
            onClick={() => setScreen("projects")}
            style={{ ...sh.logo, background: "transparent", border: "none", cursor: "pointer", padding: 0 }}
          >
            Electra<span style={{ color: C.text }}>Scan</span>
          </button>
          {screen !== "projects" && (
            <span style={{ color: C.muted, fontSize: 13 }}>
              {screen === "upload" && "New scan"}
              {screen === "scanning" && "Scanning…"}
              {screen === "results" && "Results"}
            </span>
          )}
        </div>
        <div style={sh.badge}>Vesh Electrical · Beta</div>
      </div>

      {/* Main */}
      <div style={sh.main}>
        {error && (
          <div style={{ ...sh.card, borderColor: C.red, marginBottom: 20 }}>
            <div style={{ color: C.red, fontWeight: 600, marginBottom: 4 }}>Error</div>
            <div style={{ color: C.muted, fontSize: 14 }}>{error}</div>
          </div>
        )}

        {screen === "projects" && (
          <ProjectsScreen
            projects={projects}
            loading={projectsLoading}
            onNewScan={() => setScreen("upload")}
            onOpenProject={(p) => {
              setCurrentProject(p);
              // Navigate to results if we have a result, otherwise just set project
            }}
          />
        )}
        {screen === "upload" && <UploadScreen onFile={handleFile} onBack={() => setScreen("projects")} />}
        {screen === "scanning" && file && <ScanningScreen fileName={file.name} />}
        {screen === "results" && result && file && (
          <ResultsScreen
            result={result}
            fileName={file.name}
            onReset={handleReset}
            onSaveToProject={() => setShowNewProjectModal(true)}
            onBuildEstimate={handleBuildEstimate}
            saving={saving}
            project={currentProject}
          />
        )}
      </div>

      {/* New project modal */}
      {showNewProjectModal && (
        <NewProjectModal
          onSave={handleSaveToProject}
          onCancel={() => setShowNewProjectModal(false)}
          saving={saving}
        />
      )}
    </div>
  );
}
