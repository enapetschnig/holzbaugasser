import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";

interface ExportOptions {
  userId: string;
  userName: string;
  year: number;
  month: number;
  weeklyHours?: number | null;
}

const MONTH_NAMES = [
  "Jän", "Feb", "Mär", "Apr", "Mai", "Jun",
  "Jul", "Aug", "Sep", "Okt", "Nov", "Dez",
];

function getMonthLabel(year: number, month: number): string {
  return `${MONTH_NAMES[month - 1]}-${String(year).slice(2)}`;
}

function getDailyTarget(dow: number, weeklyHours: number | null): number {
  if (dow === 0 || dow === 6) return 0; // Weekend
  const base = weeklyHours != null ? weeklyHours : 39;
  return dow === 5 ? Math.round((base / 39) * 7 * 100) / 100 : Math.round((base / 39) * 8 * 100) / 100;
}

function timeFromHours(startHour: number, hours: number): string {
  const totalMinutes = startHour * 60 + hours * 60;
  const h = Math.floor(totalMinutes / 60);
  const m = Math.round(totalMinutes % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export async function generateArbeitszeitExcel(options: ExportOptions) {
  const { userId, userName, year, month, weeklyHours } = options;
  const daysInMonth = new Date(year, month, 0).getDate();

  // Fetch time entries for this user & month
  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const monthEnd = `${year}-${String(month).padStart(2, "0")}-${daysInMonth}`;

  const { data: entries } = await supabase
    .from("time_entries")
    .select("*")
    .eq("user_id", userId)
    .gte("datum", monthStart)
    .lte("datum", monthEnd)
    .order("datum");

  // Fetch project names from leistungsberichte
  const { data: berichtMitarbeiter } = await supabase
    .from("leistungsbericht_mitarbeiter" as any)
    .select("bericht_id, mitarbeiter_id")
    .eq("mitarbeiter_id", userId);

  const berichtIds = (berichtMitarbeiter || []).map((bm: any) => bm.bericht_id);
  let projektMap: Record<string, string> = {}; // datum -> projekt name
  let pauseMap: Record<string, { von: string; bis: string }> = {}; // datum -> pause times

  if (berichtIds.length > 0) {
    const { data: berichte } = await supabase
      .from("leistungsberichte" as any)
      .select("id, datum, projekt_id, pause_von, pause_bis")
      .in("id", berichtIds)
      .gte("datum", monthStart)
      .lte("datum", monthEnd);

    if (berichte) {
      const projektIds = [...new Set((berichte as any[]).map((b: any) => b.projekt_id).filter(Boolean))];
      if (projektIds.length > 0) {
        const { data: projekte } = await supabase
          .from("projects")
          .select("id, name")
          .in("id", projektIds);
        const projNameMap: Record<string, string> = {};
        (projekte || []).forEach((p: any) => { projNameMap[p.id] = p.name; });
        (berichte as any[]).forEach((b: any) => {
          if (b.projekt_id && projNameMap[b.projekt_id]) {
            projektMap[b.datum] = projNameMap[b.projekt_id];
          }
          if (b.pause_von && b.pause_bis) {
            pauseMap[b.datum] = { von: b.pause_von.slice(0, 5), bis: b.pause_bis.slice(0, 5) };
          }
        });
      }
    }
  }

  // Build entry map by date
  const entryMap: Record<string, any> = {};
  (entries || []).forEach((e: any) => { entryMap[e.datum] = e; });

  // Build rows
  const rows: any[][] = [];

  // Header
  rows.push(["Holzbau Gasser GmbH", "", "", "", "", "", "", ""]);
  rows.push(["Edling 25, 9072 Ludmannsdorf", "", "", "", "", "", "", ""]);
  rows.push(["Tel: +43 4228 2219-0", "", "", "", "", "", "", ""]);
  rows.push(["", "", "", "", "", "", "", ""]);
  rows.push(["Dienstnehmer:", "", userName, "", "", "", "", `Monat: ${getMonthLabel(year, month)}`]);
  rows.push(["", "", "", "", "", "", "", ""]);
  rows.push(["Datum", "V o r m i t t a g", "", "Unterbrechung", "N a c h m i t t a g", "", "Stunden", "Projekt"]);
  rows.push(["", "Beginn", "Ende", "von - bis", "Beginn", "Ende", "Gesamt", ""]);
  rows.push(["", "", "", "", "", "", "", ""]);

  // Track summaries
  let sumArbeit = 0;
  let sumUrlaub = 0;
  let sumKrankenstand = 0;
  let sumWeiterbildung = 0;
  let sumZA = 0;
  let sumSchule = 0;
  let sumGesamt = 0;

  // Previous month last day (for display like original)
  const prevMonthLastDay = new Date(year, month - 1, 0).getDate();
  rows.push([prevMonthLastDay, "", "", "", "", "", "", ""]);

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const dow = new Date(year, month - 1, day).getDay();
    const isWeekend = dow === 0 || dow === 6;
    const isFriday = dow === 5;
    const dailyTarget = getDailyTarget(dow, weeklyHours);
    const entry = entryMap[dateStr];

    if (isWeekend) {
      rows.push([day, "", "", "", "", "", "", ""]);
      continue;
    }

    if (!entry) {
      // No entry for this workday
      rows.push([day, "", "", "", "", "", "", ""]);
      continue;
    }

    const taetigkeit = (entry.taetigkeit || "").toLowerCase();
    const isUrlaub = taetigkeit.includes("urlaub");
    const isKrank = taetigkeit.includes("krank");
    const isSchule = taetigkeit.includes("schule") || taetigkeit.includes("berufsschule");
    const isFortbildung = taetigkeit.includes("fortbildung") || taetigkeit.includes("weiterbildung");
    const isZA = taetigkeit.includes("zeitausgleich") || taetigkeit.includes("za ");
    const isFeiertag = taetigkeit.includes("feiertag");
    const isAbsence = isUrlaub || isKrank || isSchule || isFortbildung || isZA || isFeiertag;

    // Cap hours at daily target (ohne Überstunden)
    const rawHours = parseFloat(entry.stunden) || 0;
    const hours = isAbsence ? dailyTarget : Math.min(rawHours, dailyTarget);

    // Determine display
    let label = "";
    if (isUrlaub) { label = "Urlaub"; sumUrlaub += hours; }
    else if (isKrank) { label = "Krankenstand"; sumKrankenstand += hours; }
    else if (isSchule) { label = "Berufsschule"; sumWeiterbildung += hours; }
    else if (isFortbildung) { label = "Fortbildung"; sumWeiterbildung += hours; }
    else if (isZA) { label = "Zeitausgleich"; sumZA += hours; }
    else if (isFeiertag) { label = "Feiertag"; sumArbeit += hours; }
    else { label = ""; sumArbeit += hours; }

    sumGesamt += hours;

    // Fixed times based on hours worked
    let vormittagBeginn = "";
    let vormittagEnde = "";
    let pause = "";
    let nachmittagBeginn = "";
    let nachmittagEnde = "";

    if (hours > 0) {
      // Use pause from Leistungsbericht if available, else default 12:00-12:30
      const berichtPause = pauseMap[dateStr];
      const pVon = berichtPause?.von || "12:00";
      const pBis = berichtPause?.bis || "12:30";
      const pVonH = parseInt(pVon.split(":")[0]) + parseInt(pVon.split(":")[1]) / 60;
      const pBisH = parseInt(pBis.split(":")[0]) + parseInt(pBis.split(":")[1]) / 60;
      const pauseDuration = pBisH - pVonH;
      const morningHours = pVonH - 7; // From 07:00 to pause start

      vormittagBeginn = "07:00";
      if (hours <= morningHours) {
        // Only morning, no pause needed
        vormittagEnde = timeFromHours(7, hours);
        pause = "";
        nachmittagBeginn = "";
        nachmittagEnde = vormittagEnde;
      } else {
        // Morning + pause + afternoon
        vormittagEnde = pVon;
        pause = `${pVon} - ${pBis}`;
        nachmittagBeginn = pBis;
        const afternoonHours = hours - morningHours;
        nachmittagEnde = timeFromHours(pBisH, afternoonHours);
      }
    }

    const projekt = isAbsence ? label : (projektMap[dateStr] || "Baustelle");

    rows.push([
      day,
      vormittagBeginn,
      vormittagEnde,
      pause,
      nachmittagBeginn,
      nachmittagEnde,
      hours > 0 ? hours : "",
      projekt,
    ]);
  }

  // Footer - nur Gesamtsumme
  rows.push(["", "", "", "", "", "", "", ""]);
  rows.push(["", "", "", "", "", "Gesamtsumme", sumGesamt, ""]);
  rows.push(["", "", "", "", "", "", "", ""]);
  rows.push(["", "", "", "", "", "", "", ""]);
  rows.push(["", "Datum:", "", "", "", "Unterschrift:", "", ""]);

  // Create workbook
  const ws = XLSX.utils.aoa_to_sheet(rows);

  // Column widths
  ws["!cols"] = [
    { wch: 8 },   // A: Datum
    { wch: 10 },  // B: Beginn
    { wch: 10 },  // C: Ende
    { wch: 16 },  // D: Unterbrechung
    { wch: 10 },  // E: Beginn
    { wch: 14 },  // F: Ende / Summen-Label
    { wch: 10 },  // G: Stunden
    { wch: 25 },  // H: Projekt
  ];

  // Merges (like the original)
  ws["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 5 } }, // Company name
    { s: { r: 1, c: 0 }, e: { r: 1, c: 5 } }, // Address
    { s: { r: 2, c: 0 }, e: { r: 2, c: 5 } }, // Phone
    { s: { r: 4, c: 0 }, e: { r: 4, c: 1 } }, // Dienstnehmer label
    { s: { r: 4, c: 2 }, e: { r: 4, c: 5 } }, // Employee name
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Arbeitszeit");

  // Generate filename
  const monthLabel = MONTH_NAMES[month - 1];
  const safeName = userName.replace(/[^a-zA-Z0-9äöüÄÖÜß_-]/g, "_");
  const filename = `Arbeitszeiterfassung_${safeName}_${monthLabel}_${year}.xlsx`;

  XLSX.writeFile(wb, filename);
}
