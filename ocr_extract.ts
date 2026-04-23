/**
 * ElectraScan — OCR Text Layer Extraction
 * =========================================
 * Extracts embedded text from PDF pages using pdfjs-dist's getTextContent().
 * This runs before the Claude vision passes and provides a structured text
 * layer that catches small annotations, callouts, and legend labels that
 * vision alone can miss on dense electrical drawings.
 */

import * as pdfjsLib from "pdfjs-dist";

export interface TextItem {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
}

export interface PageTextContent {
  page: number;
  rawText: string;
  items: TextItem[];
  titleBlock: TitleBlockData | null;
  legendText: string[];
}

export interface TitleBlockData {
  drawingNumber: string | null;
  revision: string | null;
  projectName: string | null;
  drawingTitle: string | null;
  date: string | null;
  engineer: string | null;
  scale: string | null;
}

// ─────────────────────────────────────────────
// CORE EXTRACTION
// ─────────────────────────────────────────────

export async function extractTextFromPDF(file: File): Promise<PageTextContent[]> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
  const pages: PageTextContent[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const viewport = page.getViewport({ scale: 1.0 });

    const items: TextItem[] = (textContent.items as any[])
      .filter((item) => item.str?.trim().length > 0)
      .map((item) => {
        const [, , , , tx, ty] = item.transform as number[];
        return {
          text: item.str.trim(),
          x: tx,
          y: viewport.height - ty, // flip Y to top-left origin
          width: item.width ?? 0,
          height: item.height ?? 0,
          fontSize: item.height ?? 10,
        };
      });

    const rawText = items.map((i) => i.text).join(" ");

    pages.push({
      page: i,
      rawText,
      items,
      titleBlock: parseTitleBlock(rawText, items),
      legendText: extractLegendText(items, viewport.height),
    });
  }

  return pages;
}

// ─────────────────────────────────────────────
// TITLE BLOCK PARSER
// Electrical drawings put the title block in the bottom-right corner.
// We grab text from the bottom 15% of the page.
// ─────────────────────────────────────────────

function parseTitleBlock(rawText: string, items: TextItem[]): TitleBlockData | null {
  if (!rawText) return null;

  const r = (pattern: RegExp): string | null => {
    const m = rawText.match(pattern);
    return m ? m[1]?.trim() ?? null : null;
  };

  return {
    drawingNumber: r(/(?:drawing\s*(?:no|number|#)[:\s]+)([A-Z0-9\-./]+)/i)
      ?? r(/\b([A-Z]{1,4}-\d{3,6})\b/),
    revision: r(/(?:rev(?:ision)?\.?\s*)[:\s]?([A-Z0-9]+)/i),
    projectName: r(/(?:project\s*(?:name)?[:\s]+)([^\n|]{3,60})/i),
    drawingTitle: r(/(?:title[:\s]+)([^\n|]{3,80})/i),
    date: r(/(?:date[:\s]+)(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4})/i),
    engineer: r(/(?:(?:designed|drawn|checked)\s*(?:by)?[:\s]+)([A-Za-z\s.]{3,40})/i),
    scale: r(/(?:scale[:\s]+)(1\s*[:]\s*[\d.]+)/i),
  };
}

// ─────────────────────────────────────────────
// LEGEND TEXT EXTRACTOR
// Legend/key sections typically appear in corners at smaller font sizes.
// We collect lines that look like component descriptions.
// ─────────────────────────────────────────────

const LEGEND_KEYWORDS = [
  "gpo", "power point", "downlight", "switch", "dimmer", "pendant",
  "exhaust", "fan", "circuit", "switchboard", "panel", "light",
  "sensor", "intercom", "cctv", "alarm", "data", "tv", "ev",
  "motorised", "blind", "dynalite", "dali", "zetr", "hager", "clipsal",
  "outdoor", "weatherproof", "heated", "towel", "underfloor",
];

function extractLegendText(items: TextItem[], pageHeight: number): string[] {
  const legendLines: string[] = [];
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);

  // Cluster text items into lines by Y proximity (within 4px)
  const lines: TextItem[][] = [];
  let currentLine: TextItem[] = [];
  let lastY = -999;

  for (const item of sorted) {
    if (Math.abs(item.y - lastY) > 4 && currentLine.length > 0) {
      lines.push(currentLine);
      currentLine = [];
    }
    currentLine.push(item);
    lastY = item.y;
  }
  if (currentLine.length > 0) lines.push(currentLine);

  for (const line of lines) {
    const lineText = line.map((i) => i.text).join(" ").trim();
    const lower = lineText.toLowerCase();
    if (LEGEND_KEYWORDS.some((kw) => lower.includes(kw))) {
      legendLines.push(lineText);
    }
  }

  return legendLines;
}

// ─────────────────────────────────────────────
// FORMAT FOR CLAUDE PROMPT INJECTION
// ─────────────────────────────────────────────

export function formatOCRForPrompt(pages: PageTextContent[]): string {
  const parts: string[] = [];

  for (const p of pages) {
    if (!p.rawText) continue;
    const lines: string[] = [`--- Page ${p.page} text layer ---`];

    if (p.titleBlock) {
      const tb = p.titleBlock;
      const tbParts = [
        tb.drawingNumber ? `Drawing: ${tb.drawingNumber}` : null,
        tb.revision ? `Rev: ${tb.revision}` : null,
        tb.drawingTitle ? `Title: ${tb.drawingTitle}` : null,
        tb.scale ? `Scale: ${tb.scale}` : null,
        tb.date ? `Date: ${tb.date}` : null,
      ].filter(Boolean);
      if (tbParts.length) lines.push(`Title block: ${tbParts.join(" | ")}`);
    }

    if (p.legendText.length > 0) {
      lines.push(`Legend text found:\n${p.legendText.map((l) => `  • ${l}`).join("\n")}`);
    }

    // Include full raw text but trim to 2000 chars per page to avoid token bloat
    const truncated = p.rawText.length > 2000
      ? p.rawText.slice(0, 2000) + "…[truncated]"
      : p.rawText;
    lines.push(`Full text: ${truncated}`);

    parts.push(lines.join("\n"));
  }

  return parts.join("\n\n");
}
