/**
 * ElectraScan — Estimate Editor
 * ==============================
 * Full estimate editing screen with:
 *   - Editable line items (description, qty, rate, unit)
 *   - Margin / markup editor (0–40%)
 *   - Voice notes per line item (Web Speech API, graceful fallback)
 *   - Cable & conduit calculator (auto-computed from LM items + 15% buffer)
 *   - Lock / finalise workflow
 *   - PDF quote export (jsPDF)
 *   - CSV export
 */

import { useState, useRef, useCallback, useEffect } from "react";
import jsPDF from "jspdf";
import type { Estimate, EstimateLineItem, LineItemUnit } from "./project.types";
import type { Project } from "./project.types";
import {
  updateLineItem,
  deleteLineItem,
  addLineItem,
  saveVoiceNote,
  lockEstimate,
  updateEstimateMargin,
  recalcTotals,
} from "./services/estimateService";

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────

const CABLE_RATE_PER_M   = 8;    // AUD per metre (twin & earth 2.5mm²)
const CONDUIT_RATE_PER_M = 4;    // AUD per metre (20mm conduit)
const BUFFER             = 0.15; // 15% cable/conduit length buffer

// ─────────────────────────────────────────────
// THEME
// ─────────────────────────────────────────────

const C = {
  bgDark:  "#0D1B2A",
  navy:    "#112236",
  blue:    "#1D6EFD",
  blueLt:  "#3B82F6",
  green:   "#10B981",
  amber:   "#F59E0B",
  red:     "#EF4444",
  text:    "#E2E8F0",
  muted:   "#64748B",
  border:  "#1E3A5F",
};

// ─────────────────────────────────────────────
// VOICE NOTE HOOK
// ─────────────────────────────────────────────

function useVoiceNote(onTranscript: (text: string) => void) {
  const recognitionRef = useRef<any>(null);
  const [recording, setRecording] = useState(false);
  const supported = typeof window !== "undefined" &&
    ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);

  const start = useCallback(() => {
    if (!supported) return;
    const SpeechRecognition = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    const r = new SpeechRecognition();
    r.lang = "en-AU";
    r.continuous = false;
    r.interimResults = false;
    r.onresult = (e: any) => {
      const text = Array.from(e.results as any[])
        .map((r: any) => r[0].transcript)
        .join(" ")
        .trim();
      onTranscript(text);
    };
    r.onerror = () => setRecording(false);
    r.onend   = () => setRecording(false);
    recognitionRef.current = r;
    r.start();
    setRecording(true);
  }, [supported, onTranscript]);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
    setRecording(false);
  }, []);

  return { recording, start, stop, supported };
}

// ─────────────────────────────────────────────
// PDF EXPORT
// ─────────────────────────────────────────────

function exportPDF(
  project: Project,
  estimate: Estimate,
  items: EstimateLineItem[],
  margin: number
) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const { subtotal, marginAmount, gst, total } = recalcTotals(items, margin);

  const W = 210;
  const MARGIN = 20;
  const COL = [MARGIN, 90, 120, 145, 175]; // desc | qty | unit | rate | total
  let y = MARGIN;

  // ── Header ─────────────────────────────────
  doc.setFillColor(17, 34, 54);
  doc.rect(0, 0, W, 28, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(255, 255, 255);
  doc.text("ElectraScan", MARGIN, 12);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text("Vesh Electrical Services Pty Ltd", MARGIN, 19);
  doc.setFontSize(10);
  doc.text(`Estimate ${estimate.id}`, W - MARGIN, 12, { align: "right" });
  doc.text(new Date().toLocaleDateString("en-AU"), W - MARGIN, 19, { align: "right" });

  y = 36;

  // ── Project info ───────────────────────────
  doc.setTextColor(30, 30, 30);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(project.name, MARGIN, y); y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  if (project.address) { doc.text(project.address, MARGIN, y); y += 5; }
  if (project.builder) { doc.text(`Builder: ${project.builder}`, MARGIN, y); y += 5; }
  if (project.client)  { doc.text(`Client: ${project.client}`, MARGIN, y); y += 5; }
  y += 4;

  // ── Table header ──────────────────────────
  doc.setFillColor(240, 244, 248);
  doc.rect(MARGIN - 2, y - 4, W - MARGIN * 2 + 4, 8, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(30, 30, 30);
  doc.text("Description",  COL[0], y);
  doc.text("Qty",          COL[1], y, { align: "right" });
  doc.text("Unit",         COL[2], y, { align: "right" });
  doc.text("Rate",         COL[3], y, { align: "right" });
  doc.text("Total",        COL[4], y, { align: "right" });
  y += 8;

  // ── Line items ────────────────────────────
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  let lastRoom = "";

  for (const item of items.sort((a, b) => a.sort_order - b.sort_order)) {
    if (y > 270) { doc.addPage(); y = MARGIN; }

    // Room grouping header
    if (item.room && item.room !== lastRoom) {
      y += 2;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.5);
      doc.setTextColor(100, 116, 139);
      doc.text(item.room.toUpperCase(), COL[0], y);
      y += 4;
      lastRoom = item.room;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(30, 30, 30);
    }

    const lineTotal = item.qty * item.rate;
    doc.text(item.description.slice(0, 58), COL[0], y);
    doc.text(item.qty.toString(),           COL[1], y, { align: "right" });
    doc.text(item.unit,                     COL[2], y, { align: "right" });
    doc.text(`$${item.rate.toLocaleString()}`, COL[3], y, { align: "right" });
    doc.text(`$${lineTotal.toLocaleString()}`, COL[4], y, { align: "right" });

    // Voice note (italic, indented)
    if (item.voice_note) {
      y += 4;
      doc.setFont("helvetica", "italic");
      doc.setFontSize(7.5);
      doc.setTextColor(100, 116, 139);
      doc.text(`Note: ${item.voice_note.slice(0, 80)}`, COL[0] + 4, y);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(30, 30, 30);
    }

    // Separator
    doc.setDrawColor(220, 228, 240);
    doc.line(MARGIN - 2, y + 2, W - MARGIN + 2, y + 2);
    y += 7;
  }

  y += 4;

  // ── Totals ────────────────────────────────
  const drawTotal = (label: string, value: number, bold = false) => {
    if (y > 270) { doc.addPage(); y = MARGIN; }
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(bold ? 10 : 9);
    doc.setTextColor(bold ? 16 : 100, bold ? 24 : 116, bold ? 39 : 139);
    doc.text(label, W - MARGIN - 50, y);
    doc.setTextColor(30, 30, 30);
    doc.text(`$${Math.round(value).toLocaleString()}`, W - MARGIN, y, { align: "right" });
    y += 6;
  };

  drawTotal("Subtotal (ex GST)", subtotal);
  if (margin > 0) drawTotal(`Margin (${margin}%)`, marginAmount);
  drawTotal("GST (10%)", gst);
  y += 2;
  doc.setDrawColor(29, 110, 253);
  doc.line(W - MARGIN - 60, y - 4, W - MARGIN, y - 4);
  drawTotal("TOTAL inc GST", total, true);

  // ── Footer ────────────────────────────────
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(150, 150, 150);
  doc.text(`Generated by ElectraScan · ${new Date().toLocaleDateString("en-AU")} · ${estimate.id}`, MARGIN, 288);
  doc.text("All prices in AUD. Payment terms: as per contract.", W - MARGIN, 288, { align: "right" });

  doc.save(`${estimate.id}-${project.name.replace(/\s+/g, "-")}.pdf`);
}

// ─────────────────────────────────────────────
// CSV EXPORT
// ─────────────────────────────────────────────

function exportCSV(project: Project, estimate: Estimate, items: EstimateLineItem[], margin: number) {
  const { subtotal, marginAmount, gst, total } = recalcTotals(items, margin);
  const rows = [
    ["ElectraScan Estimate", estimate.id, project.name],
    [""],
    ["Description", "Room", "Unit", "Qty", "Rate", "Total", "Confidence", "Note"],
    ...items.map(i => [
      i.description,
      i.room ?? "",
      i.unit,
      i.qty,
      i.rate,
      (i.qty * i.rate).toFixed(2),
      i.confidence ?? "",
      i.voice_note ?? "",
    ]),
    [""],
    ["Subtotal (ex GST)", "", "", "", "", subtotal.toFixed(2)],
    [`Margin (${margin}%)`, "", "", "", "", marginAmount.toFixed(2)],
    ["GST (10%)", "", "", "", "", gst.toFixed(2)],
    ["TOTAL inc GST", "", "", "", "", total.toFixed(2)],
  ];

  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${estimate.id}-${project.name.replace(/\s+/g, "-")}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─────────────────────────────────────────────
// LINE ITEM ROW
// ─────────────────────────────────────────────

function LineItemRow({
  item,
  locked,
  onUpdate,
  onDelete,
}: {
  item: EstimateLineItem;
  locked: boolean;
  onUpdate: (patch: Partial<EstimateLineItem>) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item);
  const [showNote, setShowNote] = useState(!!item.voice_note);
  const [noteText, setNoteText] = useState(item.voice_note ?? "");
  const [noteSaving, setNoteSaving] = useState(false);

  const { recording, start, stop, supported: voiceSupported } = useVoiceNote((text) => {
    setNoteText(prev => prev ? `${prev} ${text}` : text);
    setShowNote(true);
  });

  const handleSave = () => {
    onUpdate({ description: draft.description, unit: draft.unit, qty: draft.qty, rate: draft.rate });
    setEditing(false);
  };

  const handleSaveNote = async () => {
    setNoteSaving(true);
    await saveVoiceNote(item.id, noteText).catch(() => {});
    onUpdate({ voice_note: noteText });
    setNoteSaving(false);
  };

  const lineTotal = draft.qty * draft.rate;
  const isLM = item.unit === "LM";

  const rowStyle: React.CSSProperties = {
    padding: "12px 16px",
    borderBottom: `1px solid ${C.border}`,
    background: editing ? "#0D2347" : "transparent",
  };

  return (
    <div style={rowStyle}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>

        {/* Description */}
        <div style={{ flex: 1 }}>
          {editing ? (
            <input
              value={draft.description}
              onChange={e => setDraft({ ...draft, description: e.target.value })}
              style={{ background: "#0D1B2A", color: C.text, border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 10px", width: "100%", fontSize: 13 }}
            />
          ) : (
            <div style={{ fontSize: 14, fontWeight: 500 }}>
              {item.description}
              {item.confidence != null && item.confidence < 80 && (
                <span style={{ marginLeft: 6, fontSize: 11, color: C.amber, background: C.amber + "22", padding: "1px 6px", borderRadius: 4 }}>
                  Review
                </span>
              )}
              {isLM && (
                <span style={{ marginLeft: 6, fontSize: 11, color: C.blueLt, background: C.blueLt + "22", padding: "1px 6px", borderRadius: 4 }}>LM</span>
              )}
            </div>
          )}
          {item.room && !editing && (
            <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{item.room}</div>
          )}
        </div>

        {/* Qty */}
        <div style={{ width: 60, textAlign: "right" }}>
          {editing ? (
            <input
              type="number" min={0} value={draft.qty}
              onChange={e => setDraft({ ...draft, qty: parseFloat(e.target.value) || 0 })}
              style={{ background: "#0D1B2A", color: C.text, border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 8px", width: "100%", fontSize: 13, textAlign: "right" }}
            />
          ) : (
            <span style={{ fontSize: 14, fontWeight: 600 }}>{item.qty}</span>
          )}
        </div>

        {/* Unit */}
        <div style={{ width: 56 }}>
          {editing ? (
            <select
              value={draft.unit}
              onChange={e => setDraft({ ...draft, unit: e.target.value as LineItemUnit })}
              style={{ background: "#0D1B2A", color: C.text, border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 4px", width: "100%", fontSize: 12 }}
            >
              {(["EA", "LM", "LS", "HR"] as LineItemUnit[]).map(u => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
          ) : (
            <span style={{ fontSize: 12, color: C.muted }}>{item.unit}</span>
          )}
        </div>

        {/* Rate */}
        <div style={{ width: 80, textAlign: "right" }}>
          {editing ? (
            <input
              type="number" min={0} value={draft.rate}
              onChange={e => setDraft({ ...draft, rate: parseFloat(e.target.value) || 0 })}
              style={{ background: "#0D1B2A", color: C.text, border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 8px", width: "100%", fontSize: 13, textAlign: "right" }}
            />
          ) : (
            <span style={{ fontSize: 13, color: C.muted }}>${item.rate.toLocaleString()}</span>
          )}
        </div>

        {/* Line total */}
        <div style={{ width: 88, textAlign: "right" }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>${lineTotal.toLocaleString()}</span>
        </div>

        {/* Actions */}
        {!locked && (
          <div style={{ display: "flex", gap: 6 }}>
            {editing ? (
              <>
                <button onClick={handleSave} style={{ background: C.green, color: "#fff", border: "none", borderRadius: 6, padding: "5px 12px", fontSize: 12, cursor: "pointer" }}>Save</button>
                <button onClick={() => { setDraft(item); setEditing(false); }} style={{ background: "transparent", color: C.muted, border: `1px solid ${C.border}`, borderRadius: 6, padding: "5px 10px", fontSize: 12, cursor: "pointer" }}>Cancel</button>
              </>
            ) : (
              <>
                <button onClick={() => setEditing(true)} title="Edit" style={{ background: "transparent", color: C.muted, border: `1px solid ${C.border}`, borderRadius: 6, padding: "5px 8px", fontSize: 12, cursor: "pointer" }}>✎</button>
                <button
                  onClick={() => { if (recording) stop(); else start(); setShowNote(true); }}
                  title={voiceSupported ? (recording ? "Stop recording" : "Voice note") : "Voice not supported in this browser"}
                  disabled={!voiceSupported}
                  style={{ background: recording ? C.red + "22" : "transparent", color: recording ? C.red : C.muted, border: `1px solid ${recording ? C.red : C.border}`, borderRadius: 6, padding: "5px 8px", fontSize: 12, cursor: voiceSupported ? "pointer" : "not-allowed" }}
                >
                  {recording ? "⏹" : "🎤"}
                </button>
                <button onClick={onDelete} title="Delete" style={{ background: "transparent", color: C.red, border: `1px solid ${C.border}`, borderRadius: 6, padding: "5px 8px", fontSize: 12, cursor: "pointer" }}>✕</button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Voice note area */}
      {showNote && (
        <div style={{ marginTop: 8, marginLeft: 0, padding: "10px 12px", background: "#0A1929", borderRadius: 8, border: `1px solid ${C.border}` }}>
          {recording && (
            <div style={{ fontSize: 12, color: C.red, marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: C.red, display: "inline-block", animation: "pulse 1s infinite" }} />
              Recording... speak now
            </div>
          )}
          {locked ? (
            <div style={{ fontSize: 13, color: C.text, fontStyle: "italic" }}>{noteText || "—"}</div>
          ) : (
            <textarea
              value={noteText}
              onChange={e => setNoteText(e.target.value)}
              placeholder="Voice note or type here…"
              rows={2}
              style={{ width: "100%", background: "transparent", color: C.text, border: "none", fontSize: 13, fontStyle: "italic", resize: "vertical", outline: "none" }}
            />
          )}
          {!locked && (
            <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
              <button onClick={handleSaveNote} disabled={noteSaving} style={{ background: C.blue, color: "#fff", border: "none", borderRadius: 5, padding: "4px 12px", fontSize: 12, cursor: "pointer" }}>
                {noteSaving ? "Saving…" : "Save note"}
              </button>
              <button onClick={() => { setShowNote(false); setNoteText(""); }} style={{ background: "transparent", color: C.muted, border: "none", fontSize: 12, cursor: "pointer" }}>
                Dismiss
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────

export default function EstimateEditor({
  project,
  estimate: initialEstimate,
  onBack,
}: {
  project: Project;
  estimate: Estimate;
  onBack: () => void;
}) {
  const [items, setItems]         = useState<EstimateLineItem[]>(initialEstimate.line_items ?? []);
  const [margin, setMargin]       = useState(initialEstimate.margin_pct);
  const [estimate, setEstimate]   = useState(initialEstimate);
  const [locking, setLocking]     = useState(false);
  const [saving, setSaving]       = useState(false);

  const locked = estimate.status === "locked";
  const { subtotal, marginAmount, gst, total } = recalcTotals(items, margin);

  // Cable / conduit calculator from LM items
  const lmItems = items.filter(i => i.unit === "LM");
  const totalLM = lmItems.reduce((s, i) => s + i.qty, 0);
  const bufferedLM = totalLM * (1 + BUFFER);
  const cableCost = bufferedLM * CABLE_RATE_PER_M;
  const conduitCost = bufferedLM * CONDUIT_RATE_PER_M;

  // Save margin to Supabase after debounce
  useEffect(() => {
    if (locked) return;
    const t = setTimeout(() => {
      updateEstimateMargin(estimate.id, subtotal, margin).catch(() => {});
    }, 800);
    return () => clearTimeout(t);
  }, [margin, subtotal, estimate.id, locked]);

  const handleItemUpdate = (id: string, patch: Partial<EstimateLineItem>) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, ...patch, line_total: (patch.qty ?? i.qty) * (patch.rate ?? i.rate) } : i));
    // Persist to Supabase
    updateLineItem(id, patch).catch(() => {});
  };

  const handleItemDelete = (id: string) => {
    setItems(prev => prev.filter(i => i.id !== id));
    deleteLineItem(id).catch(() => {});
  };

  const handleAddItem = async () => {
    const newItem = await addLineItem({
      estimate_id: estimate.id,
      description: "New item",
      unit: "EA",
      qty: 1,
      rate: 0,
      component_type: null,
      room: null,
      confidence: null,
      flags: [],
      voice_note: null,
      sort_order: items.length,
    });
    setItems(prev => [...prev, newItem]);
  };

  const handleLock = async () => {
    setLocking(true);
    try {
      const locked = await lockEstimate(estimate.id);
      setEstimate(locked);
    } finally {
      setLocking(false);
    }
  };

  // ── Styles ───────────────────────────────────
  const s = {
    container: { minHeight: "100vh", background: C.bgDark, color: C.text, fontFamily: "'DM Sans', system-ui, sans-serif" } as React.CSSProperties,
    header: { background: C.navy, borderBottom: `1px solid ${C.border}`, padding: "0 24px", height: 56, display: "flex", alignItems: "center", justifyContent: "space-between" } as React.CSSProperties,
    layout: { display: "flex", maxWidth: 1100, margin: "0 auto", padding: "24px 24px", gap: 24 } as React.CSSProperties,
    main: { flex: 1, minWidth: 0 } as React.CSSProperties,
    sidebar: { width: 260, flexShrink: 0 } as React.CSSProperties,
    card: { background: C.navy, border: `1px solid ${C.border}`, borderRadius: 12, marginBottom: 16, overflow: "hidden" } as React.CSSProperties,
    cardPad: { padding: 20 } as React.CSSProperties,
    btn: (color = C.blue) => ({ background: color, color: "#fff", border: "none", borderRadius: 8, padding: "10px 20px", fontSize: 14, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 } as React.CSSProperties),
    btnGhost: { background: "transparent", color: C.muted, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 18px", fontSize: 14, cursor: "pointer" } as React.CSSProperties,
    totalRow: (bold = false) => ({ display: "flex", justifyContent: "space-between", padding: "8px 0", fontSize: bold ? 16 : 14, fontWeight: bold ? 700 : 400, color: bold ? C.green : C.muted, borderTop: bold ? `1px solid ${C.border}` : "none", marginTop: bold ? 8 : 0 } as React.CSSProperties),
  };

  return (
    <div style={s.container}>
      <style>{`
        @keyframes pulse { 0%,100%{opacity:1}50%{opacity:.5} }
        * { box-sizing:border-box; margin:0; padding:0; }
      `}</style>

      {/* Header */}
      <div style={s.header}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <button onClick={onBack} style={{ background: "transparent", border: "none", color: C.muted, cursor: "pointer", fontSize: 20 }}>‹</button>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>Estimate Editor</div>
            <div style={{ fontSize: 12, color: C.muted }}>{estimate.id} · {project.name}</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {locked ? (
            <>
              <span style={{ fontSize: 13, color: C.green, background: C.green + "22", padding: "4px 12px", borderRadius: 20 }}>
                ✓ Locked {estimate.locked_at ? new Date(estimate.locked_at).toLocaleDateString("en-AU") : ""}
              </span>
              <button style={s.btn()} onClick={() => exportPDF(project, estimate, items, margin)}>Export PDF</button>
              <button style={s.btnGhost} onClick={() => exportCSV(project, estimate, items, margin)}>Export CSV</button>
            </>
          ) : (
            <button
              style={s.btn(C.green)}
              onClick={handleLock}
              disabled={locking}
            >
              {locking ? "⏳ Locking…" : "🔒 Finalise & Lock"}
            </button>
          )}
        </div>
      </div>

      {locked && (
        <div style={{ background: C.green + "11", borderBottom: `1px solid ${C.green + "44"}`, padding: "10px 24px", fontSize: 14, color: C.green, textAlign: "center" }}>
          ✓ Estimate locked — Total inc GST: <strong>${Math.round(total).toLocaleString()}</strong> · Ready to export or send for approval
        </div>
      )}

      <div style={s.layout}>
        {/* ── Main: line items ─────────────────── */}
        <div style={s.main}>
          {/* Section header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontSize: 13, color: C.muted }}>
              {items.length} line items
              {items.some(i => (i.confidence ?? 100) < 80) && (
                <span style={{ marginLeft: 8, color: C.amber }}>· Some items need review</span>
              )}
            </div>
            {!locked && (
              <button onClick={handleAddItem} style={s.btn()}>+ Add Line Item</button>
            )}
          </div>

          <div style={s.card}>
            {/* Table header */}
            <div style={{ display: "flex", gap: 12, padding: "10px 16px", borderBottom: `1px solid ${C.border}`, fontSize: 11, fontWeight: 600, color: C.muted, textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>
              <div style={{ flex: 1 }}>Description</div>
              <div style={{ width: 60, textAlign: "right" }}>Qty</div>
              <div style={{ width: 56 }}>Unit</div>
              <div style={{ width: 80, textAlign: "right" }}>Rate</div>
              <div style={{ width: 88, textAlign: "right" }}>Total</div>
              {!locked && <div style={{ width: 120 }} />}
            </div>

            {items.length === 0 ? (
              <div style={{ padding: 40, textAlign: "center", color: C.muted }}>No line items yet.</div>
            ) : (
              items.sort((a, b) => a.sort_order - b.sort_order).map(item => (
                <LineItemRow
                  key={item.id}
                  item={item}
                  locked={locked}
                  onUpdate={patch => handleItemUpdate(item.id, patch)}
                  onDelete={() => handleItemDelete(item.id)}
                />
              ))
            )}
          </div>

          {/* Cable / Conduit Calculator */}
          {lmItems.length > 0 && (
            <div style={s.card}>
              <div style={{ ...s.cardPad, borderBottom: `1px solid ${C.border}` }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 2 }}>Cable & Conduit (Live)</div>
                <div style={{ fontSize: 12, color: C.muted }}>Auto-computed from LM line items · +15% buffer applied</div>
              </div>
              <div style={s.cardPad}>
                {lmItems.map(i => (
                  <div key={i.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0", color: C.muted }}>
                    <span>{i.description}</span>
                    <span>{i.qty}m</span>
                  </div>
                ))}
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "8px 0", borderTop: `1px solid ${C.border}`, marginTop: 8, color: C.amber, fontWeight: 600 }}>
                  <span>Raw total</span><span>{totalLM}m</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0", color: C.amber }}>
                  <span>+15% buffer total</span><span>{Math.ceil(bufferedLM)}m</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0", color: C.muted }}>
                  <span>Cable (est. ${CABLE_RATE_PER_M}/m)</span><span>${Math.round(cableCost).toLocaleString()}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0", color: C.muted }}>
                  <span>Conduit (est. ${CONDUIT_RATE_PER_M}/m)</span><span>${Math.round(conduitCost).toLocaleString()}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, fontWeight: 700, padding: "8px 0", borderTop: `1px solid ${C.border}`, marginTop: 8, color: C.text }}>
                  <span>Total LM cost</span><span>${Math.round(cableCost + conduitCost).toLocaleString()}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Sidebar: margin + summary ─────────── */}
        <div style={s.sidebar}>
          {/* Margin editor */}
          {!locked && (
            <div style={s.card}>
              <div style={s.cardPad}>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 12 }}>Margin / Markup</div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                  <input
                    type="range" min={0} max={40} step={0.5}
                    value={margin}
                    onChange={e => setMargin(parseFloat(e.target.value))}
                    style={{ flex: 1, accentColor: C.blue }}
                  />
                  <input
                    type="number" min={0} max={40} step={0.5}
                    value={margin}
                    onChange={e => setMargin(Math.min(40, Math.max(0, parseFloat(e.target.value) || 0)))}
                    style={{ width: 52, background: "#0D1B2A", color: C.text, border: `1px solid ${C.border}`, borderRadius: 6, padding: "4px 6px", fontSize: 13, textAlign: "right" }}
                  />
                  <span style={{ fontSize: 13, color: C.muted }}>%</span>
                </div>
                <div style={{ fontSize: 12, color: C.muted }}>
                  +${Math.round(marginAmount).toLocaleString()} added to estimate
                </div>
              </div>
            </div>
          )}

          {/* Estimate Summary */}
          <div style={{ ...s.card, background: C.bgDark }}>
            <div style={{ padding: "16px 20px 4px", fontSize: 13, fontWeight: 600, color: C.muted, textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>
              Estimate Summary
            </div>
            <div style={{ padding: "0 20px 16px" }}>
              <div style={s.totalRow()}>
                <span>Subtotal (ex GST)</span>
                <span style={{ color: C.text }}>${Math.round(subtotal).toLocaleString()}</span>
              </div>
              {margin > 0 && (
                <div style={s.totalRow()}>
                  <span>Margin ({margin}%)</span>
                  <span style={{ color: C.text }}>${Math.round(marginAmount).toLocaleString()}</span>
                </div>
              )}
              <div style={s.totalRow()}>
                <span>GST (10%)</span>
                <span style={{ color: C.text }}>${Math.round(gst).toLocaleString()}</span>
              </div>
              <div style={{ ...s.totalRow(true), paddingTop: 12 }}>
                <span style={{ color: C.text }}>Total inc GST</span>
                <span>${Math.round(total).toLocaleString()}</span>
              </div>
            </div>
          </div>

          {/* Export actions (always visible for convenience) */}
          <div style={{ display: "flex", flexDirection: "column" as const, gap: 8 }}>
            <button style={{ ...s.btn(), justifyContent: "center" }} onClick={() => exportPDF(project, estimate, items, margin)}>
              Export PDF Quote
            </button>
            <button style={{ ...s.btnGhost, textAlign: "center" as const }} onClick={() => exportCSV(project, estimate, items, margin)}>
              Export CSV
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
