// Österreichische gesetzliche Feiertage.
// Bewegliche Feiertage (Ostermontag, Christi Himmelfahrt, Pfingstmontag,
// Fronleichnam) werden aus Ostersonntag berechnet (Gauß-Osteralgorithmus).

function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function fmt(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface Feiertag {
  datum: string; // YYYY-MM-DD
  name: string;
}

/**
 * Österreichische gesetzliche Feiertage für ein Jahr (Mo-Fr; Wochenend-Feiertage
 * werden herausgefiltert, weil sie nicht ins Zeitkonto gebucht werden).
 *
 * Karfreitag ist seit 2019 in Österreich KEIN gesetzlicher Feiertag mehr —
 * bewusst NICHT in der Liste.
 */
export function getAustrianFeiertage(year: number): Feiertag[] {
  const ostern = easterSunday(year);
  const list: Feiertag[] = [
    { datum: `${year}-01-01`, name: "Neujahr" },
    { datum: `${year}-01-06`, name: "Heilige Drei Könige" },
    { datum: fmt(addDays(ostern, 1)),  name: "Ostermontag" },
    { datum: `${year}-05-01`, name: "Staatsfeiertag" },
    { datum: fmt(addDays(ostern, 39)), name: "Christi Himmelfahrt" },
    { datum: fmt(addDays(ostern, 50)), name: "Pfingstmontag" },
    { datum: fmt(addDays(ostern, 60)), name: "Fronleichnam" },
    { datum: `${year}-08-15`, name: "Mariä Himmelfahrt" },
    { datum: `${year}-10-26`, name: "Nationalfeiertag" },
    { datum: `${year}-11-01`, name: "Allerheiligen" },
    { datum: `${year}-12-08`, name: "Mariä Empfängnis" },
    { datum: `${year}-12-25`, name: "Christtag" },
    { datum: `${year}-12-26`, name: "Stefanitag" },
  ];
  return list.filter((f) => {
    const d = new Date(f.datum + "T00:00:00").getDay();
    return d !== 0 && d !== 6; // Sa/So raus
  });
}
