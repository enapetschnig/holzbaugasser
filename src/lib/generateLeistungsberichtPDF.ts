import { jsPDF } from "jspdf";

// Umlaut helper for jsPDF WinAnsiEncoding
function pdfText(s: string): string {
  return s
    .replace(/ä/g, "\xe4")
    .replace(/ö/g, "\xf6")
    .replace(/ü/g, "\xfc")
    .replace(/Ä/g, "\xc4")
    .replace(/Ö/g, "\xd6")
    .replace(/Ü/g, "\xdc")
    .replace(/ß/g, "\xdf");
}

export type LeistungsberichtPDFData = {
  projektName: string;
  projektOrt: string;
  objekt: string;
  datum: string;
  ankunftZeit: string;
  abfahrtZeit: string;
  pauseVon: string;
  pauseBis: string;
  lkwStunden: number;
  taetigkeiten: { position: number; bezeichnung: string }[];
  mitarbeiter: {
    name: string;
    istFahrer: boolean;
    istWerkstatt: boolean;
    schmutzzulage: boolean;
    regenSchicht: boolean;
    stunden: { position: number; stunden: number }[];
    summe: number;
  }[];
  gesamtstunden: number;
  geraete: { geraet: string; stunden: number }[];
  materialien: { bezeichnung: string; menge: string }[];
  anmerkungen: string;
  fertiggestellt: boolean;
};

// ── Color constants ──────────────────────────────────────────────────────────
const DARK_GREEN: [number, number, number] = [43, 91, 44]; // Only for sidebar + logo
const TITLE_COLOR: [number, number, number] = [0, 0, 0]; // Section titles - pure black like paper
const BLACK: [number, number, number] = [0, 0, 0];
const GRAY: [number, number, number] = [120, 120, 120];
const RED: [number, number, number] = [200, 0, 0];
const WHITE: [number, number, number] = [255, 255, 255];
const ORANGE_RED: [number, number, number] = [210, 80, 0];
const HEADER_BG: [number, number, number] = [255, 255, 255]; // White like paper original
const LINE_COLOR: [number, number, number] = [0, 0, 0]; // Black lines like paper original

// ── Helper functions ─────────────────────────────────────────────────────────
function formatGermanDate(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00");
  return date.toLocaleDateString("de-AT", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatNumber(n: number): string {
  if (n === 0) return "";
  if (Number.isInteger(n)) return n.toString();
  return n.toFixed(1).replace(".", ",");
}

async function loadLogoAsBase64(): Promise<string | null> {
  try {
    const response = await fetch("/gasser-logo.png");
    if (!response.ok) return null;
    const blob = await response.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

// ── Helpers for drawing ──────────────────────────────────────────────────────
function drawRect(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  lineWidth = 0.3
) {
  doc.setDrawColor(...LINE_COLOR);
  doc.setLineWidth(lineWidth);
  doc.rect(x, y, w, h);
}

function drawLine(
  doc: jsPDF,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  lineWidth = 0.3
) {
  doc.setDrawColor(...LINE_COLOR);
  doc.setLineWidth(lineWidth);
  doc.line(x1, y1, x2, y2);
}

// ── Main function ────────────────────────────────────────────────────────────
export async function generateLeistungsberichtPDF(
  data: LeistungsberichtPDFData
): Promise<Blob> {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = 210;
  const pageH = 297;

  // Layout constants
  const sidebarW = 10;
  const mL = sidebarW + 4; // left margin after sidebar
  const mR = 6;
  const contentW = pageW - mL - mR;
  const contentRight = pageW - mR;

  // ════════════════════════════════════════════════════════════════════════════
  // LEFT SIDEBAR (full height green bar)
  // ════════════════════════════════════════════════════════════════════════════
  doc.setFillColor(...DARK_GREEN);
  doc.rect(0, 0, sidebarW, pageH, "F");

  doc.setTextColor(...WHITE);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  const sidebarMain =
    "\u25C7 Holzbau \u25C7 Tischlerei \u25C7 Planung \u25C7 Kulturwerkstatt";
  doc.text(sidebarMain, sidebarW / 2 + 1.5, pageH - 20, { angle: 90 });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(5);
  const sidebarAddr =
    "Holzbau Gasser GmbH, Edling 25, A-9072 Ludmannsdorf, Tel. 04228/2219-0, Fax 2750, e-mail: office@holzbau-gasser.at";
  doc.text(sidebarAddr, sidebarW / 2 - 1, pageH - 10, { angle: 90 });

  // ════════════════════════════════════════════════════════════════════════════
  // LOGO (top right)
  // ════════════════════════════════════════════════════════════════════════════
  const logo = await loadLogoAsBase64();
  if (logo) {
    try {
      doc.addImage(logo, "PNG", contentRight - 42, 5, 42, 15);
    } catch {
      // logo load failed
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // TITLE
  // ════════════════════════════════════════════════════════════════════════════
  let y = 12;
  doc.setTextColor(...TITLE_COLOR);
  doc.setFontSize(15);
  doc.setFont("helvetica", "bold");
  doc.text("Leistungsbericht:", mL, y);

  y += 5;
  doc.setTextColor(...ORANGE_RED);
  doc.setFontSize(8);
  doc.setFont("helvetica", "italic");
  doc.text(pdfText("Der Leistungsbericht ist täglich abzugeben!"), mL, y);

  // ════════════════════════════════════════════════════════════════════════════
  // BAUVORHABEN SECTION
  // ════════════════════════════════════════════════════════════════════════════
  y += 6;
  doc.setTextColor(...TITLE_COLOR);
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("Bauvorhaben:", mL, y);
  y += 5;

  const labelX = mL + 2;
  const valX = mL + 18;
  const rightBlockX = mL + contentW * 0.56;
  const rightValX = rightBlockX + 16;

  doc.setFontSize(8.5);

  // Name + Datum
  doc.setTextColor(...BLACK);
  doc.setFont("helvetica", "bold");
  doc.text("Name:", labelX, y);
  doc.setFont("helvetica", "normal");
  doc.text(pdfText(data.projektName), valX, y);
  drawLine(doc, valX, y + 0.8, rightBlockX - 4, y + 0.8, 0.15);

  doc.setFont("helvetica", "bold");
  doc.text("Datum:", rightBlockX, y);
  doc.setTextColor(...RED);
  doc.setFont("helvetica", "bold");
  doc.text(formatGermanDate(data.datum), rightValX, y);
  doc.setTextColor(...BLACK);
  drawLine(doc, rightValX, y + 0.8, contentRight, y + 0.8, 0.15);
  y += 5;

  // Ort
  doc.setFont("helvetica", "bold");
  doc.text("Ort:", labelX, y);
  doc.setFont("helvetica", "normal");
  doc.text(pdfText(data.projektOrt), valX, y);
  drawLine(doc, valX, y + 0.8, rightBlockX - 4, y + 0.8, 0.15);
  y += 5;

  // Objekt
  doc.setFont("helvetica", "bold");
  doc.text("Objekt:", labelX, y);
  doc.setFont("helvetica", "normal");
  doc.text(pdfText(data.objekt), valX, y);
  drawLine(doc, valX, y + 0.8, contentRight, y + 0.8, 0.15);
  y += 6;

  // ════════════════════════════════════════════════════════════════════════════
  // TAETIGKEITEN SECTION
  // ════════════════════════════════════════════════════════════════════════════
  drawLine(doc, mL, y, contentRight, y, 0.4);
  y += 5;

  doc.setTextColor(...TITLE_COLOR);
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text(pdfText("Tätigkeiten:"), mL, y);

  doc.setFontSize(8);
  doc.text("Regie", contentRight, y, { align: "right" });
  y += 4;

  // Build activity data
  const activityTexts: string[] = [];
  for (let i = 1; i <= 8; i++) {
    const found = data.taetigkeiten.find((t) => t.position === i);
    activityTexts.push(found ? found.bezeichnung : "");
  }
  // Row 1: Rüstzeit/Anfahrt with arrival time
  if (!activityTexts[0]) {
    activityTexts[0] = `Rüstzeit/Anfahrt, Ankunftszeit Baustelle: ${data.ankunftZeit}`;
  }

  // Activity grid (8 rows)
  const actRowH = 5.5;
  const actTableX = mL;
  const actNumW = 7;
  const actTextW = contentW - actNumW;
  const actGridTop = y;

  for (let i = 0; i < 8; i++) {
    const posNum = i + 1;
    const rowY = y + i * actRowH;

    // Number cell
    doc.setTextColor(...BLACK);
    doc.setFontSize(7.5);
    doc.setFont("helvetica", "bold");
    doc.text(`${posNum}.`, actTableX + 1.5, rowY + actRowH * 0.65);

    // Activity text
    doc.setFont("helvetica", "normal");
    let text = activityTexts[i];
    // Row 7 (index 6): LKW AN+ABFAHRT
    if (posNum === 7 && !text) {
      text = `LKW AN+ ABFAHRT`;
    }
    // Row 8 (index 7): Pause
    if (posNum === 8) {
      text = `Pause, Von: ${data.pauseVon}   Bis: ${data.pauseBis}`;
    }
    doc.text(pdfText(text), actTableX + actNumW + 1, rowY + actRowH * 0.65);

    // If row 7, show LKW hours on right
    if (posNum === 7 && data.lkwStunden > 0) {
      doc.text(
        formatNumber(data.lkwStunden),
        contentRight - 2,
        rowY + actRowH * 0.65,
        { align: "right" }
      );
    }
  }

  // Draw the activity grid lines
  const actGridBottom = actGridTop + 8 * actRowH;

  // Outer border
  drawRect(doc, actTableX, actGridTop, contentW, 8 * actRowH, 0.3);

  // Vertical line after number column
  drawLine(
    doc,
    actTableX + actNumW,
    actGridTop,
    actTableX + actNumW,
    actGridBottom,
    0.3
  );

  // Horizontal row lines
  for (let i = 1; i < 8; i++) {
    const lineY = actGridTop + i * actRowH;
    drawLine(doc, actTableX, lineY, contentRight, lineY, 0.2);
  }

  y = actGridBottom + 2;

  // Abfahrtszeit below grid
  doc.setTextColor(...BLACK);
  doc.setFontSize(7.5);
  doc.setFont("helvetica", "normal");
  doc.text(
    `Abfahrtszeit Baustelle:  ${data.abfahrtZeit}`,
    contentRight - 2,
    y,
    { align: "right" }
  );
  y += 5;

  // ════════════════════════════════════════════════════════════════════════════
  // MITARBEITER TABLE
  // ════════════════════════════════════════════════════════════════════════════
  const minRows = 10;
  const numWorkers = Math.max(data.mitarbeiter.length, minRows);

  // Column widths
  const colF = 5;
  const colR = 5;
  const colName = 30;
  const colSum18 = 11;
  const colAct = 10; // each activity column
  const colSumme = 15;
  const tableW = colF + colR + colName + colSum18 + 8 * colAct + colSumme;
  const tableX = mL;
  const tableXEnd = tableX + tableW;

  const headerH = 9;
  const rowH = 5;

  // "Geleistete Arbeitsstunden" label ABOVE the table
  const actColsStartX = tableX + colF + colR + colName + colSum18;
  doc.setFontSize(5.5);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...BLACK);
  doc.text(
    pdfText("Geleistete Arbeitsstunden für Tätigkeit Nr.:"),
    actColsStartX + (8 * colAct) / 2,
    y - 1.5,
    { align: "center" }
  );

  // Header background
  doc.setFillColor(...HEADER_BG);
  doc.rect(tableX, y, tableW, headerH, "F");

  // Header text
  doc.setFontSize(5.5);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...TITLE_COLOR);

  let hx = tableX;

  // F header
  doc.text("F", hx + colF / 2, y + 6, { align: "center" });
  hx += colF;

  // R header (Regen/Wetterschicht)
  doc.text("R", hx + colR / 2, y + 6, { align: "center" });
  hx += colR;

  // Mitarbeiter header
  doc.text("Mitarbeiter:", hx + 1, y + 3.5);
  doc.text("Name:", hx + 1, y + 7);
  hx += colName;

  // Summe 1-8 header
  doc.text("Summe", hx + colSum18 / 2, y + 3.5, { align: "center" });
  doc.text("1.-8.", hx + colSum18 / 2, y + 7, { align: "center" });
  hx += colSum18;

  // Number sub-headers (numbers 1-8 in header row)
  doc.setFontSize(5.5);
  for (let i = 0; i < 8; i++) {
    doc.text(`${i + 1}`, hx + colAct / 2, y + 7, { align: "center" });
    hx += colAct;
  }

  // Summe header
  doc.text("Summe", hx + colSumme / 2, y + 3.5, { align: "center" });
  doc.text("ohne Pause", hx + colSumme / 2, y + 7, { align: "center" });

  const tableTop = y;
  y += headerH;

  // Data rows
  doc.setTextColor(...BLACK);
  doc.setFontSize(6);

  for (let mi = 0; mi < numWorkers; mi++) {
    const m =
      mi < data.mitarbeiter.length ? data.mitarbeiter[mi] : null;
    let cx = tableX;

    // F column
    if (m && m.istFahrer) {
      doc.setFont("helvetica", "bold");
      doc.text("F", cx + colF / 2, y + rowH * 0.7, { align: "center" });
    }
    cx += colF;

    // R column (Regen/Wetterschicht)
    if (m && m.regenSchicht) {
      doc.setFont("helvetica", "bold");
      doc.text("R", cx + colR / 2, y + rowH * 0.7, { align: "center" });
    }
    cx += colR;

    // Name
    doc.setFont("helvetica", "normal");
    if (m) doc.text(pdfText(m.name), cx + 1, y + rowH * 0.7);
    cx += colName;

    // Sum 1-8
    if (m) {
      doc.text(formatNumber(m.summe), cx + colSum18 - 1.5, y + rowH * 0.7, {
        align: "right",
      });
    }
    cx += colSum18;

    // Individual activity hours
    for (let i = 1; i <= 8; i++) {
      if (m) {
        const entry = m.stunden.find((s) => s.position === i);
        const val = entry ? formatNumber(entry.stunden) : "";
        doc.text(val, cx + colAct - 1.5, y + rowH * 0.7, { align: "right" });
      }
      cx += colAct;
    }

    // Summe ohne Pause
    if (m) {
      doc.setFont("helvetica", "bold");
      doc.text(formatNumber(m.summe), cx + colSumme - 2, y + rowH * 0.7, {
        align: "right",
      });
    }

    y += rowH;
  }

  const tableBottom = y;

  // ── Draw table grid ─────────────────────────────────────────────────────
  // Outer border
  drawRect(doc, tableX, tableTop, tableW, tableBottom - tableTop, 0.4);

  // Header bottom line
  drawLine(doc, tableX, tableTop + headerH, tableXEnd, tableTop + headerH, 0.4);

  // Vertical lines
  let vx = tableX + colF;
  drawLine(doc, vx, tableTop, vx, tableBottom, 0.3); // after F
  vx += colR;
  drawLine(doc, vx, tableTop, vx, tableBottom, 0.3); // after R
  vx += colName;
  drawLine(doc, vx, tableTop, vx, tableBottom, 0.3); // after Name
  vx += colSum18;
  drawLine(doc, vx, tableTop, vx, tableBottom, 0.3); // after Sum 1-8

  // Activity column separators
  for (let i = 0; i < 8; i++) {
    if (i > 0) drawLine(doc, vx, tableTop, vx, tableBottom, 0.15);
    vx += colAct;
  }
  // Before Summe column
  drawLine(doc, vx, tableTop, vx, tableBottom, 0.3);

  // Horizontal row lines
  for (let i = 1; i < numWorkers; i++) {
    const lineY = tableTop + headerH + i * rowH;
    drawLine(doc, tableX, lineY, tableXEnd, lineY, 0.15);
  }

  y += 3;

  // ════════════════════════════════════════════════════════════════════════════
  // GESAMTSUMME
  // ════════════════════════════════════════════════════════════════════════════
  doc.setTextColor(...TITLE_COLOR);
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.text(
    `Gesamtsumme Arbeitsstunden: ${formatNumber(data.gesamtstunden)}`,
    mL,
    y
  );
  y += 5;

  // ════════════════════════════════════════════════════════════════════════════
  // GERAETEEINSATZ
  // ════════════════════════════════════════════════════════════════════════════
  doc.setTextColor(...TITLE_COLOR);
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.text(pdfText("Geräteeinsatz:"), mL, y);

  doc.setTextColor(...GRAY);
  doc.setFontSize(6);
  doc.setFont("helvetica", "normal");
  doc.text("LKW, Kran (in Stunden)", mL + 24, y);
  y += 3;

  const geraeteRows =
    data.geraete.length > 0
      ? data.geraete
      : [
          { geraet: "", stunden: 0 },
          { geraet: "", stunden: 0 },
        ];
  const geraeteColG = 50;
  const geraeteColS = 20;
  const geraeteW = geraeteColG + geraeteColS;
  const geraeteRowH = 4.5;
  const geraeteTop = y;

  doc.setTextColor(...BLACK);
  doc.setFontSize(6);
  doc.setFont("helvetica", "normal");

  for (let i = 0; i < geraeteRows.length; i++) {
    const g = geraeteRows[i];
    doc.text(pdfText(g.geraet), mL + 1, y + geraeteRowH * 0.7);
    if (g.stunden > 0) {
      doc.text(
        formatNumber(g.stunden),
        mL + geraeteColG + geraeteColS - 2,
        y + geraeteRowH * 0.7,
        { align: "right" }
      );
    }
    y += geraeteRowH;
  }

  const geraeteBottom = y;

  // Grid
  drawRect(doc, mL, geraeteTop, geraeteW, geraeteBottom - geraeteTop, 0.3);
  drawLine(
    doc,
    mL + geraeteColG,
    geraeteTop,
    mL + geraeteColG,
    geraeteBottom,
    0.3
  );
  for (let i = 1; i < geraeteRows.length; i++) {
    drawLine(
      doc,
      mL,
      geraeteTop + i * geraeteRowH,
      mL + geraeteW,
      geraeteTop + i * geraeteRowH,
      0.15
    );
  }

  y += 4;

  // ════════════════════════════════════════════════════════════════════════════
  // MATERIALIEN (left half) + ANMERKUNGEN (right half)
  // ════════════════════════════════════════════════════════════════════════════
  const matAnmY = y;
  const halfW = (contentW - 4) / 2;

  // ── LEFT: Materialien ──────────────────────────────────────────────────
  doc.setTextColor(...TITLE_COLOR);
  doc.setFontSize(7);
  doc.setFont("helvetica", "bold");
  doc.text(pdfText("Verbrauchte Materialien für Regiearbeiten:"), mL, y);
  y += 3;

  const matRows =
    data.materialien.length > 0
      ? data.materialien
      : [
          { bezeichnung: "", menge: "" },
          { bezeichnung: "", menge: "" },
        ];
  const matColBez = halfW - 18;
  const matColMen = 18;
  const matW = matColBez + matColMen;
  const matRowH = 4.5;
  const matTop = y;

  doc.setTextColor(...BLACK);
  doc.setFontSize(6);
  doc.setFont("helvetica", "normal");

  for (let i = 0; i < matRows.length; i++) {
    const mat = matRows[i];
    doc.text(pdfText(mat.bezeichnung), mL + 1, y + matRowH * 0.7);
    doc.text(mat.menge, mL + matColBez + 1, y + matRowH * 0.7);
    y += matRowH;
  }

  const matBottom = y;

  drawRect(doc, mL, matTop, matW, matBottom - matTop, 0.3);
  drawLine(doc, mL + matColBez, matTop, mL + matColBez, matBottom, 0.3);
  for (let i = 1; i < matRows.length; i++) {
    drawLine(
      doc,
      mL,
      matTop + i * matRowH,
      mL + matW,
      matTop + i * matRowH,
      0.15
    );
  }

  // ── RIGHT: Anmerkungen ────────────────────────────────────────────────
  const anmX = mL + halfW + 4;
  let anmY = matAnmY;

  doc.setTextColor(...TITLE_COLOR);
  doc.setFontSize(7);
  doc.setFont("helvetica", "bold");
  doc.text("Anmerkungen:", anmX, anmY);
  anmY += 3;

  const anmBoxTop = anmY;
  const anmBoxW = halfW;
  const anmBoxH = Math.max(matBottom - matTop, 16);

  // Draw anmerkungen box
  drawRect(doc, anmX, anmBoxTop, anmBoxW, anmBoxH, 0.3);

  doc.setTextColor(...BLACK);
  doc.setFontSize(6);
  doc.setFont("helvetica", "normal");
  if (data.anmerkungen) {
    const anmLines = doc.splitTextToSize(pdfText(data.anmerkungen), anmBoxW - 3);
    doc.text(anmLines, anmX + 1.5, anmBoxTop + 3.5);
  }

  // Safety notice below anmerkungen box
  const safetyY = anmBoxTop + anmBoxH + 2;
  doc.setTextColor(...GRAY);
  doc.setFontSize(5);
  doc.setFont("helvetica", "italic");
  doc.text(
    pdfText("Maßnahmen gemäß § 14 ASchG & BauV § 154 sowie"),
    anmX,
    safetyY
  );
  doc.text(
    pdfText("Hinweis zur Verwendung von Persönlicher"),
    anmX,
    safetyY + 3
  );
  doc.text(
    pdfText("Schutzausrüstung zur Kenntnis genommen!"),
    anmX,
    safetyY + 6
  );

  // Move y past the taller side
  y = Math.max(y, safetyY + 8) + 3;

  // ════════════════════════════════════════════════════════════════════════════
  // BAUVORHABEN FERTIGGESTELLT
  // ════════════════════════════════════════════════════════════════════════════
  doc.setTextColor(...BLACK);
  doc.setFontSize(7);
  doc.setFont("helvetica", "bold");
  doc.text(
    `Bauvorhaben fertiggestellt (ja/nein): ${data.fertiggestellt ? "Ja" : "Nein"}`,
    mL,
    y
  );
  y += 6;

  // ════════════════════════════════════════════════════════════════════════════
  // SIGNATURE LINES
  // ════════════════════════════════════════════════════════════════════════════
  const sigY = Math.max(y, pageH - 22);
  const sigLineW = 50;
  const sigGap = (contentW - 3 * sigLineW) / 2;

  const sig1X = mL;
  const sig2X = mL + sigLineW + sigGap;
  const sig3X = mL + 2 * (sigLineW + sigGap);

  drawLine(doc, sig1X, sigY, sig1X + sigLineW, sigY, 0.3);
  drawLine(doc, sig2X, sigY, sig2X + sigLineW, sigY, 0.3);
  drawLine(doc, sig3X, sigY, sig3X + sigLineW, sigY, 0.3);

  doc.setTextColor(...BLACK);
  doc.setFontSize(7);
  doc.setFont("helvetica", "normal");
  doc.text(pdfText("Partieführer:"), sig1X, sigY + 3.5);
  doc.text("Kontrolliert:", sig2X, sigY + 3.5);
  doc.text("Auftraggeber:in:", sig3X, sigY + 3.5);

  return doc.output("blob");
}
