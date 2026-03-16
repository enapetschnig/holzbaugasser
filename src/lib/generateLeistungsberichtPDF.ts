import { jsPDF } from "jspdf";

export type LeistungsberichtPDFData = {
  projektName: string;
  projektOrt: string;
  objekt: string;
  datum: string;
  wetter: string;
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
    stunden: { position: number; stunden: number }[];
    summe: number;
  }[];
  gesamtstunden: number;
  geraete: { geraet: string; stunden: number }[];
  materialien: { bezeichnung: string; menge: string }[];
  anmerkungen: string;
  fertiggestellt: boolean;
};

const DARK_GREEN: [number, number, number] = [43, 91, 44];
const BLACK: [number, number, number] = [0, 0, 0];
const GRAY: [number, number, number] = [100, 100, 100];
const LIGHT_GRAY: [number, number, number] = [200, 200, 200];
const RED: [number, number, number] = [200, 0, 0];
const WHITE: [number, number, number] = [255, 255, 255];
const HEADER_BG: [number, number, number] = [230, 240, 230];

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

export async function generateLeistungsberichtPDF(
  data: LeistungsberichtPDFData
): Promise<Blob> {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();   // 297
  const pageH = doc.internal.pageSize.getHeight();   // 210

  const sidebarW = 12;
  const marginLeft = sidebarW + 8;
  const marginRight = 10;
  const marginTop = 10;
  const contentW = pageW - marginLeft - marginRight;

  // ── Left sidebar ──────────────────────────────────────────────────────
  doc.setFillColor(...DARK_GREEN);
  doc.rect(0, 0, sidebarW, pageH, "F");

  doc.setTextColor(...WHITE);
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");

  // Rotated text along the sidebar (bottom to top)
  const sidebarText = "Holzbau  \u25C7  Tischlerei  \u25C7  Planung  \u25C7  Kulturwerkstatt";
  doc.text(sidebarText, sidebarW / 2 + 1, pageH - 15, { angle: 90 });

  doc.setFontSize(6);
  doc.setFont("helvetica", "normal");
  doc.text("mail: office@holzbau-gasser.at", sidebarW / 2 + 1, pageH - 5, { angle: 90 });

  // ── Logo ──────────────────────────────────────────────────────────────
  let yPos = marginTop;
  const logo = await loadLogoAsBase64();
  if (logo) {
    try {
      doc.addImage(logo, "PNG", marginLeft, yPos, 50, 18);
    } catch {
      // logo load failed, continue without
    }
  }
  yPos += 22;

  // ── Title ─────────────────────────────────────────────────────────────
  doc.setTextColor(...DARK_GREEN);
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text("Leistungsbericht:", marginLeft, yPos);

  doc.setTextColor(...GRAY);
  doc.setFontSize(9);
  doc.setFont("helvetica", "italic");
  doc.text("Der Leistungsbericht ist t\u00e4glich abzugeben!", marginLeft + 52, yPos - 2);
  yPos += 10;

  // ── Bauvorhaben ───────────────────────────────────────────────────────
  doc.setTextColor(...DARK_GREEN);
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("Bauvorhaben:", marginLeft, yPos);
  yPos += 7;

  const labelX = marginLeft + 2;
  const valueX = marginLeft + 22;
  const rightLabelX = marginLeft + contentW * 0.55;
  const rightValueX = marginLeft + contentW * 0.55 + 22;

  doc.setTextColor(...BLACK);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");

  // Name + Datum
  doc.setFont("helvetica", "bold");
  doc.text("Name:", labelX, yPos);
  doc.setFont("helvetica", "normal");
  doc.text(data.projektName, valueX, yPos);

  doc.setFont("helvetica", "bold");
  doc.text("Datum:", rightLabelX, yPos);
  doc.setFont("helvetica", "normal");
  doc.text(formatGermanDate(data.datum), rightValueX, yPos);
  yPos += 6;

  // Ort + Wetter
  doc.setFont("helvetica", "bold");
  doc.text("Ort:", labelX, yPos);
  doc.setFont("helvetica", "normal");
  doc.text(data.projektOrt, valueX, yPos);

  doc.setFont("helvetica", "bold");
  doc.text("Wetter:", rightLabelX, yPos);
  doc.setFont("helvetica", "normal");
  doc.text(data.wetter, rightValueX, yPos);
  yPos += 6;

  // Objekt
  doc.setFont("helvetica", "bold");
  doc.text("Objekt:", labelX, yPos);
  doc.setFont("helvetica", "normal");
  doc.text(data.objekt, valueX, yPos);
  yPos += 10;

  // ── Divider ───────────────────────────────────────────────────────────
  doc.setDrawColor(...DARK_GREEN);
  doc.setLineWidth(0.5);
  doc.line(marginLeft, yPos, marginLeft + contentW, yPos);
  yPos += 6;

  // ── Taetigkeiten header ───────────────────────────────────────────────
  doc.setTextColor(...DARK_GREEN);
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("T\u00e4tigkeiten:", marginLeft, yPos);

  // Regie label on the right
  doc.setFontSize(9);
  doc.text("Regie", marginLeft + contentW - 5, yPos, { align: "right" });
  yPos += 5;

  // Normalarbeitszeit text in RED
  doc.setTextColor(...RED);
  doc.setFontSize(7.5);
  doc.setFont("helvetica", "normal");
  doc.text(
    "Normalarbeitszeit Mo\u2013Do 7\u201316 Uhr = 9 Std. \u2013 1 Std. Pause = 8 Std.   Fr 7\u201315 Uhr = 8 Std. \u2013 1 Std. Pause = 7 Std.",
    marginLeft + 2,
    yPos
  );
  yPos += 7;

  // ── Activity lines ────────────────────────────────────────────────────
  const regieX = marginLeft + contentW - 8;
  doc.setTextColor(...BLACK);
  doc.setFontSize(9);

  // Build the full 8-line activity list
  const maxPositions = 8;
  const activityLines: string[] = [];
  for (let i = 1; i <= maxPositions; i++) {
    const found = data.taetigkeiten.find((t) => t.position === i);
    activityLines.push(found ? found.bezeichnung : "");
  }

  // Line 1: always prefixed with Ruestzeit/Anfahrt info
  const line1Text = activityLines[0]
    ? activityLines[0]
    : `R\u00fcstzeit/Anfahrt, Ankunftszeit Baustelle: ${data.ankunftZeit}`;
  if (!activityLines[0]) {
    activityLines[0] = line1Text;
  }

  for (let i = 0; i < maxPositions; i++) {
    const posNum = i + 1;
    doc.setFont("helvetica", "bold");
    doc.text(`${posNum}.`, marginLeft + 2, yPos);
    doc.setFont("helvetica", "normal");
    doc.text(activityLines[i], marginLeft + 8, yPos);

    // Draw light dotted line
    doc.setDrawColor(...LIGHT_GRAY);
    doc.setLineWidth(0.15);
    doc.line(marginLeft + 8, yPos + 1, regieX - 2, yPos + 1);

    yPos += 5.5;
  }

  // Pause line
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...GRAY);
  doc.text(
    `Pause, Von: ${data.pauseVon}   Bis: ${data.pauseBis}          Abfahrtszeit Baustelle: ${data.abfahrtZeit}`,
    marginLeft + 8,
    yPos
  );
  yPos += 8;

  // ── Mitarbeiter table ─────────────────────────────────────────────────
  doc.setTextColor(...BLACK);

  // Table geometry
  const tableX = marginLeft;
  const tableW = contentW;

  const colF = 6;            // F column
  const colName = 40;        // Name column
  const colSum18 = 14;       // "Sum 1-8" column
  const colActivity = 14;    // each activity hour column
  const colSumme = 22;       // final sum column

  const numActivityCols = maxPositions;
  const usedWidth = colF + colName + colSum18 + numActivityCols * colActivity + colSumme;
  const tableXEnd = tableX + usedWidth;

  const headerH = 12;
  const rowH = 6.5;

  let tY = yPos;

  // ── Table header background ───────────────────────────────────────────
  doc.setFillColor(...HEADER_BG);
  doc.rect(tableX, tY, usedWidth, headerH, "F");

  doc.setDrawColor(80, 80, 80);
  doc.setLineWidth(0.3);

  // Header text
  doc.setFontSize(7);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...DARK_GREEN);

  let hx = tableX;

  // F
  doc.text("F", hx + colF / 2, tY + 4, { align: "center" });
  doc.text("", hx + colF / 2, tY + 8, { align: "center" });
  hx += colF;

  // Mitarbeiter Name
  doc.text("Mitarbeiter", hx + 2, tY + 4);
  doc.text("Name:", hx + 2, tY + 8);
  hx += colName;

  // Sum 1-8
  doc.text("Sum", hx + colSum18 / 2, tY + 4, { align: "center" });
  doc.text("1-8", hx + colSum18 / 2, tY + 8, { align: "center" });
  hx += colSum18;

  // Activity columns header: "Geleist. Arbeitsstd. Nr.:"
  const actColsStartX = hx;
  doc.setFontSize(6.5);
  doc.text("Geleist. Arbeitsstd. Nr.:", actColsStartX + 2, tY + 4);

  for (let i = 0; i < numActivityCols; i++) {
    doc.setFontSize(7);
    doc.text(`${i + 1}`, hx + colActivity / 2, tY + 8, { align: "center" });
    hx += colActivity;
  }

  // Summe
  doc.setFontSize(7);
  doc.text("Summe", hx + 2, tY + 4);
  doc.text("ohne Pause", hx + 1, tY + 8);

  tY += headerH;

  // ── Table rows ────────────────────────────────────────────────────────
  doc.setTextColor(...BLACK);
  doc.setFontSize(8);

  for (let mi = 0; mi < data.mitarbeiter.length; mi++) {
    const m = data.mitarbeiter[mi];

    // Alternate row background
    if (mi % 2 === 0) {
      doc.setFillColor(248, 248, 248);
      doc.rect(tableX, tY, usedWidth, rowH, "F");
    }

    let cx = tableX;

    // F column
    doc.setFont("helvetica", "bold");
    if (m.istFahrer) {
      doc.text("F", cx + colF / 2, tY + rowH * 0.7, { align: "center" });
    }
    cx += colF;

    // Name
    doc.setFont("helvetica", "normal");
    doc.text(m.name, cx + 2, tY + rowH * 0.7);
    cx += colName;

    // Sum 1-8 (same as summe for now)
    doc.setFont("helvetica", "normal");
    const sum18 = formatNumber(m.summe);
    doc.text(sum18, cx + colSum18 - 2, tY + rowH * 0.7, { align: "right" });
    cx += colSum18;

    // Individual activity hours
    for (let i = 1; i <= numActivityCols; i++) {
      const entry = m.stunden.find((s) => s.position === i);
      const val = entry ? formatNumber(entry.stunden) : "";
      doc.text(val, cx + colActivity - 2, tY + rowH * 0.7, { align: "right" });
      cx += colActivity;
    }

    // Summe ohne Pause
    doc.setFont("helvetica", "bold");
    doc.text(formatNumber(m.summe), cx + colSumme - 4, tY + rowH * 0.7, { align: "right" });

    tY += rowH;
  }

  // ── Draw table grid ───────────────────────────────────────────────────
  const tableYStart = yPos;
  const tableYEnd = tY;

  // Outer border (darker)
  doc.setDrawColor(80, 80, 80);
  doc.setLineWidth(0.4);
  doc.rect(tableX, tableYStart, usedWidth, tableYEnd - tableYStart);

  // Header bottom line
  doc.line(tableX, tableYStart + headerH, tableXEnd, tableYStart + headerH);

  // Vertical column lines
  doc.setDrawColor(...LIGHT_GRAY);
  doc.setLineWidth(0.2);

  let vx = tableX + colF;
  doc.setDrawColor(80, 80, 80);
  doc.setLineWidth(0.3);
  doc.line(vx, tableYStart, vx, tableYEnd);   // after F
  vx += colName;
  doc.line(vx, tableYStart, vx, tableYEnd);   // after Name
  vx += colSum18;
  doc.line(vx, tableYStart, vx, tableYEnd);   // after Sum 1-8

  // Activity column separators (lighter)
  doc.setDrawColor(...LIGHT_GRAY);
  doc.setLineWidth(0.15);
  for (let i = 0; i < numActivityCols - 1; i++) {
    vx += colActivity;
    doc.line(vx, tableYStart, vx, tableYEnd);
  }
  vx += colActivity;
  // Summe column separator (darker)
  doc.setDrawColor(80, 80, 80);
  doc.setLineWidth(0.3);
  doc.line(vx, tableYStart, vx, tableYEnd);

  // Horizontal row lines
  doc.setDrawColor(...LIGHT_GRAY);
  doc.setLineWidth(0.15);
  let ry = tableYStart + headerH;
  for (let i = 0; i < data.mitarbeiter.length - 1; i++) {
    ry += rowH;
    doc.line(tableX, ry, tableXEnd, ry);
  }

  tY += 5;

  // ── Gesamtsumme ───────────────────────────────────────────────────────
  doc.setTextColor(...DARK_GREEN);
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text(`Gesamtsumme Arbeitsstunden: ${formatNumber(data.gesamtstunden)}`, marginLeft, tY);
  tY += 8;

  // ── Geräteeinsatz Table ──────────────────────────────────────────────
  doc.setTextColor(...DARK_GREEN);
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("Ger\u00e4teeinsatz:", marginLeft, tY);
  tY += 4;

  doc.setTextColor(...GRAY);
  doc.setFontSize(7.5);
  doc.setFont("helvetica", "normal");
  doc.text("LKW, Kran (in Stunden)", marginLeft, tY);
  tY += 4;

  const geraeteTableX = marginLeft;
  const geraeteColGeraet = 60;
  const geraeteColStunden = 30;
  const geraeteTableW = geraeteColGeraet + geraeteColStunden;
  const geraeteRowH = 6;
  const geraeteHeaderH = 7;

  // Header background
  doc.setFillColor(...HEADER_BG);
  doc.rect(geraeteTableX, tY, geraeteTableW, geraeteHeaderH, "F");

  // Header text
  doc.setTextColor(...DARK_GREEN);
  doc.setFontSize(7.5);
  doc.setFont("helvetica", "bold");
  doc.text("Ger\u00e4t", geraeteTableX + 2, tY + 5);
  doc.text("Stunden", geraeteTableX + geraeteColGeraet + 2, tY + 5);

  // Header border
  doc.setDrawColor(80, 80, 80);
  doc.setLineWidth(0.3);
  doc.rect(geraeteTableX, tY, geraeteTableW, geraeteHeaderH);
  doc.line(geraeteTableX + geraeteColGeraet, tY, geraeteTableX + geraeteColGeraet, tY + geraeteHeaderH);

  tY += geraeteHeaderH;

  // Rows
  const geraeteRows = data.geraete.length > 0 ? data.geraete : [{ geraet: "", stunden: 0 }, { geraet: "", stunden: 0 }];
  const geraeteDataStartY = tY;

  doc.setTextColor(...BLACK);
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");

  for (let i = 0; i < geraeteRows.length; i++) {
    const g = geraeteRows[i];
    if (i % 2 === 0) {
      doc.setFillColor(248, 248, 248);
      doc.rect(geraeteTableX, tY, geraeteTableW, geraeteRowH, "F");
    }
    doc.text(g.geraet, geraeteTableX + 2, tY + geraeteRowH * 0.7);
    const stundenStr = g.stunden > 0 ? formatNumber(g.stunden) : "";
    doc.text(stundenStr, geraeteTableX + geraeteColGeraet + 2, tY + geraeteRowH * 0.7);
    tY += geraeteRowH;
  }

  // Grid lines for geraete rows
  doc.setDrawColor(80, 80, 80);
  doc.setLineWidth(0.3);
  doc.rect(geraeteTableX, geraeteDataStartY, geraeteTableW, tY - geraeteDataStartY);
  doc.line(geraeteTableX + geraeteColGeraet, geraeteDataStartY, geraeteTableX + geraeteColGeraet, tY);

  // Row separators
  doc.setDrawColor(...LIGHT_GRAY);
  doc.setLineWidth(0.15);
  let gry = geraeteDataStartY;
  for (let i = 0; i < geraeteRows.length - 1; i++) {
    gry += geraeteRowH;
    doc.line(geraeteTableX, gry, geraeteTableX + geraeteTableW, gry);
  }

  tY += 6;

  // ── Materialien & Anmerkungen side by side ──────────────────────────
  const matAnmY = tY;
  const halfW = contentW / 2 - 5;

  // -- LEFT: Verbrauchte Materialien --
  doc.setTextColor(...DARK_GREEN);
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("Verbrauchte Materialien f\u00fcr Regiearbeiten:", marginLeft, tY);
  tY += 5;

  const matTableX = marginLeft;
  const matColBez = halfW - 30;
  const matColMenge = 30;
  const matTableW = matColBez + matColMenge;
  const matRowH = 6;
  const matHeaderH = 7;

  // Header
  doc.setFillColor(...HEADER_BG);
  doc.rect(matTableX, tY, matTableW, matHeaderH, "F");
  doc.setTextColor(...DARK_GREEN);
  doc.setFontSize(7.5);
  doc.setFont("helvetica", "bold");
  doc.text("Material", matTableX + 2, tY + 5);
  doc.text("Menge", matTableX + matColBez + 2, tY + 5);

  doc.setDrawColor(80, 80, 80);
  doc.setLineWidth(0.3);
  doc.rect(matTableX, tY, matTableW, matHeaderH);
  doc.line(matTableX + matColBez, tY, matTableX + matColBez, tY + matHeaderH);

  tY += matHeaderH;

  const matRows = data.materialien.length > 0 ? data.materialien : [{ bezeichnung: "", menge: "" }, { bezeichnung: "", menge: "" }];
  const matDataStartY = tY;

  doc.setTextColor(...BLACK);
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");

  for (let i = 0; i < matRows.length; i++) {
    const mat = matRows[i];
    if (i % 2 === 0) {
      doc.setFillColor(248, 248, 248);
      doc.rect(matTableX, tY, matTableW, matRowH, "F");
    }
    doc.text(mat.bezeichnung, matTableX + 2, tY + matRowH * 0.7);
    doc.text(mat.menge, matTableX + matColBez + 2, tY + matRowH * 0.7);
    tY += matRowH;
  }

  // Grid
  doc.setDrawColor(80, 80, 80);
  doc.setLineWidth(0.3);
  doc.rect(matTableX, matDataStartY, matTableW, tY - matDataStartY);
  doc.line(matTableX + matColBez, matDataStartY, matTableX + matColBez, tY);

  doc.setDrawColor(...LIGHT_GRAY);
  doc.setLineWidth(0.15);
  let mry = matDataStartY;
  for (let i = 0; i < matRows.length - 1; i++) {
    mry += matRowH;
    doc.line(matTableX, mry, matTableX + matTableW, mry);
  }

  // -- RIGHT: Anmerkungen --
  const anmX = marginLeft + halfW + 10;
  let anmY = matAnmY;

  doc.setTextColor(...DARK_GREEN);
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("Anmerkungen:", anmX, anmY);
  anmY += 5;

  doc.setTextColor(...BLACK);
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  if (data.anmerkungen) {
    const anmLines = doc.splitTextToSize(data.anmerkungen, halfW - 5);
    doc.text(anmLines, anmX, anmY);
    anmY += anmLines.length * 4;
  }
  anmY += 4;

  // Safety notice
  doc.setTextColor(...GRAY);
  doc.setFontSize(7);
  doc.setFont("helvetica", "italic");
  doc.text("Ma\u00dfnahmen gem\u00e4\u00df \u00a7 14 ASchG & BauV \u00a7 154 sowie", anmX, anmY);
  anmY += 3.5;
  doc.text("Hinweis zur Verwendung von Pers\u00f6nlicher", anmX, anmY);
  anmY += 3.5;
  doc.text("Schutzausr\u00fcstung zur Kenntnis genommen!", anmX, anmY);

  // Move tY past whichever side is taller
  tY = Math.max(tY, anmY) + 6;

  // ── Bauvorhaben fertiggestellt ──────────────────────────────────────
  doc.setTextColor(...BLACK);
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.text(
    `Bauvorhaben fertiggestellt (ja/nein): ${data.fertiggestellt ? "Ja" : "Nein"}`,
    marginLeft,
    tY
  );
  tY += 10;

  // ── Signature Lines ─────────────────────────────────────────────────
  const sigY = Math.max(tY, pageH - 28);
  const sigLineW = 60;
  const sigGap = (contentW - 3 * sigLineW) / 2;

  const sig1X = marginLeft;
  const sig2X = marginLeft + sigLineW + sigGap;
  const sig3X = marginLeft + 2 * (sigLineW + sigGap);

  doc.setDrawColor(80, 80, 80);
  doc.setLineWidth(0.3);

  // Signature lines
  doc.line(sig1X, sigY, sig1X + sigLineW, sigY);
  doc.line(sig2X, sigY, sig2X + sigLineW, sigY);
  doc.line(sig3X, sigY, sig3X + sigLineW, sigY);

  // Labels below lines
  doc.setTextColor(...BLACK);
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.text("Partief\u00fchrer:", sig1X, sigY + 4);
  doc.text("Kontrolliert:", sig2X, sigY + 4);
  doc.text("Auftraggeber:in:", sig3X, sigY + 4);

  // ── Footer ────────────────────────────────────────────────────────────
  const footerY = pageH - 8;
  doc.setDrawColor(...DARK_GREEN);
  doc.setLineWidth(0.3);
  doc.line(marginLeft, footerY - 3, marginLeft + contentW, footerY - 3);

  doc.setTextColor(...GRAY);
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.text("Holzbau Gasser  |  office@holzbau-gasser.at", marginLeft, footerY);
  doc.text(
    `Erstellt am: ${new Date().toLocaleDateString("de-AT")}`,
    marginLeft + contentW,
    footerY,
    { align: "right" }
  );

  return doc.output("blob");
}
