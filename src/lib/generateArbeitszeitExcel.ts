import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { hasExcelSchedule, getExcelSchedule } from "./buroSchedules";

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

  // Fetch project names from leistungsberichte (für LB-Tage: Pause-Zeiten und Projektname)
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

  // Auch direkt aus time_entries.project_id (für Vorfertigung/PL-Tage ohne LB-Eintrag)
  const directProjectIds = [
    ...new Set(
      (entries || [])
        .map((e: any) => e.project_id)
        .filter((id: string | null): id is string => !!id)
    ),
  ];
  if (directProjectIds.length > 0) {
    const { data: projData } = await supabase.from("projects").select("id, name").in("id", directProjectIds);
    const lookupMap: Record<string, string> = {};
    (projData || []).forEach((p: any) => { lookupMap[p.id] = p.name; });
    (entries || []).forEach((e: any) => {
      if (e.project_id && lookupMap[e.project_id] && !projektMap[e.datum]) {
        projektMap[e.datum] = lookupMap[e.project_id];
      }
    });
  }

  // Aggregiere alle Einträge pro Tag (LB + PL + Vorfertigung + Absenz)
  // Bei Multi-Entry-Tagen: Stunden summieren, Absenz hat Vorrang vor Arbeit.
  // WICHTIG: exakte DB-Werte "ZA" und "Sonstiges" matchen — die Keyword-Liste
  // allein ("za " mit Leerzeichen) hat den echten ZA-Wert verfehlt, wodurch
  // ZA-Tage als Arbeit gezählt wurden.
  const ABSENCE_KEYWORDS = ["urlaub", "krank", "arzt", "fortbildung", "weiterbildung", "feiertag", "schule", "berufsschule", "zeitausgleich", "za "];
  const isAbsenceTaetigkeit = (t: string) => {
    const lower = (t || "").toLowerCase().trim();
    if (lower === "za" || lower === "sonstiges") return true;
    return ABSENCE_KEYWORDS.some((kw) => lower.includes(kw));
  };
  const isZATaetigkeit = (t: string) => {
    const lower = (t || "").toLowerCase().trim();
    return lower === "za" || lower.includes("zeitausgleich");
  };

  // ZA wird pro Tag GETRENNT geführt (zaH): ein Tag kann Arbeit + Teil-ZA
  // mischen (z.B. 4h Arbeit + 4h ZA) — die Arbeitsstunden gehören in die
  // Gesamtsumme, die ZA-Stunden nur in die ZA-Summe (sind schon vom
  // Zeitkonto abgezogen, keine neu gearbeitete Zeit).
  const entryMap: Record<string, { stunden: number; taetigkeit: string; project_id: string | null; zaH: number }> = {};
  (entries || []).forEach((e: any) => {
    const stunden = parseFloat(e.stunden) || 0;
    const taetigkeit = e.taetigkeit || "";
    const existing = (entryMap[e.datum] ||= { stunden: 0, taetigkeit: "", project_id: null, zaH: 0 });

    if (isZATaetigkeit(taetigkeit)) {
      existing.zaH += stunden;
      if (!existing.taetigkeit) existing.taetigkeit = "ZA"; // reiner ZA-Tag (bisher)
      return;
    }

    const isAbs = isAbsenceTaetigkeit(taetigkeit);
    const existingIsAbs = existing.taetigkeit !== "" && existing.taetigkeit !== "ZA"
      && isAbsenceTaetigkeit(existing.taetigkeit);

    if (existing.taetigkeit === "" || existing.taetigkeit === "ZA") {
      // Erster Nicht-ZA-Eintrag des Tages (ein reiner ZA-Marker wird ersetzt, zaH bleibt)
      existing.stunden = stunden;
      existing.taetigkeit = taetigkeit;
      existing.project_id = e.project_id || null;
    } else if (isAbs && !existingIsAbs) {
      // Absenz hat Vorrang — überschreibt Arbeit
      existing.stunden = stunden;
      existing.taetigkeit = taetigkeit;
      existing.project_id = e.project_id || null;
    } else if (!isAbs && existingIsAbs) {
      // Existing ist Absenz — neue Arbeit ignorieren
    } else {
      // Beides gleicher Typ → summieren, Tätigkeit/Projekt ggf. behalten
      existing.stunden += stunden;
      if (!existing.project_id && e.project_id) existing.project_id = e.project_id;
    }
  });

  // Interne Korrekturen (Stundenauswertung) überschreiben den jeweiligen Tag —
  // konsistent mit dem Grid. Leistungsbericht/Projektstunden bleiben unberührt.
  const { data: overrides } = await supabase
    .from("stundenauswertung_overrides" as any)
    .select("datum, typ, stunden, absenz_typ")
    .eq("user_id", userId)
    .gte("datum", monthStart)
    .lte("datum", monthEnd);
  (overrides || []).forEach((ov: any) => {
    const isOvZA = ov.typ === "absenz" && isZATaetigkeit(ov.absenz_typ || "");
    entryMap[ov.datum] = isOvZA
      ? { stunden: 0, taetigkeit: "ZA", project_id: null, zaH: parseFloat(ov.stunden) || 0 }
      : {
          stunden: parseFloat(ov.stunden) || 0,
          taetigkeit: ov.typ === "absenz" ? (ov.absenz_typ || "") : "Arbeit",
          project_id: null,
          zaH: 0,
        };
  });

  // Fixer Wochenplan (z.B. Krusic 4h Mo–Fr, Malle 8h Mo/Do/Fr): das Excel zeigt
  // IMMER die Regel-Arbeitszeiten an den Regeltagen — egal an welchen Tagen real
  // gebucht wurde. Absenzen (Urlaub/Krank/Feiertag) überschreiben den Tag.
  // Über-/Minusstunden laufen monatsweise übers Zeitkonto, nicht hier.
  const fixedPlan = hasExcelSchedule(userId);
  if (fixedPlan) {
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const schedHours = getExcelSchedule(userId, dateStr)?.stunden ?? 0;
      if (schedHours <= 0) {
        delete entryMap[dateStr]; // Nicht-Arbeitstag → immer leer (auch Feiertag ausblenden)
        continue;
      }
      const existing = entryMap[dateStr];
      if (existing && isAbsenceTaetigkeit(existing.taetigkeit)) continue; // Absenz am Arbeitstag bleibt
      entryMap[dateStr] = { stunden: schedHours, taetigkeit: "Arbeit", project_id: null, zaH: 0 };
    }
  }

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
    // Bei fixem Wochenplan ist das Tages-Soll = Plan-Stunden dieses Tages
    // (sonst würde die Deckelung z.B. Malles 8h fälschlich auf ~4,9h stutzen).
    const dailyTarget = fixedPlan
      ? (getExcelSchedule(userId, dateStr)?.stunden ?? 0)
      : getDailyTarget(dow, weeklyHours);
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
    const isArzt = taetigkeit === "arzt" || taetigkeit.startsWith("arzt ");
    const isSchule = taetigkeit.includes("schule") || taetigkeit.includes("berufsschule");
    const isFortbildung = taetigkeit.includes("fortbildung") || taetigkeit.includes("weiterbildung");
    const isZA = taetigkeit.includes("zeitausgleich") || taetigkeit.includes("za ") || taetigkeit === "za";
    const isFeiertag = taetigkeit.includes("feiertag");
    const isAbsence = isUrlaub || isKrank || isArzt || isSchule || isFortbildung || isZA || isFeiertag;

    // Cap hours at daily target (ohne Überstunden) — Arzt/ZA können stundenweise sein.
    // Reiner ZA-Tag: die Stunden stehen in zaH (getrennt geführt), nicht in stunden.
    const zaH = entry.zaH || 0;
    const rawHours = isZA ? zaH : (parseFloat(entry.stunden as any) || 0);
    const hoursIfAbsenceFull = isAbsence ? Math.min(rawHours, dailyTarget) : Math.min(rawHours, dailyTarget);
    // Arzt + ZA: User trägt manchmal weniger als Tagessoll ein → respektieren statt aufrunden
    const hours = (isArzt || isZA) ? Math.min(rawHours, dailyTarget) : (isAbsence ? dailyTarget : hoursIfAbsenceFull);

    // Determine display
    let label = "";
    if (isUrlaub) { label = "Urlaub"; sumUrlaub += hours; }
    else if (isKrank) { label = "Krankenstand"; sumKrankenstand += hours; }
    else if (isArzt) { label = "Arzt"; sumKrankenstand += hours; }
    else if (isSchule) { label = "Berufsschule"; sumWeiterbildung += hours; }
    else if (isFortbildung) { label = "Fortbildung"; sumWeiterbildung += hours; }
    else if (isZA) { label = "Zeitausgleich"; sumZA += hours; }
    else if (isFeiertag) { label = "Feiertag"; sumArbeit += hours; }
    else { label = ""; sumArbeit += hours; }

    // ZA (Zeitausgleich) NICHT in die Gesamt-Arbeitsstunden zählen — es sind
    // bereits aufgebaute Überstunden, keine neu gearbeitete Zeit. Der ZA-Tag
    // bleibt in der Tageszeile sichtbar (Projektspalte "Zeitausgleich") und in
    // der separaten sumZA-Zeile.
    if (!isZA) sumGesamt += hours;

    // Misch-Tag (Arbeit + Teil-ZA, z.B. 4h+4h): Arbeitsstunden laufen normal in
    // die Gesamtsumme, der ZA-Anteil zusätzlich in die ZA-Summe.
    const zaExtra = !isZA && zaH > 0 ? zaH : 0;
    if (zaExtra > 0) sumZA += zaExtra;

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

    let projekt: string;
    if (isAbsence) {
      projekt = label;
    } else if (projektMap[dateStr]) {
      projekt = projektMap[dateStr];
    } else if ((entry.taetigkeit || "").startsWith("Werk:")) {
      projekt = entry.taetigkeit.replace(/^Werk:\s*/, "");
    } else if ((entry.taetigkeit || "").startsWith("LKW:")) {
      projekt = entry.taetigkeit.replace(/^LKW:\s*/, "");
    } else if ((entry.taetigkeit || "").startsWith("Werkstätte:")) {
      projekt = entry.taetigkeit.replace(/^Werkstätte:\s*/, "");
    } else if ((entry.taetigkeit || "").startsWith("Vorfertigung:")) {
      // Backward-compat für alte Daten vor dem Rename
      projekt = entry.taetigkeit.replace(/^Vorfertigung:\s*/, "");
    } else if ((entry.taetigkeit || "").startsWith("PL:")) {
      projekt = entry.taetigkeit.replace(/^PL:\s*/, "");
    } else {
      projekt = "Baustelle";
    }

    // Misch-Tag: ZA-Anteil in der Projektspalte sichtbar machen
    if (zaExtra > 0) projekt = `${projekt} + ${zaExtra}h ZA`;

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
