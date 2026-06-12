// Der Leistungsbericht LKW ist nur für die zwei LKW-Fahrer gedacht.
// Nur sie sehen die Kachel auf der Startseite. Die Route /lkw-bericht
// selbst bleibt offen, damit Admin/Projektleiter Berichte über die
// Stundenauswertung (?edit=...) weiterhin bearbeiten können.

export const LKW_BERECHTIGTE: string[] = [
  "c06e6c8a-5997-4c8f-b5c9-1a0a09986ec4", // Florian Kamnik
  "202cf540-6b55-4b59-8db4-0016c668ac98", // Johann Krusic
];

export function darfLkwBericht(userId: string | null | undefined): boolean {
  return !!userId && LKW_BERECHTIGTE.includes(userId);
}
