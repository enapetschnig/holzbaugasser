/**
 * Block-Logik für die Vorfertigung-/LKW-Zeiterfassung.
 *
 * User gibt Start- und Endzeit pro Block ein. Wenn ein Block die Mittagspause
 * (12:00–12:30) komplett überspannt, werden 30 min Pause abgezogen.
 */

export type Block = {
  startTime: string; // "HH:mm"
  endTime: string;   // "HH:mm"
  projectId: string | null;
};

export type ComputedBlock = {
  startTime: string;
  endTime: string;
  pauseStart: string | null; // "12:00" wenn Block überspannt Mittagspause
  pauseEnd: string | null;   // "12:30" wenn Block überspannt Mittagspause
  pauseMinutes: number;       // 30 oder 0
  stunden: number;            // Netto-Stunden (gerundet auf 0.25)
  projectId: string | null;
};

const PAUSE_START_MIN = 12 * 60;       // 12:00
const PAUSE_END_MIN = 12 * 60 + 30;    // 12:30
const PAUSE_DURATION = 30;

function timeToMin(t: string): number | null {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
}

/**
 * Berechnet einen einzelnen Block mit Pause-Logik.
 * Pause-Regel: Wenn `start < 12:00` UND `end > 12:30` → 30 min Pause-Abzug.
 * Sonst: keine Pause, stunden = (end − start) / 60.
 */
export function computeBlock(block: Block): ComputedBlock {
  const startMin = timeToMin(block.startTime);
  const endMin = timeToMin(block.endTime);

  if (startMin == null || endMin == null || endMin <= startMin) {
    return {
      startTime: block.startTime,
      endTime: block.endTime,
      pauseStart: null,
      pauseEnd: null,
      pauseMinutes: 0,
      stunden: 0,
      projectId: block.projectId,
    };
  }

  // Pause greift wenn der Block die Mittagspause komplett überspannt
  const overlapsPause = startMin < PAUSE_START_MIN && endMin > PAUSE_END_MIN;

  if (overlapsPause) {
    const grossMin = endMin - startMin;
    const netMin = grossMin - PAUSE_DURATION;
    return {
      startTime: block.startTime,
      endTime: block.endTime,
      pauseStart: "12:00",
      pauseEnd: "12:30",
      pauseMinutes: PAUSE_DURATION,
      stunden: Math.round((netMin / 60) * 4) / 4, // auf 0.25 gerundet
      projectId: block.projectId,
    };
  }

  return {
    startTime: block.startTime,
    endTime: block.endTime,
    pauseStart: null,
    pauseEnd: null,
    pauseMinutes: 0,
    stunden: Math.round(((endMin - startMin) / 60) * 4) / 4,
    projectId: block.projectId,
  };
}

/**
 * Berechnet alle Blöcke und gibt sie als Array zurück (ohne Validierung).
 * Filtert leere Blöcke aus (start oder end fehlt).
 */
export function aggregateBlocks(blocks: Block[]): ComputedBlock[] {
  return blocks
    .filter((b) => b.startTime && b.endTime)
    .map((b) => computeBlock(b));
}

/**
 * Validierung eines einzelnen Blocks. Gibt Fehlertext zurück oder null wenn OK.
 */
export function validateBlock(block: Block): string | null {
  const s = timeToMin(block.startTime);
  const e = timeToMin(block.endTime);
  if (block.startTime === "" && block.endTime === "") return "Start und Ende fehlen";
  if (s == null) return "Startzeit ungültig";
  if (e == null) return "Endzeit ungültig";
  if (e <= s) return "Ende muss nach Start liegen";
  return null;
}

/**
 * Erkennt überlappende Blöcke (Warnung, kein Fehler).
 */
export function findOverlaps(blocks: Block[]): Array<[number, number]> {
  const result: Array<[number, number]> = [];
  for (let i = 0; i < blocks.length; i++) {
    const a = blocks[i];
    const aStart = timeToMin(a.startTime);
    const aEnd = timeToMin(a.endTime);
    if (aStart == null || aEnd == null) continue;
    for (let j = i + 1; j < blocks.length; j++) {
      const b = blocks[j];
      const bStart = timeToMin(b.startTime);
      const bEnd = timeToMin(b.endTime);
      if (bStart == null || bEnd == null) continue;
      if (aStart < bEnd && bStart < aEnd) {
        result.push([i, j]);
      }
    }
  }
  return result;
}

/**
 * Findet den nächsten freien "Start"-Zeitpunkt für einen neuen Block:
 * höchste endTime unter allen vorhandenen Blöcken — oder "07:00" als Fallback.
 */
export function suggestNextStart(blocks: Block[]): string {
  const ends = blocks
    .map((b) => timeToMin(b.endTime))
    .filter((m): m is number => m != null);
  if (ends.length === 0) return "07:00";
  const max = Math.max(...ends);
  const h = Math.floor(max / 60);
  const m = max % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
