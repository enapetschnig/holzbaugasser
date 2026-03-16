import { jsPDF } from "jspdf";

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
      content: string;      // "8", "8F", "8SCH", "U", "K", etc.
    }[];
    summe: number;
    soll: number;
    differenz: number;
  }[];
};

// ---------------------------------------------------------------------------
// PDF Generator
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
  const numEmployees = data.mitarbeiter.length;

  // Column widths
  const dayLabelColW = 12;   // "1 Mo" column
  const summaryColW = 16;    // Summe / Soll / +/- columns
  const summaryCount = 3;    // 3 summary columns

  // Calculate employee column width to fill available space
  const availableW =
    pageW - margin * 2 - dayLabelColW - summaryColW * summaryCount;
  const empColW = Math.max(
    14,
    Math.min(28, availableW / Math.max(numEmployees, 1))
  );

  // Table dimensions
  const tableW =
    dayLabelColW + empColW * numEmployees + summaryColW * summaryCount;
  const startX = margin;

  // Row heights
  const headerH = 10;   // Employee name header
  const dayRowH = 7;    // Each day row
  const summaryRowH = 7; // Bottom summary rows

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
    `MONAT: ${data.monat} ${data.jahr} = ${data.sollStunden} Std.`,
    startX + tableW - 4,
    margin + 8,
    { align: "right" }
  );

  doc.setTextColor(0, 0, 0);

  // -------------------------------------------------------------------------
  // Column header row (employee names)
  // -------------------------------------------------------------------------
  const colHeaderY = startY;

  // Day label header
  doc.setFillColor(220, 220, 220);
  doc.rect(startX, colHeaderY, dayLabelColW, headerH, "FD");
  doc.setFontSize(7);
  doc.setFont("helvetica", "bold");
  doc.text("Tag", startX + dayLabelColW / 2, colHeaderY + headerH / 2 + 1, {
    align: "center",
  });

  // Employee name headers
  for (let e = 0; e < numEmployees; e++) {
    const x = startX + dayLabelColW + e * empColW;
    doc.setFillColor(220, 220, 220);
    doc.rect(x, colHeaderY, empColW, headerH, "FD");

    const name = data.mitarbeiter[e].name;
    doc.setFontSize(6);
    doc.setFont("helvetica", "bold");

    // Split name into lines if too long
    const maxCharsPerLine = Math.floor(empColW / 1.8);
    if (name.length > maxCharsPerLine) {
      const parts = name.split(" ");
      const line1 = parts[0] || "";
      const line2 = parts.slice(1).join(" ");
      doc.text(line1, x + empColW / 2, colHeaderY + 3.5, { align: "center" });
      doc.text(line2, x + empColW / 2, colHeaderY + 7, { align: "center" });
    } else {
      doc.text(name, x + empColW / 2, colHeaderY + headerH / 2 + 1, {
        align: "center",
      });
    }
  }

  // Summary column headers
  const summaryLabels = ["\u03A3", "Soll", "+/-"];
  for (let s = 0; s < summaryCount; s++) {
    const x = startX + dayLabelColW + numEmployees * empColW + s * summaryColW;
    doc.setFillColor(200, 200, 200);
    doc.rect(x, colHeaderY, summaryColW, headerH, "FD");
    doc.setFontSize(7);
    doc.setFont("helvetica", "bold");
    doc.text(
      summaryLabels[s],
      x + summaryColW / 2,
      colHeaderY + headerH / 2 + 1,
      { align: "center" }
    );
  }

  // -------------------------------------------------------------------------
  // Day rows
  // -------------------------------------------------------------------------
  const bodyStartY = colHeaderY + headerH;

  for (let d = 0; d < numDays; d++) {
    const y = bodyStartY + d * dayRowH;
    const sampleDay = data.mitarbeiter.length > 0 ? data.mitarbeiter[0].tage[d] : null;
    const isWe = sampleDay?.isWeekend ?? false;
    const isSa = sampleDay?.wochentag === "Sa";

    // Day label cell
    if (isWe) {
      doc.setFillColor(isSa ? 244 : 232, isSa ? 199 : 180, isSa ? 161 : 160);
    } else {
      doc.setFillColor(255, 255, 255);
    }
    doc.rect(startX, y, dayLabelColW, dayRowH, "FD");

    doc.setFontSize(6.5);
    doc.setFont("helvetica", isWe ? "bold" : "normal");
    doc.setTextColor(0, 0, 0);
    const dayLabel = sampleDay
      ? `${sampleDay.tag} ${sampleDay.wochentag}`
      : `${d + 1}`;
    doc.text(dayLabel, startX + dayLabelColW / 2, y + dayRowH / 2 + 1, {
      align: "center",
    });

    // Employee data cells
    for (let e = 0; e < numEmployees; e++) {
      const x = startX + dayLabelColW + e * empColW;
      const tag = data.mitarbeiter[e].tage[d];
      const cellIsWe = tag?.isWeekend ?? isWe;
      const cellIsSa = tag?.wochentag === "Sa";

      if (cellIsWe) {
        doc.setFillColor(
          cellIsSa ? 244 : 232,
          cellIsSa ? 199 : 180,
          cellIsSa ? 161 : 160
        );
      } else {
        doc.setFillColor(255, 255, 255);
      }
      doc.rect(x, y, empColW, dayRowH, "FD");

      if (tag && tag.content) {
        // Color coding for absence types
        const content = tag.content;
        if (content === "U") {
          doc.setTextColor(22, 163, 74); // green
          doc.setFont("helvetica", "bold");
        } else if (content === "K") {
          doc.setTextColor(220, 38, 38); // red
          doc.setFont("helvetica", "bold");
        } else if (content === "ZA") {
          doc.setTextColor(37, 99, 235); // blue
          doc.setFont("helvetica", "bold");
        } else if (content === "Feiertag") {
          doc.setTextColor(100, 100, 100);
          doc.setFont("helvetica", "bold");
        } else {
          doc.setTextColor(0, 0, 0);
          doc.setFont("helvetica", "normal");
        }

        doc.setFontSize(6);
        doc.text(content, x + empColW / 2, y + dayRowH / 2 + 1, {
          align: "center",
        });
        doc.setTextColor(0, 0, 0);
      }
    }

    // Empty summary cells for day rows (no per-day summary)
    for (let s = 0; s < summaryCount; s++) {
      const x =
        startX + dayLabelColW + numEmployees * empColW + s * summaryColW;
      if (isWe) {
        doc.setFillColor(isSa ? 244 : 232, isSa ? 199 : 180, isSa ? 161 : 160);
      } else {
        doc.setFillColor(245, 245, 245);
      }
      doc.rect(x, y, summaryColW, dayRowH, "FD");
    }
  }

  // -------------------------------------------------------------------------
  // Summary rows at bottom (per employee totals)
  // -------------------------------------------------------------------------
  const summaryY = bodyStartY + numDays * dayRowH;

  // Row: Summe
  {
    const y = summaryY;
    doc.setFillColor(230, 230, 230);
    doc.rect(startX, y, dayLabelColW, summaryRowH, "FD");
    doc.setFontSize(6.5);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(0, 0, 0);
    doc.text("\u03A3", startX + dayLabelColW / 2, y + summaryRowH / 2 + 1, {
      align: "center",
    });

    for (let e = 0; e < numEmployees; e++) {
      const x = startX + dayLabelColW + e * empColW;
      doc.setFillColor(230, 230, 230);
      doc.rect(x, y, empColW, summaryRowH, "FD");
      const val = data.mitarbeiter[e].summe;
      doc.setFontSize(6.5);
      doc.setFont("helvetica", "bold");
      doc.text(
        val > 0 ? formatNum(val) : "",
        x + empColW / 2,
        y + summaryRowH / 2 + 1,
        { align: "center" }
      );
    }

    // Summary columns: total of totals not needed, leave blank or repeat
    for (let s = 0; s < summaryCount; s++) {
      const x =
        startX + dayLabelColW + numEmployees * empColW + s * summaryColW;
      doc.setFillColor(210, 210, 210);
      doc.rect(x, y, summaryColW, summaryRowH, "FD");
    }
  }

  // Row: Soll
  {
    const y = summaryY + summaryRowH;
    doc.setFillColor(240, 240, 240);
    doc.rect(startX, y, dayLabelColW, summaryRowH, "FD");
    doc.setFontSize(6.5);
    doc.setFont("helvetica", "bold");
    doc.text("Soll", startX + dayLabelColW / 2, y + summaryRowH / 2 + 1, {
      align: "center",
    });

    for (let e = 0; e < numEmployees; e++) {
      const x = startX + dayLabelColW + e * empColW;
      doc.setFillColor(240, 240, 240);
      doc.rect(x, y, empColW, summaryRowH, "FD");
      doc.setFontSize(6.5);
      doc.setFont("helvetica", "normal");
      doc.text(
        formatNum(data.mitarbeiter[e].soll),
        x + empColW / 2,
        y + summaryRowH / 2 + 1,
        { align: "center" }
      );
    }

    for (let s = 0; s < summaryCount; s++) {
      const x =
        startX + dayLabelColW + numEmployees * empColW + s * summaryColW;
      doc.setFillColor(210, 210, 210);
      doc.rect(x, y, summaryColW, summaryRowH, "FD");
    }
  }

  // Row: +/-
  {
    const y = summaryY + summaryRowH * 2;
    doc.setFillColor(240, 240, 240);
    doc.rect(startX, y, dayLabelColW, summaryRowH, "FD");
    doc.setFontSize(6.5);
    doc.setFont("helvetica", "bold");
    doc.text("+/-", startX + dayLabelColW / 2, y + summaryRowH / 2 + 1, {
      align: "center",
    });

    for (let e = 0; e < numEmployees; e++) {
      const x = startX + dayLabelColW + e * empColW;
      const diff = data.mitarbeiter[e].differenz;
      doc.setFillColor(240, 240, 240);
      doc.rect(x, y, empColW, summaryRowH, "FD");

      if (diff >= 0) {
        doc.setTextColor(22, 163, 74); // green
      } else {
        doc.setTextColor(220, 38, 38); // red
      }
      doc.setFontSize(6.5);
      doc.setFont("helvetica", "bold");
      const sign = diff >= 0 ? "+" : "";
      doc.text(
        `${sign}${formatNum(diff)}`,
        x + empColW / 2,
        y + summaryRowH / 2 + 1,
        { align: "center" }
      );
      doc.setTextColor(0, 0, 0);
    }

    for (let s = 0; s < summaryCount; s++) {
      const x =
        startX + dayLabelColW + numEmployees * empColW + s * summaryColW;
      doc.setFillColor(210, 210, 210);
      doc.rect(x, y, summaryColW, summaryRowH, "FD");
    }
  }

  // -------------------------------------------------------------------------
  // Footer legend
  // -------------------------------------------------------------------------
  const footerY = summaryY + summaryRowH * 3 + 4;
  doc.setFontSize(6);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(100, 100, 100);
  doc.text(
    "F = Fahrer  |  W = Werkstatt  |  SCH = Schmutzzulage  |  R = Regen  |  U = Urlaub  |  K = Krankenstand  |  ZA = Zeitausgleich  |  Schule = Berufsschule",
    startX,
    footerY
  );

  return doc.output("blob") as unknown as Blob;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatNum(n: number): string {
  if (n === Math.floor(n)) return n.toString();
  const s = n.toFixed(1);
  return s.endsWith("0") ? n.toString() : s;
}
