import { jsPDF } from "jspdf";

// ---------------------------------------------------------------------------
// Umlaut helper – jsPDF built-in fonts use WinAnsiEncoding.
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StundenauswertungPDFData = {
  monat: string;        // "Feber"
  jahr: number;         // 2026
  sollStunden: number;  // 152
  mitarbeiter: {
    name: string;
    tage: {
      tag: number;          // 1-31
      wochentag: string;    // "Mo", "Di", etc.
      isWeekend: boolean;
      content: string;      // "8", "U", "K", etc.
      badges?: string;      // "F SCH" - small text above hours
    }[];
    summe: number;
    soll: number;
    differenz: number;
    zeitkonto?: number;
  }[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatNum(n: number): string {
  if (n === Math.floor(n)) return n.toString();
  const s = n.toFixed(1);
  return s.endsWith("0") ? n.toString() : s;
}

// ---------------------------------------------------------------------------
// PDF Generator – Rows = Employees, Columns = Days
// ---------------------------------------------------------------------------

export async function generateStundenauswertungPDF(
  data: StundenauswertungPDFData
): Promise<Blob> {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a3" });

  // A3 landscape = 420mm x 297mm
  const pageW = 420;
  const margin = 8;

  const numDays = data.mitarbeiter.length > 0 ? data.mitarbeiter[0].tage.length : 31;
  const numEmployees = data.mitarbeiter.length;

  // Column widths
  const nameColW = 38;        // Employee name column (left)
  const summaryColW = 16;     // Sum, Soll, +/- columns
  const summaryCount = 3;

  // Calculate day column width to fill available space
  const availableW = pageW - margin * 2 - nameColW - summaryColW * summaryCount;
  const dayColW = Math.max(9, Math.min(13, availableW / Math.max(numDays, 1)));

  // Table dimensions
  const tableW = nameColW + dayColW * numDays + summaryColW * summaryCount;
  const startX = margin;

  // Row heights
  const headerRowH = 8;   // Day number header row
  const wdayRowH = 5;     // Weekday abbreviation row
  const empRowH = 9;      // Each employee row (taller for badges)

  const startY = margin + 14; // space for title

  // -------------------------------------------------------------------------
  // Title / Header bar
  // -------------------------------------------------------------------------
  const headerBarH = 12;
  doc.setFillColor(45, 100, 50); // Dark green
  doc.rect(startX, margin, tableW, headerBarH, "F");

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(13);
  doc.setFont("helvetica", "bold");
  doc.text("HOLZBAU GASSER", startX + 4, margin + 8);

  doc.setFontSize(11);
  doc.text(
    pdfText(`MONAT: ${data.monat} ${data.jahr} = ${data.sollStunden} Std.`),
    startX + tableW - 4,
    margin + 8,
    { align: "right" }
  );

  doc.setTextColor(0, 0, 0);

  // -------------------------------------------------------------------------
  // Row 1: Day numbers
  // -------------------------------------------------------------------------
  const row1Y = startY;

  // Name column header (spans both header rows)
  doc.setFillColor(220, 220, 220);
  doc.rect(startX, row1Y, nameColW, headerRowH + wdayRowH, "FD");
  doc.setFontSize(7);
  doc.setFont("helvetica", "bold");
  doc.text("Mitarbeiter", startX + 2, row1Y + (headerRowH + wdayRowH) / 2 + 1);

  // Day columns - numbers
  for (let d = 0; d < numDays; d++) {
    const x = startX + nameColW + d * dayColW;
    const sampleDay = numEmployees > 0 ? data.mitarbeiter[0].tage[d] : null;
    const isWe = sampleDay?.isWeekend ?? false;
    const isSa = sampleDay?.wochentag === "Sa";

    if (isWe) {
      doc.setFillColor(isSa ? 244 : 232, isSa ? 199 : 180, isSa ? 161 : 160);
    } else {
      doc.setFillColor(220, 220, 220);
    }
    doc.rect(x, row1Y, dayColW, headerRowH, "FD");

    doc.setFontSize(6.5);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(0, 0, 0);
    doc.text(`${d + 1}`, x + dayColW / 2, row1Y + headerRowH / 2 + 1, {
      align: "center",
    });
  }

  // Summary column headers
  const summaryLabels = ["Sum", "Soll", "+/-"];
  for (let s = 0; s < summaryCount; s++) {
    const x = startX + nameColW + numDays * dayColW + s * summaryColW;
    doc.setFillColor(200, 200, 200);
    doc.rect(x, row1Y, summaryColW, headerRowH + wdayRowH, "FD");
    doc.setFontSize(7);
    doc.setFont("helvetica", "bold");
    doc.text(
      summaryLabels[s],
      x + summaryColW / 2,
      row1Y + (headerRowH + wdayRowH) / 2 + 1,
      { align: "center" }
    );
  }

  // -------------------------------------------------------------------------
  // Row 2: Weekday abbreviations
  // -------------------------------------------------------------------------
  const row2Y = row1Y + headerRowH;

  for (let d = 0; d < numDays; d++) {
    const x = startX + nameColW + d * dayColW;
    const sampleDay = numEmployees > 0 ? data.mitarbeiter[0].tage[d] : null;
    const isWe = sampleDay?.isWeekend ?? false;
    const isSa = sampleDay?.wochentag === "Sa";
    const wd = sampleDay?.wochentag || "";

    if (isWe) {
      doc.setFillColor(isSa ? 244 : 232, isSa ? 199 : 180, isSa ? 161 : 160);
    } else {
      doc.setFillColor(235, 235, 235);
    }
    doc.rect(x, row2Y, dayColW, wdayRowH, "FD");

    doc.setFontSize(5.5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(80, 80, 80);
    doc.text(wd, x + dayColW / 2, row2Y + wdayRowH / 2 + 1, {
      align: "center",
    });
  }

  doc.setTextColor(0, 0, 0);

  // -------------------------------------------------------------------------
  // Employee rows
  // -------------------------------------------------------------------------
  const bodyStartY = row2Y + wdayRowH;

  for (let e = 0; e < numEmployees; e++) {
    const y = bodyStartY + e * empRowH;
    const emp = data.mitarbeiter[e];

    // Name cell
    doc.setFillColor(e % 2 === 0 ? 255 : 248, e % 2 === 0 ? 255 : 248, e % 2 === 0 ? 255 : 248);
    doc.rect(startX, y, nameColW, empRowH, "FD");
    doc.setFontSize(7);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(0, 0, 0);
    doc.text(pdfText(emp.name), startX + 1.5, y + empRowH / 2 + 1);

    // Day cells
    for (let d = 0; d < numDays; d++) {
      const x = startX + nameColW + d * dayColW;
      const tag = emp.tage[d];
      const isWe = tag?.isWeekend ?? false;
      const isSa = tag?.wochentag === "Sa";

      if (isWe) {
        doc.setFillColor(isSa ? 244 : 232, isSa ? 199 : 180, isSa ? 161 : 160);
      } else {
        doc.setFillColor(e % 2 === 0 ? 255 : 248, e % 2 === 0 ? 255 : 248, e % 2 === 0 ? 255 : 248);
      }
      doc.rect(x, y, dayColW, empRowH, "FD");

      if (tag && tag.content) {
        const content = tag.content;
        if (content === "U") {
          doc.setTextColor(22, 163, 74);
          doc.setFont("helvetica", "bold");
        } else if (content === "K") {
          doc.setTextColor(220, 38, 38);
          doc.setFont("helvetica", "bold");
        } else if (content === "ZA") {
          doc.setTextColor(37, 99, 235);
          doc.setFont("helvetica", "bold");
        } else if (content === "Feiertag") {
          doc.setTextColor(100, 100, 100);
          doc.setFont("helvetica", "bold");
        } else if (content === "Schule") {
          doc.setTextColor(100, 100, 100);
          doc.setFont("helvetica", "normal");
        } else {
          doc.setTextColor(0, 0, 0);
          doc.setFont("helvetica", "normal");
        }

        // Badges (zulagen) small above
        if (tag.badges) {
          doc.setFontSize(4.5);
          doc.setFont("helvetica", "bold");
          doc.setTextColor(100, 100, 100);
          doc.text(pdfText(tag.badges), x + dayColW / 2, y + 3, {
            align: "center",
          });
          // Reset color for hours
          if (content === "U") doc.setTextColor(22, 163, 74);
          else if (content === "K") doc.setTextColor(220, 38, 38);
          else doc.setTextColor(0, 0, 0);
        }

        doc.setFontSize(6.5);
        doc.text(pdfText(content), x + dayColW / 2, y + empRowH / 2 + (tag.badges ? 2 : 1), {
          align: "center",
        });
        doc.setTextColor(0, 0, 0);
      }
    }

    // Summary cells: Σ
    const sumX = startX + nameColW + numDays * dayColW;
    doc.setFillColor(230, 230, 230);
    doc.rect(sumX, y, summaryColW, empRowH, "FD");
    doc.setFontSize(7);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(0, 0, 0);
    doc.text(
      emp.summe > 0 ? formatNum(emp.summe) : "",
      sumX + summaryColW / 2,
      y + empRowH / 2 + 1,
      { align: "center" }
    );

    // Soll
    const sollX = sumX + summaryColW;
    doc.setFillColor(240, 240, 240);
    doc.rect(sollX, y, summaryColW, empRowH, "FD");
    doc.setFont("helvetica", "normal");
    doc.text(
      formatNum(emp.soll),
      sollX + summaryColW / 2,
      y + empRowH / 2 + 1,
      { align: "center" }
    );

    // +/-
    const diffX = sollX + summaryColW;
    doc.setFillColor(240, 240, 240);
    doc.rect(diffX, y, summaryColW, empRowH, "FD");
    const diff = emp.differenz;
    doc.setTextColor(diff >= 0 ? 22 : 220, diff >= 0 ? 163 : 38, diff >= 0 ? 74 : 38);
    doc.setFont("helvetica", "bold");
    const sign = diff >= 0 ? "+" : "";
    doc.text(
      `${sign}${formatNum(diff)}`,
      diffX + summaryColW / 2,
      y + empRowH / 2 + 1,
      { align: "center" }
    );

    doc.setTextColor(0, 0, 0);
  }

  // -------------------------------------------------------------------------
  // Grid lines
  // -------------------------------------------------------------------------
  const tableTop = row1Y;
  const tableBottom = bodyStartY + numEmployees * empRowH;
  const tableRight = startX + tableW;

  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.3);

  // Outer border
  doc.rect(startX, tableTop, tableW, tableBottom - tableTop);

  // Horizontal lines
  // After day numbers
  doc.line(startX + nameColW, row1Y + headerRowH, tableRight, row1Y + headerRowH);
  // After weekdays
  doc.line(startX, bodyStartY, tableRight, bodyStartY);
  // Employee row separators
  for (let e = 1; e < numEmployees; e++) {
    const lineY = bodyStartY + e * empRowH;
    doc.setLineWidth(0.15);
    doc.line(startX, lineY, tableRight, lineY);
  }

  // Vertical lines
  doc.setLineWidth(0.3);
  // After name column
  doc.line(startX + nameColW, tableTop, startX + nameColW, tableBottom);
  // Day column separators
  doc.setLineWidth(0.15);
  for (let d = 1; d < numDays; d++) {
    const x = startX + nameColW + d * dayColW;
    doc.line(x, tableTop, x, tableBottom);
  }
  // Before summary columns
  doc.setLineWidth(0.3);
  for (let s = 0; s <= summaryCount; s++) {
    const x = startX + nameColW + numDays * dayColW + s * summaryColW;
    doc.line(x, tableTop, x, tableBottom);
  }

  // -------------------------------------------------------------------------
  // Footer legend
  // -------------------------------------------------------------------------
  const footerY = tableBottom + 4;
  doc.setFontSize(6);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(100, 100, 100);
  doc.text(
    pdfText("F = Fahrer  |  W = Werkstatt  |  SCH = Schmutzzulage  |  R = Regen  |  U = Urlaub  |  K = Krankenstand  |  ZA = Zeitausgleich  |  Schule = Berufsschule"),
    startX,
    footerY
  );

  return doc.output("blob") as unknown as Blob;
}
