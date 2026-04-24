/**
 * Computes synthetic work times for Projektleiter-Tag aus reinen Stunden-Eingaben.
 *
 * Annahmen für Angestellte (PL):
 * - Fixer Start: 07:00
 * - Pause 12:00–13:00 (60 min) automatisch wenn Gesamt-Arbeitszeit > 6h (AZG)
 * - Projekte werden in Reihenfolge aneinandergereiht
 * - Pause wird im Projekt eingetragen, dessen Endzeit ≥ 12:00 ist
 */

export type ProjectLine = {
  projectId: string | null;
  hours: number;
};

export type AssembledRow = {
  projectId: string | null;
  startTime: string;         // "HH:mm"
  endTime: string;           // "HH:mm"
  pauseStart: string | null; // "HH:mm" oder null
  pauseEnd: string | null;   // "HH:mm" oder null
  pauseMinutes: number;      // 0 oder 60
  hours: number;
};

const DAY_START_MIN = 7 * 60;   // 07:00
const PAUSE_START_MIN = 12 * 60; // 12:00
const PAUSE_END_MIN = 13 * 60;   // 13:00
const PAUSE_DURATION = 60;
const PAUSE_THRESHOLD_HOURS = 6; // AZG: ab >6h muss Pause gemacht werden

function minToTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Assembliert aus Stunden-Listen pro Projekt die passenden Start/Ende/Pause-Werte.
 * Gibt leere Liste zurück, wenn Gesamt = 0.
 */
export function assembleDayTimes(lines: ProjectLine[]): AssembledRow[] {
  const filtered = lines.filter((l) => l.hours > 0);
  if (filtered.length === 0) return [];

  const totalHours = filtered.reduce((s, l) => s + l.hours, 0);
  const needsPause = totalHours > PAUSE_THRESHOLD_HOURS;

  const result: AssembledRow[] = [];
  let cursor = DAY_START_MIN;

  for (const line of filtered) {
    const workMin = Math.round(line.hours * 60);
    let startMin = cursor;
    let endMin = startMin + workMin;
    let paStart: string | null = null;
    let paEnd: string | null = null;
    let paMin = 0;

    if (needsPause && startMin < PAUSE_START_MIN && endMin >= PAUSE_START_MIN) {
      // Diese Zeile enthält oder berührt die Pausengrenze
      paStart = "12:00";
      paEnd = "13:00";
      paMin = PAUSE_DURATION;

      if (endMin > PAUSE_START_MIN) {
        // Arbeit kreuzt die Pause → Ende um 1h nach hinten verschieben
        endMin += PAUSE_DURATION;
        cursor = endMin;
      } else {
        // endMin === PAUSE_START_MIN: Arbeit endet exakt am Pausenanfang
        // Nächstes Projekt beginnt nach der Pause
        cursor = PAUSE_END_MIN;
      }
    } else if (needsPause && startMin >= PAUSE_START_MIN && startMin < PAUSE_END_MIN) {
      // Edge-Case: Projekt startet mitten im Pause-Fenster → auf 13:00 verschieben
      startMin = PAUSE_END_MIN;
      endMin = startMin + workMin;
      cursor = endMin;
    } else {
      cursor = endMin;
    }

    result.push({
      projectId: line.projectId,
      startTime: minToTime(startMin),
      endTime: minToTime(endMin),
      pauseStart: paStart,
      pauseEnd: paEnd,
      pauseMinutes: paMin,
      hours: Math.round(line.hours * 100) / 100,
    });
  }

  return result;
}

/**
 * Aggregiert Zeilen mit gleichem Projekt (summiert die Stunden).
 * Null projectId wird als "Büro" behandelt und separat summiert.
 */
export function aggregateByProject(lines: ProjectLine[]): ProjectLine[] {
  const map = new Map<string, number>();
  for (const l of lines) {
    if (l.hours <= 0) continue;
    const key = l.projectId || "__BUERO__";
    map.set(key, (map.get(key) || 0) + l.hours);
  }
  return Array.from(map.entries()).map(([key, hours]) => ({
    projectId: key === "__BUERO__" ? null : key,
    hours: Math.round(hours * 100) / 100,
  }));
}
