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
  // Auf 1 Nachkommastelle runden — entfernt Floating-Point-Artefakte
  // (z.B. 8.000000000000001 → "8").
  const rounded = Math.round(n * 10) / 10;
  if (rounded === Math.floor(rounded)) return rounded.toFixed(0);
  return rounded.toFixed(1).replace(".", ",");
}

// ---------------------------------------------------------------------------
// PDF Generator – Rows = Employees, Columns = Days.
// Passt sich der Mitarbeiter-Anzahl an: Zeilenhöhe wird bei Bedarf leicht
// verkleinert, und wenn es trotzdem nicht auf eine A3-Seite passt, wird auf
// mehrere Seiten umgebrochen — es wird NIE etwas unten abgeschnitten.
// ---------------------------------------------------------------------------

export async function generateStundenauswertungPDF(
  data: StundenauswertungPDFData
): Promise<Blob> {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a3" });

  // A3 landscape = 420mm x 297mm
  const pageW = 420;
  const pageH = 297;
  const margin = 8;

  const numDays = data.mitarbeiter.length > 0 ? data.mitarbeiter[0].tage.length : 31;

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

  // Row heights / vertical budget
  const headerRowH = 8;   // Day number header row
  const wdayRowH = 5;     // Weekday abbreviation row
  const startY = margin + 14; // space for title bar
  const bodyStartY = startY + headerRowH + wdayRowH;
  const footerH = 6;      // legend under the table
  const availBodyH = pageH - margin - footerH - bodyStartY;

  const REGULAR_ROW_H = 9; // wie bisher
  const MIN_ROW_H = 7;     // kleinste noch gut lesbare Zeile (Badges + Stunden)

  // Zeilenhöhe/Seitenaufteilung bestimmen:
  //  - passt alles mit 9mm auf eine Seite → wie bisher,
  //  - sonst Zeilen bis minimal 7mm stauchen (eine Seite),
  //  - sonst auf mehrere Seiten umbrechen (9mm-Zeilen).
  const n = data.mitarbeiter.length;
  let empRowH = REGULAR_ROW_H;
  let pages: (typeof data.mitarbeiter)[] = [data.mitarbeiter];
  if (n > 0) {
    if (n * REGULAR_ROW_H <= availBodyH) {
      empRowH = REGULAR_ROW_H;
    } else if (n * MIN_ROW_H <= availBodyH) {
      empRowH = Math.floor((availBodyH / n) * 10) / 10;
    } else {
      empRowH = REGULAR_ROW_H;
      const perPage = Math.max(1, Math.floor(availBodyH / REGULAR_ROW_H));
      pages = [];
      for (let i = 0; i < n; i += perPage) {
        pages.push(data.mitarbeiter.slice(i, i + perPage));
      }
    }
  }

  // Namen in die Namensspalte einpassen: erst Schrift verkleinern, dann kürzen.
  const fitName = (name: string): { text: string; fontSize: number } => {
    const maxW = nameColW - 3;
    const encoded = pdfText(name);
    for (const size of [7, 6.5, 6]) {
      doc.setFontSize(size);
      doc.setFont("helvetica", "bold");
      if (doc.getTextWidth(encoded) <= maxW) return { text: encoded, fontSize: size };
    }
    // Immer noch zu lang → mit "…" kürzen (bei 6pt)
    doc.setFontSize(6);
    let t = encoded;
    while (t.length > 1 && doc.getTextWidth(t + "\x85") > maxW) t = t.slice(0, -1);
    return { text: t + "\x85", fontSize: 6 };
  };

  for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
    if (pageIdx > 0) doc.addPage("a3", "landscape");
    const employees = pages[pageIdx];
    const numEmployees = employees.length;
    const sampleTage = data.mitarbeiter[0]?.tage || [];

    // -----------------------------------------------------------------------
    // Title / Header bar
    // -----------------------------------------------------------------------
    const headerBarH = 12;
    doc.setFillColor(45, 100, 50); // Dark green
    doc.rect(startX, margin, tableW, headerBarH, "F");

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(13);
    doc.setFont("helvetica", "bold");
    doc.text("HOLZBAU GASSER", startX + 4, margin + 8);

    doc.setFontSize(11);
    doc.text(
      pdfText(`MONAT: ${data.monat} ${data.jahr} = ${data.sollStunden} Std.${pages.length > 1 ? `  (Seite ${pageIdx + 1}/${pages.length})` : ""}`),
      startX + tableW - 4,
      margin + 8,
      { align: "right" }
    );

    doc.setTextColor(0, 0, 0);

    // -----------------------------------------------------------------------
    // Row 1: Day numbers
    // -----------------------------------------------------------------------
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
      const sampleDay = sampleTage[d] || null;
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

    // -----------------------------------------------------------------------
    // Row 2: Weekday abbreviations
    // -----------------------------------------------------------------------
    const row2Y = row1Y + headerRowH;

    for (let d = 0; d < numDays; d++) {
      const x = startX + nameColW + d * dayColW;
      const sampleDay = sampleTage[d] || null;
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

    // -----------------------------------------------------------------------
    // Employee rows
    // -----------------------------------------------------------------------
    for (let e = 0; e < numEmployees; e++) {
      const y = bodyStartY + e * empRowH;
      const emp = employees[e];

      // Name cell
      doc.setFillColor(e % 2 === 0 ? 255 : 248, e % 2 === 0 ? 255 : 248, e % 2 === 0 ? 255 : 248);
      doc.rect(startX, y, nameColW, empRowH, "FD");
      const fitted = fitName(emp.name);
      doc.setFontSize(fitted.fontSize);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(0, 0, 0);
      doc.text(fitted.text, startX + 1.5, y + empRowH / 2 + 1);

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
          } else if (content === "A") {
            // Arzt — pink
            doc.setTextColor(219, 39, 119);
            doc.setFont("helvetica", "bold");
          } else if (content === "ZA") {
            doc.setTextColor(37, 99, 235);
            doc.setFont("helvetica", "bold");
          } else if (content === "FB") {
            // Fortbildung — blau
            doc.setTextColor(37, 99, 235);
            doc.setFont("helvetica", "normal");
          } else if (content === "Feiertag") {
            doc.setTextColor(234, 88, 12);
            doc.setFont("helvetica", "bold");
          } else if (content === "Schule") {
            doc.setTextColor(8, 145, 178);
            doc.setFont("helvetica", "normal");
          } else {
            doc.setTextColor(0, 0, 0);
            doc.setFont("helvetica", "normal");
          }

          // Badges (zulagen) small above
          if (tag.badges) {
            doc.setFontSize(5);
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

    // -----------------------------------------------------------------------
    // Grid lines
    // -----------------------------------------------------------------------
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

    // -----------------------------------------------------------------------
    // Footer legend
    // -----------------------------------------------------------------------
    const footerY = tableBottom + 4;
    doc.setFontSize(6);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100, 100, 100);
    doc.text(
      pdfText("F = Fahrer  |  W = Werkstatt  |  SCH = Schmutzzulage  |  R = Regen  |  U = Urlaub  |  K = Krankenstand  |  A = Arzt  |  ZA = Zeitausgleich  |  FB = Fortbildung  |  Schule = Berufsschule"),
      startX,
      footerY
    );
    doc.setTextColor(0, 0, 0);
  }

  return doc.output("blob") as unknown as Blob;
}
