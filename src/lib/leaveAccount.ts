// Urlaubskonto-Engine — EINZIGE Gutschrift-/Jahreswechsel-Logik, genutzt von
// der Admin-Urlaubsverwaltung (LeaveManagement) UND der MA-Seite (Absence).
//
// Zwei Modi pro Konto (leave_balances.modus):
//  - 'monatlich' (Arbeiter, Default/Bestand): alle Monatsenden days_per_month
//    Tage gutschreiben — Formeln byte-identisch zum bisherigen
//    checkAndCreditMonthly (Betrag, Folgetermin, Rundung, Log-Format).
//  - 'jaehrlich' (Angestellte): am Stichtag (= next_credit_date) einmal
//    jahres_kontingent Tage gutschreiben, Stichtag +1 Jahr fortschreiben.
//
// Verbesserungen ggü. der alten Logik (verifizierte Bestand-Bugs):
//  - Nachhol-SCHLEIFE: verpasste Termine werden in EINEM Lauf nachgeholt
//    (bisher nur einer pro Seiten-Reload).
//  - cutoff = min(heute, 31.12. des Zeilen-Jahres): Gutschriften mit Termin im
//    Jahr Y landen NUR auf der Y-Zeile → Alt-Jahres-Zeilen sind eingefroren
//    (bisher wurden sie beim Ansehen alter Jahre weiter befüllt).
//  - Optimistic Lock (.eq auf den alten next_credit_date): zwei parallele
//    Clients (Admin-Tab + MA-Tab) können nicht doppelt gutschreiben.
//
// Jahreswechsel (lazy, kein Cron): fehlt die Zeile des aktuellen Jahres,
// wird sie aus der Vorjahres-Zeile erzeugt — Resturlaub wird ÜBERTRAGEN
// (carry = total − gezählte Urlaubs-Tage des Vorjahres), Einstellungen
// (modus/kontingent/Rate/Termin) wandern mit. ROLLOVER_MIN_YEAR schützt das
// Deploy-Jahr: 2026 erzeugt der Auto-Rollover garantiert keine Zeile.

import { supabase } from "@/integrations/supabase/client";
import { getAustrianFeiertage } from "./feiertage";

export type LeaveBalanceRow = {
  id: string;
  user_id: string;
  year: number;
  total_days: number;
  used_days: number;
  days_per_month: number | null;
  next_credit_date: string | null;
  last_credit_date: string | null;
  modus: string | null;             // 'monatlich' | 'jaehrlich' (null = Bestand → monatlich)
  jahres_kontingent: number | null; // nur bei modus='jaehrlich'
};

const ROLLOVER_MIN_YEAR = 2027;

function todayLocalStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDDMMYYYY(dateStr: string): string {
  const [y, m, d] = dateStr.split("-");
  return `${d}.${m}.${y}`;
}

// "YYYY-MM-DD" + 1 Jahr als String-Arithmetik; 29.02. → 28.02. geklemmt
// (new Date(2027,1,29) wäre sonst der 1. März).
function plusOneYearStr(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const ny = y + 1;
  let nd = d;
  if (m === 2 && d === 29) nd = 28;
  return `${ny}-${String(m).padStart(2, "0")}-${String(nd).padStart(2, "0")}`;
}

/** Verbrauchs-Wahrheit: gezählte Urlaub-time_entries des Kalenderjahres
 *  (dieselbe Zahl, die Urlaubsverwaltung und MyHours anzeigen). */
export async function countUsedVacationDays(userId: string, year: number): Promise<number> {
  const { count } = await supabase
    .from("time_entries")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("taetigkeit", "Urlaub")
    .gte("datum", `${year}-01-01`)
    .lte("datum", `${year}-12-31`);
  return count || 0;
}

/** Buchbare Tage eines Zeitraums: Mo–Fr OHNE österreichische Feiertage.
 *  (Ein Feiertag ist kein Urlaubstag — er wird ohnehin automatisch gebucht.) */
export function getBookableDates(start: string, end: string): string[] {
  const startYear = parseInt(start.slice(0, 4), 10);
  const endYear = parseInt(end.slice(0, 4), 10);
  const feiertage = new Set<string>();
  for (let y = startYear; y <= endYear; y++) {
    for (const f of getAustrianFeiertage(y)) feiertage.add(f.datum);
  }
  const dates: string[] = [];
  const d = new Date(start + "T00:00:00");
  const endD = new Date(end + "T00:00:00");
  while (d <= endD) {
    const day = d.getDay();
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (day !== 0 && day !== 6 && !feiertage.has(dateStr)) dates.push(dateStr);
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

/** Alle fälligen Gutschriften einer Konto-Zeile nachholen (Schleife, cutoff
 *  = min(heute, Jahresende der Zeile) → Alt-Jahres-Zeilen bleiben eingefroren). */
export async function applyDueCredits(bal: LeaveBalanceRow): Promise<LeaveBalanceRow> {
  const today = todayLocalStr();
  const currentYear = parseInt(today.slice(0, 4), 10);
  if (bal.year > currentYear) return bal; // Zukunfts-Zeilen nie befüllen

  const cutoff = today < `${bal.year}-12-31` ? today : `${bal.year}-12-31`;
  let guard = 0;

  while (bal.next_credit_date != null && bal.next_credit_date <= cutoff && guard++ < 60) {
    const due = bal.next_credit_date;
    const modus = bal.modus ?? "monatlich";

    let amount: number;
    let newNext: string;
    if (modus === "jaehrlich") {
      amount = bal.jahres_kontingent ?? 0; // 0 → trotzdem fortschreiben (keine Endlos-Fälligkeit)
      newNext = plusOneYearStr(due);
    } else {
      amount = bal.days_per_month ?? 2.08;
      // Byte-identisch zur bisherigen Formel: letzter Tag des Folgemonats.
      const nextD = new Date(due);
      nextD.setMonth(nextD.getMonth() + 2, 0);
      newNext = nextD.toISOString().split("T")[0];
    }

    // Optimistic Lock: nur schreiben, wenn next_credit_date noch der alte ist.
    const { data: updated, error } = await supabase
      .from("leave_balances")
      .update({
        total_days: Math.round(((bal.total_days || 0) + amount) * 100) / 100,
        last_credit_date: due,
        next_credit_date: newNext,
      } as any)
      .eq("id", bal.id)
      .eq("next_credit_date", due)
      .select();
    if (error || !updated || updated.length === 0) {
      // Anderer Client war schneller (oder Fehler) → frischen Stand holen, nicht loggen.
      const { data: fresh } = await supabase.from("leave_balances").select("*").eq("id", bal.id).single();
      return (fresh as any) || bal;
    }

    await supabase.from("leave_log" as any).insert({
      user_id: bal.user_id,
      year: bal.year,
      action: modus === "jaehrlich" ? "jahres_gutschrift" : "gutschrift",
      days: amount,
      description: modus === "jaehrlich"
        ? `Jährliche Gutschrift: +${amount} Tage (Stichtag ${formatDDMMYYYY(due)})`
        : `Monatliche Gutschrift: +${amount} Tage (${formatDDMMYYYY(due)})`,
    });

    bal = updated[0] as any;
  }
  return bal;
}

/** Arbeiter-Konto anlegen (Grundstufe): Start 0 Tage, 2,08/Monat ab jetzt. */
export async function createWorkerAccount(userId: string, year: number): Promise<LeaveBalanceRow | null> {
  const now = new Date();
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const { data, error } = await supabase
    .from("leave_balances")
    .insert({
      user_id: userId,
      year,
      total_days: 0,
      used_days: 0,
      days_per_month: 2.08,
      next_credit_date: endOfMonth.toISOString().split("T")[0],
      modus: "monatlich",
    } as any)
    .select()
    .single();
  if (error) {
    // 23505 = UNIQUE(user_id, year): Race — Zeile existiert schon, laden.
    const { data: existing } = await supabase
      .from("leave_balances").select("*")
      .eq("user_id", userId).eq("year", year).maybeSingle();
    return (existing as any) || null;
  }
  await supabase.from("leave_log" as any).insert({
    user_id: userId,
    year,
    action: "kontingent_angelegt",
    days: 0,
    description: `Urlaubskontingent angelegt (2,08 Tage/Monat)`,
  });
  return data as any;
}

/**
 * Konto-Zeile des Jahres sicherstellen + fällige Gutschriften nachholen.
 *  - Zeile existiert → nur Gutschriften nachholen.
 *  - Zeile fehlt, Vorjahres-Zeile existiert (ab ROLLOVER_MIN_YEAR):
 *    Vorjahr nachziehen (eingefroren via cutoff), Resturlaub übertragen,
 *    neue Zeile mit kopierten Einstellungen, dann Neujahres-Termine nachholen.
 *  - Sonst: autoCreate=true → Arbeiter-Konto anlegen; false → null.
 */
export async function ensureLeaveAccount(
  userId: string,
  year: number,
  opts: { autoCreate: boolean }
): Promise<LeaveBalanceRow | null> {
  const { data: cur } = await supabase
    .from("leave_balances").select("*")
    .eq("user_id", userId).eq("year", year).maybeSingle();
  if (cur) return applyDueCredits(cur as any);

  const { data: prevRaw } = await supabase
    .from("leave_balances").select("*")
    .eq("user_id", userId).eq("year", year - 1).maybeSingle();

  if (prevRaw && year >= ROLLOVER_MIN_YEAR) {
    // Vorjahr fertig gutschreiben (cutoff friert es auf den 31.12. ein).
    const prev = await applyDueCredits(prevRaw as any);
    const usedPrev = await countUsedVacationDays(userId, year - 1);
    const carry = Math.max(0, Math.round(((prev.total_days || 0) - usedPrev) * 100) / 100);

    const { data: inserted, error } = await supabase
      .from("leave_balances")
      .insert({
        user_id: userId,
        year,
        total_days: carry,
        used_days: 0,
        modus: prev.modus ?? "monatlich",
        days_per_month: prev.days_per_month,
        jahres_kontingent: prev.jahres_kontingent,
        next_credit_date: prev.next_credit_date, // zeigt nach dem Catch-up bereits ins neue Jahr
        last_credit_date: prev.last_credit_date,
      } as any)
      .select()
      .single();

    if (error) {
      // Race (Admin ↔ MA gleichzeitig): Zeile existiert inzwischen → laden.
      const { data: existing } = await supabase
        .from("leave_balances").select("*")
        .eq("user_id", userId).eq("year", year).maybeSingle();
      return existing ? applyDueCredits(existing as any) : null;
    }

    await supabase.from("leave_log" as any).insert({
      user_id: userId,
      year,
      action: "uebertrag",
      days: carry,
      description: `Übertrag aus ${year - 1}: ${Math.round((prev.total_days || 0) * 100) / 100} − ${usedPrev} verbraucht = +${carry} Resttage`,
    });

    return applyDueCredits(inserted as any);
  }

  if (!opts.autoCreate) return null;
  return createWorkerAccount(userId, year);
}
