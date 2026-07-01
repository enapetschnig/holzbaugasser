import { getBuroMonatsSoll } from "./buroSchedules";

export type Role = "administrator" | "projektleiter" | "vorarbeiter" | "mitarbeiter" | "extern";

/**
 * Die tatsächlichen Chefs (kein Gleitzeitkonto, nicht in der Stundenauswertung).
 * WICHTIG: NICHT über die Rolle "administrator"/"projektleiter" ausschließen — die
 * ist bei mehreren echten Mitarbeitern gesetzt (Büro-Kräfte, Vorarbeiter mit
 * App-Zugang). Nur diese konkreten Personen sind die Chefs.
 * Napetschnig (Haupt- + Dubletten-Konto) + Gasser.
 */
export const OWNER_USER_IDS = new Set<string>([
  "79995a5d-f308-4e67-8c00-965a597b60a6", // Napetschnig Christoph (Admin)
  "c5baca0d-f7ff-4963-a93c-740255921241", // Napetschnig Christoph (Dublette)
  "9167d2b7-a6cb-4ea5-a420-a731272d8870", // Gasser F
]);

/**
 * Returns the local date as "YYYY-MM-DD" string (no timezone conversion).
 * Avoid using toISOString() for dates — it converts to UTC and shifts midnight.
 */
export function localDateString(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Tages-Soll abhängig von Rolle.
 * - Projektleiter: 40h/Woche (Mo-Fr je 8h)
 * - Mitarbeiter/Vorarbeiter: 39h/Woche (Mo-Do 8h, Fr 7h)
 */
export function getTagesSoll(role: Role, dow: number): number {
  if (dow === 0 || dow === 6) return 0; // Wochenende
  if (role === "projektleiter" || role === "administrator") return 8;
  return dow === 5 ? 7 : 8;
}

/**
 * Get target hours for a specific date (Mo-Do: 8h, Fr: 7h, Sa-So: 0h) — for Mitarbeiter/Vorarbeiter
 * @deprecated Use getTagesSoll(role, dow) instead
 */
export function getTargetHoursForDate(date: Date): number {
  return getTagesSoll("mitarbeiter", date.getDay());
}

/**
 * Calculate total target hours for a month (Mitarbeiter default)
 */
export function getMonthlyTargetHours(year: number, month: number, role: Role = "mitarbeiter"): number {
  const daysInMonth = new Date(year, month, 0).getDate();
  let total = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    total += getTagesSoll(role, new Date(year, month - 1, d).getDay());
  }
  return total;
}

/**
 * Wochen-Soll je nach Rolle
 */
export function getWeeklyTargetHoursByRole(role: Role): number {
  return role === "projektleiter" || role === "administrator" ? 40 : 39;
}

/**
 * Count working days in a month
 */
export function getWorkingDaysInMonth(year: number, month: number): number {
  const daysInMonth = new Date(year, month, 0).getDate();
  let count = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const day = new Date(year, month - 1, d).getDay();
    if (day !== 0 && day !== 6) count++;
  }
  return count;
}

/**
 * Monats-Soll für einen Mitarbeiter (geteilt von Stundenauswertung UND Zeitkonto,
 * damit beide byte-gleich rechnen):
 *  - fester Büro-Wochenplan (Barbara/Isabel) → exakt aus dem Schedule summiert,
 *  - sonst Standard-Monat (39h-Muster: Mo–Do 8h, Fr 7h) skaliert mit weekly/39,
 *  - weeklyHours == null → Standard-Monat unskaliert.
 */
export function weeklyToMonthlyTarget(
  userId: string,
  weeklyHours: number | null,
  year: number,
  month: number
): number {
  const buroSoll = getBuroMonatsSoll(userId, year, month);
  if (buroSoll != null) return buroSoll;
  const standardMonthly = getMonthlyTargetHours(year, month);
  if (weeklyHours == null) return standardMonthly;
  return Math.round((weeklyHours / 39) * standardMonthly * 10) / 10;
}
