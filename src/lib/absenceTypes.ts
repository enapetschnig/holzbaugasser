// Single Source of Truth für alle Abwesenheits-Arten.
// Wird überall in der App importiert (Absence-Form, Stundenauswertung-Grid,
// LB-MA-Picker, Excel/PDF-Exporter etc.) — verhindert dass an verschiedenen
// Stellen unterschiedliche Listen entstehen.

import {
  Sun,
  Thermometer,
  BookOpen,
  Clock,
  GraduationCap,
  Stethoscope,
  PenLine,
  PartyPopper,
  type LucideIcon,
} from "lucide-react";

export type AbsenceTypeId =
  | "urlaub"
  | "krankenstand"
  | "arzt"
  | "zeitausgleich"
  | "fortbildung"
  | "schule"
  | "sonstiges";

export interface AbsenceType {
  id: AbsenceTypeId;
  label: string;        // UI-Label im Picker
  taetigkeit: string;   // DB-Wert (was in time_entries.taetigkeit landet)
  short: string;        // Kurzform für Tag-Grid (z.B. "U", "K", "A")
  icon: LucideIcon;
  color: string;        // Tailwind-Klasse für Akzentfarbe
  hourlyEditable: boolean; // true = manuelle Stundenzahl möglich (Teilzeit)
}

// User-auswählbare Abwesenheits-Arten.
// "Feiertag" ist NICHT in dieser Liste — wird automatisch gebucht via
// lib/feiertagAutoBook.ts, soll vom User nicht manuell ausgewählt werden.
export const ABSENCE_TYPES: AbsenceType[] = [
  { id: "urlaub",        label: "Urlaub",         taetigkeit: "Urlaub",       short: "U",      icon: Sun,           color: "text-green-600",  hourlyEditable: false },
  { id: "krankenstand",  label: "Krankenstand",   taetigkeit: "Krankenstand", short: "K",      icon: Thermometer,   color: "text-red-600",    hourlyEditable: false },
  { id: "arzt",          label: "Arzt",           taetigkeit: "Arzt",         short: "A",      icon: Stethoscope,   color: "text-pink-600",   hourlyEditable: true  },
  { id: "zeitausgleich", label: "Zeitausgleich",  taetigkeit: "ZA",           short: "ZA",     icon: Clock,         color: "text-purple-600", hourlyEditable: true  },
  { id: "fortbildung",   label: "Fortbildung",    taetigkeit: "Fortbildung",  short: "FB",     icon: BookOpen,      color: "text-blue-600",   hourlyEditable: false },
  { id: "schule",        label: "Berufsschule",   taetigkeit: "Schule",       short: "Schule", icon: GraduationCap, color: "text-cyan-600",   hourlyEditable: false },
  { id: "sonstiges",     label: "Eigener Grund",  taetigkeit: "Sonstiges",    short: "S",      icon: PenLine,       color: "text-gray-600",   hourlyEditable: true  },
];

// Pseudo-Eintrag für Feiertag — nicht im User-Picker, aber zum Rendern (Grid, PDF).
export const FEIERTAG_TYPE: AbsenceType = {
  id: "sonstiges", // kein eigener id-Wert, weil nicht im Picker
  label: "Feiertag",
  taetigkeit: "Feiertag",
  short: "Feiertag",
  icon: PartyPopper,
  color: "text-orange-600",
  hourlyEditable: false,
};

// Voll-Absenzen: blockieren den ganzen Tag — kein gleichzeitiges Arbeiten möglich.
// (z.B. Urlaub/Krankenstand-Tag → keine zusätzliche LB-Buchung möglich)
// Teil-Absenzen (hourlyEditable=true) wie Arzt/ZA/Sonstiges können mit Arbeit
// kombiniert werden.
export const VOLL_ABSENZ_TAETIGKEITEN: string[] = ABSENCE_TYPES
  .filter((t) => !t.hourlyEditable)
  .map((t) => t.taetigkeit)
  .concat(["Feiertag", "Berufsschule", "Weiterbildung"]); // Legacy-Strings

// Helper für DB-Filter und Detect-Logik
export const ABSENCE_TAETIGKEITEN: string[] = ABSENCE_TYPES.map((t) => t.taetigkeit);

// Inklusive "Feiertag" — für Detect-Logik (z.B. Stundenauswertung, LB-MA-Picker
// erkennen automatisch gebuchte Feiertage als Absenz).
export const ABSENCE_TAETIGKEITEN_INKL_FEIERTAG: string[] = [
  ...ABSENCE_TAETIGKEITEN,
  "Feiertag",
];

export function isAbsenzTaetigkeit(taetigkeit: string | null | undefined): boolean {
  if (!taetigkeit) return false;
  return ABSENCE_TAETIGKEITEN_INKL_FEIERTAG.includes(taetigkeit);
}

export function findAbsenceTypeByTaetigkeit(
  taetigkeit: string | null | undefined
): AbsenceType | undefined {
  if (!taetigkeit) return undefined;
  if (taetigkeit === "Feiertag") return FEIERTAG_TYPE;
  // Legacy-String "Zeitausgleich" (heute in der DB "ZA") auf den ZA-Typ mappen,
  // damit alte Einträge im Grid/Export korrekt als ZA (Teil-Absenz) erkannt und
  // nicht als reguläre Arbeit gezählt werden.
  if (taetigkeit === "Zeitausgleich") {
    return ABSENCE_TYPES.find((t) => t.id === "zeitausgleich");
  }
  return ABSENCE_TYPES.find((t) => t.taetigkeit === taetigkeit);
}

export function findAbsenceTypeById(id: AbsenceTypeId): AbsenceType | undefined {
  return ABSENCE_TYPES.find((t) => t.id === id);
}
