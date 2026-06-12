/**
 * Lädt einen Leistungsbericht (LB / Werkstatt / LKW) aus der DB,
 * generiert das PDF mit jspdf und öffnet es im neuen Tab.
 *
 * Self-contained — wird sowohl von HoursReport als auch ProjectDetail
 * genutzt. Profil-Namen werden inline mitgeladen.
 */

import { supabase } from "@/integrations/supabase/client";
import {
  generateLeistungsberichtPDF,
  type LeistungsberichtPDFData,
} from "./generateLeistungsberichtPDF";

/**
 * Generiert das PDF und gibt die Blob-URL zurück — für die eingebettete
 * Vorschau (iframe) in der Stundenauswertung. Der Aufrufer ist für
 * URL.revokeObjectURL() beim Schließen verantwortlich.
 */
export async function getLeistungsberichtPDFUrl(berichtId: string): Promise<string> {
  // 1. Bericht laden
  const { data: bericht, error: berichtErr } = await supabase
    .from("leistungsberichte" as any)
    .select("*")
    .eq("id", berichtId)
    .single();
  if (berichtErr || !bericht) throw new Error("Bericht nicht gefunden");
  const b: any = bericht;

  // 2. Header-Projekt (nur klassische Leistungsberichte)
  let projekt: { name: string; plz: string; adresse: string } | null = null;
  const headerProjektId = b.projekt_id as string | null;
  if (headerProjektId) {
    const { data: pData } = await supabase
      .from("projects")
      .select("name, plz, adresse")
      .eq("id", headerProjektId)
      .single();
    if (pData) projekt = pData as any;
  }

  // 3. Tätigkeiten / Mitarbeiter / Stunden / Geräte / Material
  const [
    { data: taetigkeitenData },
    { data: mitarbeiterData },
    { data: stundenDataRaw },
    { data: taetigkeitenIds },
    { data: geraeteData },
    { data: materialienData },
  ] = await Promise.all([
    supabase
      .from("leistungsbericht_taetigkeiten" as any)
      .select("position, bezeichnung, tag")
      .eq("bericht_id", berichtId)
      .order("position"),
    supabase
      .from("leistungsbericht_mitarbeiter" as any)
      .select("mitarbeiter_id, ist_fahrer, ist_werkstatt, schmutzzulage, regen_schicht, summe_stunden")
      .eq("bericht_id", berichtId),
    supabase
      .from("leistungsbericht_stunden" as any)
      .select("mitarbeiter_id, taetigkeit_id, stunden")
      .eq("bericht_id", berichtId),
    supabase
      .from("leistungsbericht_taetigkeiten" as any)
      .select("id, position")
      .eq("bericht_id", berichtId),
    supabase
      .from("leistungsbericht_geraete" as any)
      .select("geraet, stunden")
      .eq("bericht_id", berichtId),
    supabase
      .from("leistungsbericht_materialien" as any)
      .select("bezeichnung, menge")
      .eq("bericht_id", berichtId),
  ]);

  // 4. Profil-Namen
  const maIds = ((mitarbeiterData as any[]) || []).map((m: any) => m.mitarbeiter_id).filter(Boolean);
  const profileMap: Record<string, { vorname: string; nachname: string }> = {};
  if (maIds.length > 0) {
    const { data: profileData } = await supabase
      .from("profiles")
      .select("id, vorname, nachname")
      .in("id", maIds);
    (profileData || []).forEach((p: any) => {
      profileMap[p.id] = { vorname: p.vorname || "", nachname: p.nachname || "" };
    });
  }

  // 5. taetigkeit_id → position
  const tidToPos: Record<string, number> = {};
  ((taetigkeitenIds as any[]) || []).forEach((t: any) => {
    tidToPos[t.id] = t.position;
  });

  const stundenData = ((stundenDataRaw as any[]) || []).map((s: any) => ({
    mitarbeiter_id: s.mitarbeiter_id,
    position: tidToPos[s.taetigkeit_id] || 0,
    stunden: parseFloat(s.stunden) || 0,
  }));

  // 6. Abfahrt dynamisch berechnen
  const maxStunden = Math.max(
    0,
    ...((mitarbeiterData as any[]) || []).map((m: any) => parseFloat(m.summe_stunden) || 0)
  );
  let pauseMin = 0;
  if (b.pause_von && b.pause_bis) {
    const [pvh, pvm] = (b.pause_von as string).split(":").map(Number);
    const [pbh, pbm] = (b.pause_bis as string).split(":").map(Number);
    pauseMin = Math.max(0, (pbh * 60 + pbm) - (pvh * 60 + pvm));
  }
  const startStr = ((b.arbeitsbeginn || b.ankunft_zeit || "") as string).substring(0, 5);
  let computedAbfahrt = "";
  if (startStr && maxStunden > 0) {
    const [bh, bm] = startStr.split(":").map(Number);
    if (!isNaN(bh) && !isNaN(bm)) {
      const totalMin = bh * 60 + bm + Math.round(maxStunden * 60) + pauseMin;
      if (totalMin < 24 * 60) {
        computedAbfahrt = `${String(Math.floor(totalMin / 60)).padStart(2, "0")}:${String(totalMin % 60).padStart(2, "0")}`;
      }
    }
  }
  const abfahrtForPdf = computedAbfahrt || (b.abfahrt_zeit ? (b.abfahrt_zeit as string).substring(0, 5) : "");

  // 7. PDF-Daten zusammenbauen
  const pdfData: LeistungsberichtPDFData = {
    typ: ((b.bericht_typ as string) === "werk" || (b.bericht_typ as string) === "lkw")
      ? (b.bericht_typ as "werk" | "lkw")
      : "leistungsbericht",
    projektName: projekt?.name || "-",
    projektOrt: `${projekt?.plz || ""} ${projekt?.adresse || ""}`.trim(),
    objekt: b.objekt || "",
    datum: b.datum,
    ankunftZeit: b.ankunft_zeit || "",
    abfahrtZeit: abfahrtForPdf,
    pauseVon: b.pause_von || "",
    pauseBis: b.pause_bis || "",
    lkwStunden: b.lkw_stunden || 0,
    taetigkeiten: ((taetigkeitenData as any[]) || []).map((t: any) => ({
      position: t.position,
      bezeichnung: t.bezeichnung,
    })),
    mitarbeiter: ((mitarbeiterData as any[]) || []).map((m: any) => {
      const p = profileMap[m.mitarbeiter_id];
      const mStunden = stundenData
        .filter((s) => s.mitarbeiter_id === m.mitarbeiter_id)
        .map((s) => ({ position: s.position, stunden: s.stunden }));
      return {
        name: p ? `${p.nachname} ${p.vorname}` : "?",
        istFahrer: m.ist_fahrer || false,
        istWerkstatt: m.ist_werkstatt || false,
        schmutzzulage: m.schmutzzulage || false,
        regenSchicht: m.regen_schicht || false,
        stunden: mStunden,
        summe: parseFloat(m.summe_stunden) || 0,
      };
    }),
    gesamtstunden: ((mitarbeiterData as any[]) || []).reduce(
      (s: number, m: any) => s + (parseFloat(m.summe_stunden) || 0),
      0
    ),
    geraete: ((geraeteData as any[]) || []).map((g: any) => ({
      geraet: g.geraet,
      stunden: parseFloat(g.stunden) || 0,
    })),
    materialien: ((materialienData as any[]) || []).map((m: any) => ({
      bezeichnung: m.bezeichnung,
      menge: m.menge || "",
    })),
    anmerkungen: b.anmerkungen || "",
    fertiggestellt: b.fertiggestellt || false,
  };

  // 8. PDF erzeugen → Blob-URL
  const blob = await generateLeistungsberichtPDF(pdfData);
  return URL.createObjectURL(blob);
}

/** Generiert das PDF und öffnet es in einem neuen Tab (bisheriges Verhalten). */
export async function downloadLeistungsberichtPDF(berichtId: string): Promise<void> {
  const url = await getLeistungsberichtPDFUrl(berichtId);
  window.open(url, "_blank");
}
