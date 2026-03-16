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

/**
 * Get target hours for a specific date (Mo-Do: 8h, Fr: 7h, Sa-So: 0h)
 */
export function getTargetHoursForDate(date: Date): number {
  const day = date.getDay(); // 0=Sun, 1=Mon...6=Sat
  if (day === 0 || day === 6) return 0; // Weekend
  if (day === 5) return 7; // Friday
  return 8; // Mon-Thu
}

/**
 * Calculate total target hours for a month
 */
export function getMonthlyTargetHours(year: number, month: number): number {
  const daysInMonth = new Date(year, month, 0).getDate();
  let total = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    total += getTargetHoursForDate(new Date(year, month - 1, d));
  }
  return total;
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
