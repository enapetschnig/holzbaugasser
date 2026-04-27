export interface WorkTimePreset {
  startTime: string;
  endTime: string;
  pauseStart: string;
  pauseEnd: string;
  pauseMinutes: number;
  totalHours: number;
}

/**
 * Gibt die Normalarbeitszeit für einen Tag zurück
 * Mo-Fr: 8h, Sa-So: 0h
 */
export function getNormalWorkingHours(date: Date): number {
  const dayOfWeek = date.getDay();

  // Wochenende
  if (dayOfWeek === 0 || dayOfWeek === 6) return 0;

  // Montag - Freitag: 8 Stunden
  return 8;
}

/**
 * Gibt die Freitags-Überstunde zurück (nicht mehr relevant, bleibt für Kompatibilität)
 */
export function getFridayOvertime(_date: Date): number {
  return 0;
}

/**
 * Gibt die tatsächlichen Arbeitsstunden für einen Wochentag zurück
 * Mo-Fr: 8h, Sa-So: 0h
 */
export function getTotalWorkingHours(date: Date): number {
  return getNormalWorkingHours(date);
}

/**
 * Gibt das Wochensoll zurück: 40 Stunden
 */
export function getWeeklyTargetHours(): number {
  return 40;
}

/**
 * Gibt Standard-Arbeitszeiten für einen Tag zurück
 * Mo-Fr: 08:00-17:00, Pause 12:00-13:00, 8h
 */
export function getDefaultWorkTimes(date: Date): WorkTimePreset | null {
  const dayOfWeek = date.getDay();

  // Wochenende
  if (dayOfWeek === 0 || dayOfWeek === 6) return null;

  // Montag - Freitag: 08:00 - 17:00, Pause 12:00 - 13:00
  return {
    startTime: "08:00",
    endTime: "17:00",
    pauseStart: "12:00",
    pauseEnd: "13:00",
    pauseMinutes: 60,
    totalHours: 8,
  };
}

/**
 * Prüft ob ein Tag ein arbeitsfreier Tag ist (nur Wochenende)
 */
export function isNonWorkingDay(date: Date): boolean {
  const dayOfWeek = date.getDay();
  return dayOfWeek === 0 || dayOfWeek === 6;
}

export type Role = "administrator" | "projektleiter" | "vorarbeiter" | "mitarbeiter" | "extern";

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
