// Berichtübergreifende Tages-Konflikt-Prüfung.
//
// Findet für eine Liste von Mitarbeitern heraus, ob sie am gegebenen Tag
// bereits in ANDEREN Leistungsberichten (egal welcher Typ, welches Projekt,
// welcher Ersteller) gebucht sind. Wird von allen drei Bericht-Formularen
// vor dem Speichern aufgerufen, damit niemand versehentlich doppelt bucht
// (Ursache der 16/18h-Tage im Mai/Juni 2026).

import { supabase } from "@/integrations/supabase/client";

export interface TagesKonflikt {
  mitarbeiterId: string;
  mitarbeiterName: string;
  bestehendeStunden: number;
  neueStunden: number;
  gesamt: number;
  details: string[]; // z.B. '9h im Leistungsbericht "Drescher" (von Trampitsch)'
}

const TYP_LABEL: Record<string, string> = {
  leistungsbericht: "Leistungsbericht",
  werk: "Werkstatt-Bericht",
  lkw: "LKW-Bericht",
};

/**
 * @param datum YYYY-MM-DD
 * @param maMitStunden Mitarbeiter des neuen Berichts mit ihren geplanten Netto-Stunden
 * @param ausgenommenBerichtId beim Edit: der eigene Bericht zählt nicht als Konflikt
 * @param ausgenommenProjektId optional: Berichte dieses Projekts ausblenden
 *        (Standard-LB behandelt gleiche-Projekt-Konflikte bereits in einem
 *        eigenen Überschreiben-Dialog — hier nur die ANDEREN Berichte zeigen)
 */
export async function findeTagesKonflikte(
  datum: string,
  maMitStunden: { id: string; name: string; stunden: number }[],
  ausgenommenBerichtId: string | null,
  ausgenommenProjektId?: string | null
): Promise<TagesKonflikt[]> {
  const maIds = maMitStunden.map((m) => m.id).filter(Boolean);
  if (maIds.length === 0) return [];

  let q = supabase
    .from("leistungsbericht_mitarbeiter" as any)
    .select(
      "mitarbeiter_id, summe_stunden, bericht_id, leistungsberichte!inner(id, datum, bericht_typ, projekt_id, erstellt_von)"
    )
    .in("mitarbeiter_id", maIds)
    .eq("leistungsberichte.datum" as any, datum);
  if (ausgenommenBerichtId) {
    q = q.neq("bericht_id", ausgenommenBerichtId);
  }
  const { data, error } = await q;
  if (error || !data || (data as any[]).length === 0) return [];

  // Projekt-Filter in JS (nicht per .neq — das würde NULL-projekt_id-Zeilen
  // der Werk/LKW-Berichte ungewollt mit ausblenden).
  const rows = (data as any[]).filter(
    (r) => !(ausgenommenProjektId && r.leistungsberichte?.projekt_id === ausgenommenProjektId)
  );
  if (rows.length === 0) return [];

  // Projekt-Namen + Ersteller-Namen nachladen
  const projIds = [...new Set(rows.map((r) => r.leistungsberichte?.projekt_id).filter(Boolean))];
  const erstellerIds = [...new Set(rows.map((r) => r.leistungsberichte?.erstellt_von).filter(Boolean))];
  const [projRes, erstellerRes] = await Promise.all([
    projIds.length > 0
      ? supabase.from("projects").select("id, name").in("id", projIds)
      : Promise.resolve({ data: [] as any[] }),
    erstellerIds.length > 0
      ? supabase.from("profiles").select("id, vorname, nachname").in("id", erstellerIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);
  const projMap: Record<string, string> = {};
  ((projRes.data as any[]) || []).forEach((p) => { projMap[p.id] = p.name; });
  const erstellerMap: Record<string, string> = {};
  ((erstellerRes.data as any[]) || []).forEach((p) => {
    erstellerMap[p.id] = `${p.vorname || ""} ${p.nachname || ""}`.trim();
  });

  const konflikte: TagesKonflikt[] = [];
  for (const ma of maMitStunden) {
    const maRows = rows.filter((r) => r.mitarbeiter_id === ma.id);
    if (maRows.length === 0) continue;
    const bestehend = maRows.reduce((s, r) => s + (parseFloat(r.summe_stunden) || 0), 0);
    const details = maRows.map((r) => {
      const lb = r.leistungsberichte || {};
      const typLabel = TYP_LABEL[lb.bericht_typ] || "Bericht";
      const projName = lb.projekt_id ? ` "${projMap[lb.projekt_id] || "?"}"` : "";
      const ersteller = erstellerMap[lb.erstellt_von] || "?";
      const h = Math.round((parseFloat(r.summe_stunden) || 0) * 100) / 100;
      return `${String(h).replace(".", ",")}h im ${typLabel}${projName} (von ${ersteller})`;
    });
    konflikte.push({
      mitarbeiterId: ma.id,
      mitarbeiterName: ma.name,
      bestehendeStunden: Math.round(bestehend * 100) / 100,
      neueStunden: Math.round(ma.stunden * 100) / 100,
      gesamt: Math.round((bestehend + ma.stunden) * 100) / 100,
      details,
    });
  }
  return konflikte;
}

/** Baut den Warn-Text für den Bestätigungs-Dialog. */
export function konflikteAlsText(konflikte: TagesKonflikt[], datum: string): string {
  const d = new Date(datum + "T00:00:00");
  const datumStr = `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.`;
  const zeilen = konflikte.map((k) => {
    const warn = k.gesamt > 12 ? " ⚠ SEHR HOCH!" : "";
    return `${k.mitarbeiterName} ist am ${datumStr} bereits gebucht:\n` +
      k.details.map((det) => `  • ${det}`).join("\n") +
      `\n  → Mit diesem Bericht hätte er ${String(k.gesamt).replace(".", ",")}h an einem Tag.${warn}`;
  });
  return zeilen.join("\n\n");
}
