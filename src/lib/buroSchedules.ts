// Hartcodierte Wochenpläne für die zwei Büro-Mitarbeiterinnen (Barbara, Isabel),
// die ausschließlich im Büro arbeiten und feste Tageszeiten haben. Diese Pläne
// treiben das Monats-Soll (getBuroMonatsSoll), die Feiertag-Stunden
// (feiertagAutoBook) und das Zeitkonto-Verhalten.
//
// SEPARAT davon: EXCEL_SCHEDULES (Krusic, Malle) — reine ANZEIGE-Pläne für den
// Excel-Stundenzettel. Sie ändern bewusst NICHT die Berechnung (Zeitkonto/Grid/
// Feiertag laufen für die beiden weiter gleichmäßig verteilt wie bisher), sondern
// nur, welche Regel-Arbeitszeiten im Excel je Tag angezeigt werden.

export type DaySchedule = {
  start: string;        // "HH:MM"
  pauseVon: string | null;
  pauseBis: string | null;
  end: string;
  stunden: number;      // Netto (ohne Pause)
};

// dow: 0=Sonntag, 1=Mo, …, 5=Fr, 6=Sa
export type WeekSchedule = Record<number, DaySchedule | null>;

const BARBARA_USER_ID = "3ed43f8c-40a7-40df-8b3b-951c74e80af5";
const ISABEL_USER_ID = "367a3fe2-855a-4808-925d-94f913738450";
const KRUSIC_USER_ID = "202cf540-6b55-4b59-8db4-0016c668ac98";
const MALLE_USER_ID = "0334be8e-59c9-45f4-a6d4-840dae511b5f";

export const BURO_SCHEDULES: Record<string, WeekSchedule> = {
  // Barbara Andreycic — 28h/Woche
  [BARBARA_USER_ID]: {
    1: { start: "07:30", pauseVon: "12:00", pauseBis: "13:00", end: "16:00", stunden: 7.5 },
    2: { start: "07:30", pauseVon: null,    pauseBis: null,    end: "12:00", stunden: 4.5 },
    3: { start: "07:30", pauseVon: "12:00", pauseBis: "13:00", end: "16:00", stunden: 7.5 },
    4: { start: "07:30", pauseVon: null,    pauseBis: null,    end: "12:00", stunden: 4.5 },
    5: { start: "08:00", pauseVon: null,    pauseBis: null,    end: "12:00", stunden: 4.0 },
    0: null,
    6: null,
  },
  // Isabel Schritliser — 30h/Woche
  [ISABEL_USER_ID]: {
    1: { start: "07:00", pauseVon: null,    pauseBis: null,    end: "12:00", stunden: 5.0 },
    2: { start: "07:00", pauseVon: "12:00", pauseBis: "13:00", end: "16:00", stunden: 8.0 },
    3: { start: "07:00", pauseVon: null,    pauseBis: null,    end: "12:00", stunden: 5.0 },
    4: { start: "07:30", pauseVon: "12:00", pauseBis: "13:00", end: "16:00", stunden: 7.5 },
    5: { start: "07:30", pauseVon: null,    pauseBis: null,    end: "12:00", stunden: 4.5 },
    0: null,
    6: null,
  },
};

// NUR für die Excel-Anzeige (Regel-Arbeitszeiten der Teilzeit-Feldmitarbeiter).
// Keine Wirkung auf Zeitkonto/Grid/Feiertag — diese rechnen für die beiden weiter
// gleichmäßig verteilt (monatsweise) wie bisher.
export const EXCEL_SCHEDULES: Record<string, WeekSchedule> = {
  // Krusic Johann — 20h/Woche = 4h je Mo–Fr
  [KRUSIC_USER_ID]: {
    1: { start: "07:00", pauseVon: null, pauseBis: null, end: "11:00", stunden: 4 },
    2: { start: "07:00", pauseVon: null, pauseBis: null, end: "11:00", stunden: 4 },
    3: { start: "07:00", pauseVon: null, pauseBis: null, end: "11:00", stunden: 4 },
    4: { start: "07:00", pauseVon: null, pauseBis: null, end: "11:00", stunden: 4 },
    5: { start: "07:00", pauseVon: null, pauseBis: null, end: "11:00", stunden: 4 },
    0: null,
    6: null,
  },
  // Malle Georg — 24h/Woche = je 8h Mo, Do, Fr (Di/Mi frei)
  [MALLE_USER_ID]: {
    1: { start: "07:00", pauseVon: "12:00", pauseBis: "12:30", end: "15:30", stunden: 8 },
    2: null,
    3: null,
    4: { start: "07:00", pauseVon: "12:00", pauseBis: "12:30", end: "15:30", stunden: 8 },
    5: { start: "07:00", pauseVon: "12:00", pauseBis: "12:30", end: "15:30", stunden: 8 },
    0: null,
    6: null,
  },
};

/** Nur für die Excel-Anzeige: hat dieser MA einen fixen Regel-Wochenplan? */
export function hasExcelSchedule(userId: string | null | undefined): boolean {
  if (!userId) return false;
  return userId in EXCEL_SCHEDULES;
}

/** Nur für die Excel-Anzeige: Regel-Tagesplan (oder null an Nicht-Arbeitstagen). */
export function getExcelSchedule(
  userId: string | null | undefined,
  datum: string
): DaySchedule | null {
  if (!userId) return null;
  const week = EXCEL_SCHEDULES[userId];
  if (!week) return null;
  const dow = new Date(datum + "T00:00:00").getDay();
  return week[dow] ?? null;
}

export function hasBuroSchedule(userId: string | null | undefined): boolean {
  if (!userId) return false;
  return userId in BURO_SCHEDULES;
}

export function getBuroSchedule(
  userId: string | null | undefined,
  datum: string
): DaySchedule | null {
  if (!userId) return null;
  const week = BURO_SCHEDULES[userId];
  if (!week) return null;
  const dow = new Date(datum + "T00:00:00").getDay();
  return week[dow] ?? null;
}

export function getBuroWochenstunden(userId: string | null | undefined): number | null {
  if (!userId) return null;
  const week = BURO_SCHEDULES[userId];
  if (!week) return null;
  return Object.values(week).reduce((s, d) => s + (d?.stunden ?? 0), 0);
}

/**
 * Pause-Minuten aus einem Schedule-Tag berechnen.
 */
export function getSchedulePauseMinutes(d: DaySchedule): number {
  if (!d.pauseVon || !d.pauseBis) return 0;
  const [vh, vm] = d.pauseVon.split(":").map(Number);
  const [bh, bm] = d.pauseBis.split(":").map(Number);
  return Math.max(0, (bh * 60 + bm) - (vh * 60 + vm));
}

/**
 * Summiert das Monats-Soll aus dem Wochenplan (für Stundenauswertung).
 * Iteriert über alle Tage des Monats, summiert Tagessoll laut Schedule.
 */
export function getBuroMonatsSoll(userId: string, year: number, month: number): number | null {
  const week = BURO_SCHEDULES[userId];
  if (!week) return null;
  let total = 0;
  // month: 1-12
  const daysInMonth = new Date(year, month, 0).getDate();
  for (let day = 1; day <= daysInMonth; day++) {
    const dow = new Date(year, month - 1, day).getDay();
    total += week[dow]?.stunden ?? 0;
  }
  return Math.round(total * 100) / 100;
}
