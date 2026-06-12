import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Plus, Trash2, Save, FileText, Users, CalendarDays, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/PageHeader";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Switch } from "@/components/ui/switch";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { ABSENCE_TAETIGKEITEN_INKL_FEIERTAG, VOLL_ABSENZ_TAETIGKEITEN, findAbsenceTypeByTaetigkeit } from "@/lib/absenceTypes";
import { findeTagesKonflikte } from "@/lib/berichtKonflikte";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Project = {
  id: string;
  name: string;
  plz: string;
  adresse: string | null;
  status: string | null;
};

type Profile = {
  id: string;
  vorname: string;
  nachname: string;
};

type Taetigkeit = {
  position: number;
  bezeichnung: string;
  tag?: "werkstatt" | "schmutz" | "regen";
};

type MitarbeiterRow = {
  id: string; // local key
  mitarbeiterId: string;
  istFahrer: boolean;
  istWerkstatt: boolean;
  schmutzzulage: boolean;
  regenSchicht: boolean;
  fahrerStunden: string;    // "" means all hours
  werkstattStunden: string;
  schmutzzulageStunden: string;
  regenStunden: string;
  stunden: Record<number, number | string>; // position -> hours (string during editing)
};

type ExistingBericht = {
  id: string;
  datum: string;
  projekt_name: string;
  mitarbeiter_count: number;
  total_stunden: number;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function calcPauseMinutes(von: string, bis: string): number {
  if (!von || !bis) return 0;
  const [hv, mv] = von.split(":").map(Number);
  const [hb, mb] = bis.split(":").map(Number);
  const diff = (hb * 60 + mb) - (hv * 60 + mv);
  return Math.max(0, diff);
}

function sumStunden(row: MitarbeiterRow, excludePositions?: Set<number>): number {
  return Object.entries(row.stunden).reduce((a, [posStr, b]) => {
    if (excludePositions?.has(Number(posStr))) return a;
    return a + (typeof b === "string" ? parseFloat(b) || 0 : b || 0);
  }, 0);
}

/**
 * Berechnet die Abfahrtszeit aus Arbeitsbeginn + Netto-Stunden + Pause-Minuten.
 * Beispiel: arbeitsbeginn="06:30", stunden=3.5, pauseMin=0 → "10:00"
 * Beispiel: arbeitsbeginn="06:30", stunden=8, pauseMin=30 → "15:00"
 * Returns leeren String wenn invalide Eingaben.
 */
function computeAbfahrt(arbeitsbeginn: string, stunden: number, pauseMinuten: number): string {
  if (!arbeitsbeginn || stunden <= 0) return "";
  const [bh, bm] = arbeitsbeginn.split(":").map(Number);
  if (isNaN(bh) || isNaN(bm)) return "";
  const startMin = bh * 60 + bm;
  const totalMin = startMin + Math.round(stunden * 60) + (pauseMinuten || 0);
  if (totalMin >= 24 * 60) return "23:59";
  const eh = Math.floor(totalMin / 60);
  const em = totalMin % 60;
  return `${String(eh).padStart(2, "0")}:${String(em).padStart(2, "0")}`;
}

function parseStunden(val: number | string): number {
  if (typeof val === "string") return parseFloat(val) || 0;
  return val || 0;
}

function createEmptyMitarbeiterRow(): MitarbeiterRow {
  return {
    id: crypto.randomUUID(),
    mitarbeiterId: "",
    istFahrer: false,
    istWerkstatt: false,
    schmutzzulage: false,
    regenSchicht: false,
    fahrerStunden: "",
    werkstattStunden: "",
    schmutzzulageStunden: "",
    regenStunden: "",
    stunden: { 1: 0.5 },  // Rüstzeit/Anfahrt immer 0,5h
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const TimeTracking = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { toast } = useToast();

  // Auth & role
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isExtern, setIsExtern] = useState(false);
  const [isSelfOnly, setIsSelfOnly] = useState(false); // Mitarbeiter + Extern: kann nur sich selbst eintragen
  const [loading, setLoading] = useState(true);

  // Confirm dialog state (replaces window.confirm)
  const [confirmState, setConfirmState] = useState<{
    title: string;
    description: string;
    details?: string[];
    actionLabel: string;
    cancelLabel?: string;
    variant?: "default" | "destructive";
    onConfirm: () => void | Promise<void>;
  } | null>(null);

  // Original-Snapshot beim Edit: MA-Liste, Datum, Projekt und Ersteller des
  // GELADENEN Berichts. Der Legacy-time_entries-Cleanup muss gegen diese
  // Originalwerte laufen (nicht gegen den editierbaren Form-State), und
  // erstellt_von darf beim Re-Insert nicht auf den Editor wechseln.
  const [originalMaIds, setOriginalMaIds] = useState<string[]>([]);
  const [originalDatum, setOriginalDatum] = useState<string | null>(null);
  const [originalProjektId, setOriginalProjektId] = useState<string | null>(null);
  const [originalErstelltVon, setOriginalErstelltVon] = useState<string | null>(null);

  // Data
  const [projects, setProjects] = useState<Project[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);

  // Form: Kopfdaten
  const [datum, setDatum] = useState(format(new Date(), "yyyy-MM-dd"));
  const [projektId, setProjektId] = useState("");
  const [objekt, setObjekt] = useState("");
  const [arbeitsbeginn, setArbeitsbeginn] = useState("06:30");
  const [ankunftZeit, setAnkunftZeit] = useState("07:00");
  const [abfahrtZeit, setAbfahrtZeit] = useState("16:00");
  // Pause vorausgefüllt mit 12:00–12:30 (Standard-Mittagspause).
  // Wird automatisch entfernt wenn die Buchung diese Zeit nicht überschneidet.
  const [pauseVon, setPauseVon] = useState("12:00");
  const [pauseBis, setPauseBis] = useState("12:30");
  // Wenn true: Pause wird in diesem Bericht NICHT abgezogen (z.B. weil sie schon in
  // einem anderen Bericht des Tages gebucht wurde). Auto-Detect oder manueller Override.
  const [keinePause, setKeinePause] = useState(false);
  const [schmutzzulageAlle, setSchmutzzulageAlle] = useState(false);
  const [regenSchichtAlle, setRegenSchichtAlle] = useState(false);

  // Form: Taetigkeiten
  const [taetigkeiten, setTaetigkeiten] = useState<Taetigkeit[]>([
    { position: 1, bezeichnung: "Rüstzeit/Anfahrt, Ankunftszeit Baustelle" },
    { position: 2, bezeichnung: "" },
    { position: 3, bezeichnung: "" },
    { position: 4, bezeichnung: "" },
  ]);

  // Tätigkeits-Vorlagen (zentrale Liste, vom Admin verwaltet)
  const [taetigkeitTemplates, setTaetigkeitTemplates] = useState<string[]>([]);

  // Form: Mitarbeiter
  const [mitarbeiterRows, setMitarbeiterRows] = useState<MitarbeiterRow[]>([
    createEmptyMitarbeiterRow(),
  ]);

  // Geräteeinsatz
  const [geraete, setGeraete] = useState<{ id: string; geraet: string; stunden: string }[]>([]);
  const GERAETE_OPTIONEN = ["LKW", "Kran", "Bagger", "Sonstiges"];

  // Materialien
  const [materialien, setMaterialien] = useState<{ id: string; bezeichnung: string; menge: string }[]>([]);

  // Anmerkungen & Fertiggestellt
  const [anmerkungen, setAnmerkungen] = useState("");
  const [fertiggestellt, setFertiggestellt] = useState(false);

  // Mitarbeiter-Auswahl Dialog
  const [showMitarbeiterDialog, setShowMitarbeiterDialog] = useState(false);
  const [selectedNewMitarbeiter, setSelectedNewMitarbeiter] = useState<Set<string>>(new Set());

  // Neues Projekt Dialog
  const [showNewProjectDialog, setShowNewProjectDialog] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectPlz, setNewProjectPlz] = useState("");
  const [newProjectAdresse, setNewProjectAdresse] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);

  // Gleiche Stunden für alle
  const [gleicheStundenFuerAlle, setGleicheStundenFuerAlle] = useState(false);

  // Saving state
  const [saving, setSaving] = useState(false);
  // Replaced by existingTodayBerichte card with project details
  const [maExistingHours, setMaExistingHours] = useState<Record<string, number>>({});

  // Alle eigenen Berichte (LB + Werkstatt + LKW) für das aktuelle Datum
  // — unified Liste für die "Bereits heute gebucht"-Card.
  const [existingTodayBerichte, setExistingTodayBerichte] = useState<{
    id: string;
    bericht_typ: "leistungsbericht" | "werk" | "lkw";
    projekt_id: string | null;
    projekt_name: string;
    arbeitsbeginn: string | null;
    ankunft_zeit: string | null;
    abfahrt_zeit: string | null;
    pause_von: string | null;
    pause_bis: string | null;
    total_stunden: number;
  }[]>([]);

  // Aggregierte Projektleiter-Stunden des Users für das aktuelle Datum (separate Anzeige)
  const [existingTodayPLStunden, setExistingTodayPLStunden] = useState<number>(0);

  // Editing existing report
  const [editingBerichtId, setEditingBerichtId] = useState<string | null>(null);
  // Brutto-Eingabe-Flag: true = User trägt Brutto-Stunden ein, System zieht Pause ab.
  // Default: true für neue Berichte. Beim Edit wird der Wert aus dem geladenen Bericht übernommen.
  const [matrixBrutto, setMatrixBrutto] = useState<boolean>(true);

  // Existing reports list
  const [existingBerichte, setExistingBerichte] = useState<ExistingBericht[]>([]);
  const [loadingBerichte, setLoadingBerichte] = useState(false);

  // Derived
  const selectedProject = useMemo(
    () => projects.find((p) => p.id === projektId),
    [projects, projektId]
  );

  const pauseMinuten = useMemo(
    () => keinePause ? 0 : calcPauseMinutes(pauseVon, pauseBis),
    [pauseVon, pauseBis, keinePause]
  );

  // Positions tagged as schmutz (only Zulagen - don't count as work hours)
  // Regen IS work hours (Wetterschicht), just marked differently
  const zulagePositions = useMemo(() => {
    const set = new Set<number>();
    for (const t of taetigkeiten) {
      if (t.tag === "schmutz") set.add(t.position);
    }
    return set;
  }, [taetigkeiten]);

  // Auto-fill position 1 text
  const pos1Text = useMemo(
    () => `Rüstzeit/Anfahrt, Ankunftszeit Baustelle: ${ankunftZeit}`,
    [ankunftZeit]
  );

  // Abfahrt Baustelle dynamisch berechnen: Arbeitsbeginn + Netto-Arbeit + Pause-Dauer
  // = die echte Endzeit auf der Baustelle (Pause-Zeit ist da drin enthalten).
  // Wenn keine Stunden eingetragen: Default je Wochentag (Fr 15:00, sonst 16:00).
  useEffect(() => {
    if (!datum || !arbeitsbeginn) return;

    const pauseHours = pauseMinuten / 60;
    // Höchste Stundensumme aller MA — bei matrixBrutto=true ist sumStunden brutto
    // (inkl. Pause), wir müssen auf netto reduzieren, sonst wird Pause doppelt addiert.
    const maxStunden = Math.max(
      0,
      ...mitarbeiterRows
        .filter((r) => r.mitarbeiterId)
        .map((r) => {
          const gross = sumStunden(r);
          return matrixBrutto ? Math.max(0, gross - pauseHours) : gross;
        })
    );

    if (maxStunden <= 0) {
      // Keine Stunden eingegeben → Wochentag-Default
      const dow = new Date(datum + "T00:00:00").getDay();
      setAbfahrtZeit(dow === 5 ? "15:00" : "16:00");
      return;
    }

    // arbeitsbeginn + Netto-Arbeit + Pause = echte Abfahrt von der Baustelle
    const [bh, bm] = arbeitsbeginn.split(":").map(Number);
    if (isNaN(bh) || isNaN(bm)) return;
    const startMin = bh * 60 + bm;
    const totalMin = startMin + Math.round(maxStunden * 60) + (pauseMinuten || 0);

    if (totalMin >= 24 * 60) return; // Übermitternacht ignorieren

    const eh = Math.floor(totalMin / 60);
    const em = totalMin % 60;
    setAbfahrtZeit(`${String(eh).padStart(2, "0")}:${String(em).padStart(2, "0")}`);
  }, [datum, arbeitsbeginn, mitarbeiterRows, pauseMinuten, matrixBrutto]);

  // Rüstzeit/Anfahrt = (Ankunft − Arbeitsbeginn) in Stunden, gerundet auf 0.25
  const ruestzeitStunden = useMemo(() => {
    const parseT = (t: string) => {
      const [h, m] = t.split(":").map(Number);
      if (isNaN(h) || isNaN(m)) return null;
      return h * 60 + m;
    };
    const ab = parseT(arbeitsbeginn);
    const ak = parseT(ankunftZeit);
    if (ab == null || ak == null) return 0.5;
    const diffMin = ak - ab;
    if (diffMin <= 0) return 0;
    // auf Viertelstunden runden
    return Math.round((diffMin / 60) * 4) / 4;
  }, [arbeitsbeginn, ankunftZeit]);

  // Wenn Arbeitsbeginn/Ankunft sich ändern: Position 1 Stunden für alle MA auf neuen Wert setzen
  useEffect(() => {
    setMitarbeiterRows((prev) =>
      prev.map((row) => ({
        ...row,
        stunden: { ...row.stunden, 1: ruestzeitStunden },
      }))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ruestzeitStunden]);

  // Tages-Summen für die Zusammenfassungs-Card unten am Form
  const aktiveMaCount = useMemo(
    () => mitarbeiterRows.filter((r) => r.mitarbeiterId).length,
    [mitarbeiterRows]
  );

  const taetigkeitenCount = useMemo(
    () => taetigkeiten.filter((t) => t.bezeichnung.trim().length > 0).length,
    [taetigkeiten]
  );

  // Brutto-Eingabe pro MA (Zulagen wie Schmutz ausgeschlossen, da diese keine Arbeitsstunden sind).
  const tagGrossStunden = useMemo(() => {
    let sum = 0;
    for (const row of mitarbeiterRows) {
      if (!row.mitarbeiterId) continue;
      sum += sumStunden(row, zulagePositions);
    }
    return Math.round(sum * 100) / 100;
  }, [mitarbeiterRows, zulagePositions]);

  // Netto-Stunden = was am Ende in DB summe_stunden landet (mit/ohne Pause-Abzug je matrixBrutto).
  const tagTotalStunden = useMemo(() => {
    const pauseHours = pauseMinuten / 60;
    let sum = 0;
    for (const row of mitarbeiterRows) {
      if (!row.mitarbeiterId) continue;
      const gross = sumStunden(row, zulagePositions);
      const net = matrixBrutto ? Math.max(0, gross - pauseHours) : gross;
      sum += net;
    }
    return Math.round(sum * 100) / 100;
  }, [mitarbeiterRows, zulagePositions, pauseMinuten, matrixBrutto]);

  // Pause-Abzug-Anzeige: nur wenn Brutto-Eingabe + Pause aktiv + mind. 1 MA mit gross > 0.
  const pauseAbzugTotal = useMemo(() => {
    if (!matrixBrutto || pauseMinuten <= 0) return 0;
    const pauseHours = pauseMinuten / 60;
    let abz = 0;
    for (const row of mitarbeiterRows) {
      if (!row.mitarbeiterId) continue;
      const gross = sumStunden(row, zulagePositions);
      // Nur Pause abziehen wenn der MA überhaupt Stunden hat (sonst wäre das negativ und nicht sichtbar im Save)
      if (gross > 0) abz += Math.min(pauseHours, gross);
    }
    return Math.round(abz * 100) / 100;
  }, [mitarbeiterRows, zulagePositions, pauseMinuten, matrixBrutto]);

  // Auto-fill pause text for last position
  const pauseText = useMemo(() => {
    if (!pauseVon || !pauseBis) return "Pause";
    return `Pause ${pauseVon}–${pauseBis} (${pauseMinuten} Min.)`;
  }, [pauseVon, pauseBis, pauseMinuten]);

  // Multi-Bericht: Lade User's eigene Berichte für das aktuelle Datum (für UI + Auto-Fill).
  // Ausgenommen: der gerade editierte Bericht (im Edit-Mode).
  useEffect(() => {
    if (!currentUserId || !datum) {
      setExistingTodayBerichte([]);
      return;
    }
    let cancelled = false;
    (async () => {
      // Alle eigenen Berichte für den Tag holen — ALLE Typen (LB, Werkstatt, LKW)
      let q = supabase
        .from("leistungsberichte" as any)
        .select("id, projekt_id, bericht_typ, arbeitsbeginn, ankunft_zeit, abfahrt_zeit, pause_von, pause_bis")
        .eq("erstellt_von", currentUserId)
        .eq("datum", datum);
      if (editingBerichtId) q = q.neq("id", editingBerichtId);
      const { data: berichte } = await q;
      if (cancelled) return;

      if (!berichte || (berichte as any[]).length === 0) {
        if (!cancelled) setExistingTodayBerichte([]);
      } else {
        // Projekt-Namen laden (nur LB-Berichte haben projekt_id; Werkstatt/LKW haben NULL)
        const projIds = [...new Set((berichte as any[]).map((b: any) => b.projekt_id).filter(Boolean))];
        const projNameMap: Record<string, string> = {};
        if (projIds.length > 0) {
          const { data: projData } = await supabase
            .from("projects")
            .select("id, name")
            .in("id", projIds);
          (projData || []).forEach((p: any) => { projNameMap[p.id] = p.name; });
        }

        // Stundensummen pro Bericht (für aktuellen User)
        const berichtIds = (berichte as any[]).map((b: any) => b.id);
        const { data: maData } = await supabase
          .from("leistungsbericht_mitarbeiter" as any)
          .select("bericht_id, mitarbeiter_id, summe_stunden")
          .in("bericht_id", berichtIds)
          .eq("mitarbeiter_id", currentUserId);
        const stundenPerBericht: Record<string, number> = {};
        (maData as any[] || []).forEach((m: any) => {
          stundenPerBericht[m.bericht_id] = parseFloat(m.summe_stunden) || 0;
        });

        const result = (berichte as any[]).map((b: any) => ({
          id: b.id as string,
          bericht_typ: ((b.bericht_typ as string) || "leistungsbericht") as "leistungsbericht" | "werk" | "lkw",
          projekt_id: (b.projekt_id as string | null) || null,
          projekt_name: b.projekt_id ? (projNameMap[b.projekt_id] || "-") : "",
          arbeitsbeginn: b.arbeitsbeginn,
          ankunft_zeit: b.ankunft_zeit,
          abfahrt_zeit: b.abfahrt_zeit,
          pause_von: b.pause_von,
          pause_bis: b.pause_bis,
          total_stunden: stundenPerBericht[b.id] || 0,
        }));
        if (!cancelled) setExistingTodayBerichte(result);
      }

      // Aggregierte PL-Stunden des Users für den Tag (zusätzliche Info-Zeile)
      const plQuery: any = supabase
        .from("time_entries")
        .select("stunden")
        .eq("user_id", currentUserId)
        .eq("datum", datum);
      const { data: plEntries } = await plQuery.eq("entry_typ", "projektleiter");
      if (cancelled) return;
      const plSum = ((plEntries as any[]) || []).reduce((s, e) => s + (parseFloat(e.stunden) || 0), 0);
      if (!cancelled) setExistingTodayPLStunden(Math.round(plSum * 100) / 100);
    })();
    return () => { cancelled = true; };
  }, [datum, currentUserId, editingBerichtId]);

  // Teil-Absenz-Endzeiten des Tages (Arzt, ZA-Teilzeit, Sonstiges) — werden beim
  // Auto-Fill als möglicher Arbeitsbeginn berücksichtigt, damit LB nach dem Arzt
  // beginnt (z.B. Arzt 07:00 – 09:00 → LB ab 09:00).
  const [partialAbsenceEnds, setPartialAbsenceEnds] = useState<string[]>([]);

  useEffect(() => {
    if (!datum || !currentUserId) { setPartialAbsenceEnds([]); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("time_entries")
        .select("end_time, stunden, taetigkeit")
        .eq("user_id", currentUserId)
        .eq("datum", datum);
      if (cancelled) return;
      const ends: string[] = [];
      for (const e of (data || []) as any[]) {
        const typ = findAbsenceTypeByTaetigkeit(e.taetigkeit);
        if (typ?.hourlyEditable && e.end_time) {
          ends.push((e.end_time as string).substring(0, 5));
        }
      }
      setPartialAbsenceEnds(ends);
    })();
    return () => { cancelled = true; };
  }, [datum, currentUserId]);

  // Auto-Fill Arbeitsbeginn/Ankunft bei Datum-Wechsel:
  // - Tag OHNE Buchungen → Defaults (06:30 / 07:00)
  // - Tag MIT Buchungen oder Teil-Absenz → Endzeit der spätesten als Start nehmen
  // Im Edit-Modus wird nichts überschrieben.
  useEffect(() => {
    if (editingBerichtId) return;

    if (existingTodayBerichte.length === 0 && partialAbsenceEnds.length === 0) {
      // Tag ist leer → Defaults wieder herstellen
      setArbeitsbeginn("06:30");
      setAnkunftZeit("07:00");
      setPauseVon("12:00");
      setPauseBis("12:30");
      setKeinePause(false);
      return;
    }

    // Berechne Endzeit für jeden Bericht aus arbeitsbeginn + stunden + pause
    const withComputed = existingTodayBerichte.map((b) => {
      const startRaw = (b.arbeitsbeginn || b.ankunft_zeit || "").substring(0, 5);
      let pauseMin = 0;
      if (b.pause_von && b.pause_bis) {
        const [pvh, pvm] = b.pause_von.split(":").map(Number);
        const [pbh, pbm] = b.pause_bis.split(":").map(Number);
        pauseMin = Math.max(0, (pbh * 60 + pbm) - (pvh * 60 + pvm));
      }
      const computed = startRaw && b.total_stunden > 0
        ? computeAbfahrt(startRaw, b.total_stunden, pauseMin)
        : (b.abfahrt_zeit ? b.abfahrt_zeit.substring(0, 5) : "");
      return { computed };
    });

    // Späteste Endzeit aus Berichten ODER Teil-Absenzen (z.B. Arzt 07:00-09:00).
    // LB soll danach beginnen.
    const lastEnd = [
      ...withComputed.map((x) => x.computed),
      ...partialAbsenceEnds,
    ]
      .filter((x) => x)
      .sort((a, b) => b.localeCompare(a))[0];

    if (lastEnd) {
      setArbeitsbeginn(lastEnd);
      setAnkunftZeit(lastEnd);
    }

    // Auto-Detect: wurde in einem anderen Bericht des Tages bereits eine Pause gebucht?
    // Dann diesen Bericht ohne Pause-Abzug speichern (Pause wird nur einmal pro Tag gezogen).
    const anyHasPause = existingTodayBerichte.some(
      (b) => !!b.pause_von && !!b.pause_bis
    );
    if (anyHasPause) {
      setKeinePause(true);
      setPauseVon("12:00");
      setPauseBis("12:30");
    } else {
      setKeinePause(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingTodayBerichte.length, editingBerichtId, partialAbsenceEnds.length]);

  // -------------------------------------------------------------------------
  // Role check
  // -------------------------------------------------------------------------
  useEffect(() => {
    const checkRole = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        navigate("/auth");
        return;
      }
      setCurrentUserId(user.id);

      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .single();

      const role = data?.role as string | undefined;
      setIsAdmin(role === "administrator");
      setIsExtern(role === "extern");
      // Nur Mitarbeiter ist self-only. Extern darf jetzt auch Mitarbeiter im
      // Leistungsbericht hinzufügen (User-Wunsch).
      setIsSelfOnly(role === "mitarbeiter");
      setLoading(false);
    };
    checkRole();
  }, []);

  // -------------------------------------------------------------------------
  // Load projects & profiles
  // -------------------------------------------------------------------------
  const loadData = useCallback(async () => {
    const [projectsRes, profilesRes, templatesRes] = await Promise.all([
      supabase
        .from("projects")
        .select("id, name, plz, adresse, status")
        .in("status", ["aktiv", "in_planung"])
        .order("name"),
      supabase
        .from("profiles")
        .select("id, vorname, nachname, is_hidden")
        .eq("is_active", true)
        .order("nachname"),
      supabase
        .from("taetigkeit_templates" as any)
        .select("bezeichnung, sort_order")
        .eq("is_active", true)
        .order("sort_order"),
    ]);

    // Tätigkeits-Vorlagen
    if (templatesRes.data) {
      setTaetigkeitTemplates(
        (templatesRes.data as any[]).map((t: any) => t.bezeichnung as string)
      );
    }

    if (projectsRes.data) setProjects(projectsRes.data);
    if (profilesRes.data) {
      let filtered: any[];
      if (isSelfOnly && currentUserId) {
        // Mitarbeiter + Extern: darf nur sich selbst eintragen
        filtered = (profilesRes.data as any[]).filter(
          (p: any) => !p.is_hidden && p.id === currentUserId
        );
      } else {
        // Admin/VA/PL: hidden profiles ausblenden, externe MA SIND auswählbar.
        filtered = (profilesRes.data as any[]).filter(
          (p: any) => !p.is_hidden
        );
      }
      setProfiles(filtered as Profile[]);
    }
  }, [isSelfOnly, currentUserId]);

  useEffect(() => {
    if (!loading) loadData();
  }, [loading, loadData]);

  // -------------------------------------------------------------------------
  // Load existing Berichte
  // -------------------------------------------------------------------------
  const loadBerichte = useCallback(async () => {
    if (!currentUserId) return;
    setLoadingBerichte(true);

    const { data, error } = await supabase
      .from("leistungsberichte" as any)
      .select(`
        id,
        datum,
        projekt_id,
        projects:projekt_id ( name )
      `)
      .order("datum", { ascending: false })
      .limit(20);

    if (error) {
      console.error("Error loading Berichte:", error);
      setLoadingBerichte(false);
      return;
    }

    if (!data || data.length === 0) {
      setExistingBerichte([]);
      setLoadingBerichte(false);
      return;
    }

    // Load mitarbeiter counts and total hours for each bericht
    const berichtIds = data.map((b: any) => b.id);
    const { data: mitarbeiterData } = await supabase
      .from("leistungsbericht_mitarbeiter" as any)
      .select("bericht_id, summe_stunden")
      .in("bericht_id", berichtIds);

    const berichte: ExistingBericht[] = data.map((b: any) => {
      const maRows = (mitarbeiterData || []).filter(
        (m: any) => m.bericht_id === b.id
      );
      return {
        id: b.id,
        datum: b.datum,
        projekt_name: b.projects?.name || "–",
        mitarbeiter_count: maRows.length,
        total_stunden: maRows.reduce(
          (s: number, m: any) => s + (m.summe_stunden || 0),
          0
        ),
      };
    });

    setExistingBerichte(berichte);
    setLoadingBerichte(false);
  }, [currentUserId]);

  useEffect(() => {
    if (!loading && currentUserId) loadBerichte();
  }, [loading, currentUserId, loadBerichte]);

  // -------------------------------------------------------------------------
  // Taetigkeiten handlers
  // -------------------------------------------------------------------------
  const updateTaetigkeit = (position: number, bezeichnung: string) => {
    setTaetigkeiten((prev) =>
      prev.map((t) => (t.position === position ? { ...t, bezeichnung } : t))
    );
  };

  // Neue Position immer max+1 (nicht length+1): nach Edit-Load können die
  // Positionen Lücken haben (z.B. 1,2,4) — length+1 würde dann kollidieren
  // und beim Save den UNIQUE-Constraint (bericht_id, position) verletzen.
  const nextFreiePosition = () =>
    Math.max(0, ...taetigkeiten.map((t) => t.position)) + 1;

  const addTaetigkeit = () => {
    if (taetigkeiten.length >= 8) return;
    const nextPos = nextFreiePosition();
    setTaetigkeiten((prev) => [...prev, { position: nextPos, bezeichnung: "" }]);
  };

  const addZulage = (type: "werkstatt" | "schmutz" | "regen") => {
    if (taetigkeiten.length >= 8) return;
    const labels: Record<string, string> = {
      werkstatt: "Werkstatt",
      schmutz: "Schmutzzulage",
      regen: "Regen",
    };
    const nextPos = nextFreiePosition();
    setTaetigkeiten((prev) => [...prev, { position: nextPos, bezeichnung: labels[type], tag: type }]);
  };

  const [showZulageMenu, setShowZulageMenu] = useState(false);

  const removeTaetigkeit = (position: number) => {
    if (taetigkeiten.length <= 1) return;
    setTaetigkeiten((prev) => {
      const filtered = prev.filter((t) => t.position !== position);
      // Re-number positions
      return filtered.map((t, i) => ({ ...t, position: i + 1 }));
    });
    // Clean up stunden in all mitarbeiter rows - re-map positions
    setMitarbeiterRows((prev) =>
      prev.map((row) => {
        const newStunden: Record<number, string | number> = {};
        const oldPositions = taetigkeiten
          .filter((t) => t.position !== position)
          .map((t) => t.position);
        oldPositions.forEach((oldPos, newIdx) => {
          if (row.stunden[oldPos] != null) {
            newStunden[newIdx + 1] = row.stunden[oldPos];
          }
        });
        return { ...row, stunden: newStunden };
      })
    );
  };

  // -------------------------------------------------------------------------
  // Mitarbeiter handlers
  // -------------------------------------------------------------------------
  const updateMitarbeiterField = (
    id: string,
    field: keyof MitarbeiterRow,
    value: any
  ) => {
    // When "gleiche Stunden" is active, sync W/S/R flags (but NOT F) to all rows
    const syncFields: (keyof MitarbeiterRow)[] = [
      "istWerkstatt",
      "schmutzzulage",
      "regenSchicht",
      "werkstattStunden",
      "schmutzzulageStunden",
      "regenStunden",
    ];
    if (gleicheStundenFuerAlle && syncFields.includes(field)) {
      setMitarbeiterRows((prev) =>
        prev.map((r) => ({ ...r, [field]: value }))
      );
    } else {
      setMitarbeiterRows((prev) =>
        prev.map((r) => (r.id === id ? { ...r, [field]: value } : r))
      );
    }
  };

  const updateMitarbeiterStunden = (
    id: string,
    position: number,
    value: number | string
  ) => {
    setMitarbeiterRows((prev) => {
      if (gleicheStundenFuerAlle) {
        // Apply the same hours value to ALL rows for this position
        return prev.map((r) => ({
          ...r,
          stunden: { ...r.stunden, [position]: value },
        }));
      }
      return prev.map((r) =>
        r.id === id
          ? { ...r, stunden: { ...r.stunden, [position]: value } }
          : r
      );
    });
  };

  const addMitarbeiter = () => {
    setMitarbeiterRows((prev) => [...prev, createEmptyMitarbeiterRow()]);
  };

  const openMitarbeiterDialog = () => {
    setSelectedNewMitarbeiter(new Set());
    setShowMitarbeiterDialog(true);
  };

  const handleAddSelectedMitarbeiter = () => {
    if (selectedNewMitarbeiter.size === 0) {
      setShowMitarbeiterDialog(false);
      return;
    }
    setMitarbeiterRows((prev) => {
      // Remove the initial empty row if it exists and has no mitarbeiterId
      const cleaned = prev.filter((r) => r.mitarbeiterId !== "");
      // If "gleiche Stunden" is active, copy first row's stunden to new rows
      const firstStunden = gleicheStundenFuerAlle && cleaned.length > 0
        ? { ...cleaned[0].stunden }
        : { 1: ruestzeitStunden };
      const newRows: MitarbeiterRow[] = Array.from(selectedNewMitarbeiter).map(
        (profileId) => ({
          ...createEmptyMitarbeiterRow(),
          mitarbeiterId: profileId,
          stunden: { ...firstStunden },
        })
      );
      return [...cleaned, ...newRows];
    });
    setShowMitarbeiterDialog(false);
  };

  const alreadyAddedMitarbeiterIds = useMemo(
    () => new Set(mitarbeiterRows.filter((r) => r.mitarbeiterId).map((r) => r.mitarbeiterId)),
    [mitarbeiterRows]
  );

  const removeMitarbeiter = (id: string) => {
    if (mitarbeiterRows.length <= 1) return;
    setMitarbeiterRows((prev) => prev.filter((r) => r.id !== id));
  };

  // Neues Projekt erstellen
  const handleCreateProject = async () => {
    if (!newProjectName.trim()) {
      toast({ variant: "destructive", title: "Projektname ist Pflicht" });
      return;
    }
    if (!newProjectPlz.match(/^\d{4,5}$/)) {
      toast({ variant: "destructive", title: "PLZ muss 4-5 Ziffern haben" });
      return;
    }
    setCreatingProject(true);
    try {
      const { data, error } = await supabase
        .from("projects")
        .insert({
          name: newProjectName.trim(),
          plz: newProjectPlz.trim(),
          adresse: newProjectAdresse.trim() || null,
          status: "aktiv",
        })
        .select("id, name, plz, adresse, status")
        .single();
      if (error) throw error;
      if (data) {
        setProjects((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
        setProjektId(data.id);
        toast({ title: "Projekt erstellt" });
      }
      setShowNewProjectDialog(false);
      setNewProjectName("");
      setNewProjectPlz("");
      setNewProjectAdresse("");
    } catch (err: any) {
      toast({ variant: "destructive", title: "Fehler", description: err.message });
    } finally {
      setCreatingProject(false);
    }
  };

  // Schmutzzulage for all toggle
  useEffect(() => {
    setMitarbeiterRows((prev) =>
      prev.map((r) => ({ ...r, schmutzzulage: schmutzzulageAlle }))
    );
  }, [schmutzzulageAlle]);

  // Regen for all toggle
  useEffect(() => {
    setMitarbeiterRows((prev) =>
      prev.map((r) => ({ ...r, regenSchicht: regenSchichtAlle }))
    );
  }, [regenSchichtAlle]);

  // When "gleiche Stunden" is activated, copy first row's stunden to all others
  useEffect(() => {
    if (gleicheStundenFuerAlle) {
      setMitarbeiterRows((prev) => {
        if (prev.length <= 1) return prev;
        const firstStunden = prev[0].stunden;
        return prev.map((r, i) => i === 0 ? r : { ...r, stunden: { ...firstStunden } });
      });
    }
  }, [gleicheStundenFuerAlle]);

  // Auto-select current user as first mitarbeiter
  useEffect(() => {
    if (currentUserId && profiles.length > 0 && !editingBerichtId) {
      setMitarbeiterRows((prev) => {
        if (prev.length === 1 && !prev[0].mitarbeiterId) {
          return [{ ...prev[0], mitarbeiterId: currentUserId }];
        }
        return prev;
      });
    }
  }, [currentUserId, profiles, editingBerichtId]);

  // Load Bericht for editing when ?edit=<id> URL param present
  useEffect(() => {
    const editId = searchParams.get("edit");
    if (editId && currentUserId && profiles.length > 0 && editingBerichtId !== editId) {
      loadBericht(editId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, currentUserId, profiles]);

  // -------------------------------------------------------------------------
  // Build Taetigkeiten display list (with auto-filled positions)
  // -------------------------------------------------------------------------
  const displayTaetigkeiten = useMemo(() => {
    return taetigkeiten.map((t) => {
      if (t.position === 1) {
        return { ...t, bezeichnung: t.bezeichnung || pos1Text, isAuto: !t.bezeichnung };
      }
      return { ...t, isAuto: false };
    });
  }, [taetigkeiten, pos1Text]);

  // -------------------------------------------------------------------------
  // Validate
  // -------------------------------------------------------------------------
  const validate = (): string | null => {
    if (!projektId) return "Bitte ein Projekt auswählen.";
    if (!datum) return "Bitte ein Datum eingeben.";
    if (!ankunftZeit) return "Ankunftszeit ist erforderlich.";

    // Pause-Validation: nur wenn beide Zeiten gesetzt sind
    if (pauseVon && pauseBis) {
      if (pauseBis <= pauseVon) return "Pause-Ende muss nach Pause-Start liegen.";
    } else if (pauseVon || pauseBis) {
      return "Pause: bitte beide Zeiten (von und bis) eingeben oder beide leer lassen.";
    }

    const activeTaetigkeiten = taetigkeiten.filter((t) => t.bezeichnung.trim());
    if (activeTaetigkeiten.length === 0 && !pos1Text) {
      return "Mindestens eine Tätigkeit ist erforderlich.";
    }

    const activeMitarbeiter = mitarbeiterRows.filter((r) => r.mitarbeiterId);
    if (activeMitarbeiter.length === 0) {
      return "Mindestens ein Mitarbeiter ist erforderlich.";
    }

    // Check for duplicate mitarbeiter
    const ids = activeMitarbeiter.map((r) => r.mitarbeiterId);
    if (new Set(ids).size !== ids.length) {
      return "Jeder Mitarbeiter darf nur einmal vorkommen.";
    }

    // Stunden in Zeilen OHNE Tätigkeits-Text blockieren. Sonst landen die
    // Stunden beim Speichern auf der falschen Zeile (Pause-Kollision) oder
    // verschwinden aus der Berichts-Matrix (Phantom-Stunden) — beides hat
    // real zu falschen Berichten geführt (Benda 06/2026).
    const benanntePositionen = new Set(
      taetigkeiten
        .filter((t) => t.position === 1 || t.bezeichnung.trim())
        .map((t) => t.position)
    );
    for (const r of activeMitarbeiter) {
      for (const [posStr, rawH] of Object.entries(r.stunden)) {
        const pos = Number(posStr);
        const h = parseStunden(rawH);
        if (h > 0 && !benanntePositionen.has(pos)) {
          const maName = profiles.find((p) => p.id === r.mitarbeiterId);
          const name = maName ? `${maName.vorname} ${maName.nachname}` : "Ein Mitarbeiter";
          return `${name} hat ${h}h in Zeile ${pos} eingetragen, aber Zeile ${pos} hat keine Tätigkeits-Bezeichnung. Bitte Tätigkeit eintragen oder Stunden entfernen.`;
        }
      }
    }

    return null;
  };

  // -------------------------------------------------------------------------
  // Save
  // -------------------------------------------------------------------------

  // Wraps the actual save with pre-checks. Pre-Checks open ConfirmDialog;
  // bei Bestätigung wird doSave() mit cleanup-Optionen aufgerufen.
  const handleSave = async () => {
    const errorMsg = validate();
    if (errorMsg) {
      toast({ variant: "destructive", title: "Fehler", description: errorMsg });
      return;
    }

    const activeMaIds = mitarbeiterRows.filter(r => r.mitarbeiterId).map(r => r.mitarbeiterId);

    // Pre-Check: Sind aktive MA bereits in einem ANDEREN Leistungsbericht für das GLEICHE Projekt
    // am gleichen Datum? (Multi-Bericht für verschiedene Projekte am gleichen Tag = OK, kein Konflikt)
    if (activeMaIds.length > 0 && projektId) {
      let mlbQuery = supabase
        .from("leistungsbericht_mitarbeiter" as any)
        .select("mitarbeiter_id, bericht_id, summe_stunden, leistungsberichte!inner(id, datum, projekt_id, erstellt_von)")
        .in("mitarbeiter_id", activeMaIds)
        .eq("leistungsberichte.datum" as any, datum)
        .eq("leistungsberichte.projekt_id" as any, projektId);

      if (editingBerichtId) {
        mlbQuery = mlbQuery.neq("bericht_id", editingBerichtId);
      }

      const { data: conflictMA } = await mlbQuery;

      if (conflictMA && (conflictMA as any[]).length > 0) {
        // Profile + Ersteller-Name für die Konflikt-Liste laden
        const erstellerIds = [...new Set((conflictMA as any[]).map((m: any) => m.leistungsberichte?.erstellt_von).filter(Boolean))];
        const { data: erstellerProfiles } = await supabase
          .from("profiles")
          .select("id, vorname, nachname")
          .in("id", erstellerIds);
        const erstellerMap: Record<string, string> = {};
        (erstellerProfiles || []).forEach((p: any) => {
          erstellerMap[p.id] = `${p.vorname} ${p.nachname}`;
        });

        const details = (conflictMA as any[]).map((m: any) => {
          const p = profiles.find(pr => pr.id === m.mitarbeiter_id);
          const name = p ? `${p.vorname} ${p.nachname}` : "?";
          const erstellt = erstellerMap[m.leistungsberichte?.erstellt_von] || "Unbekannt";
          return `${name}: ${m.summe_stunden ?? "?"}h (Bericht von ${erstellt})`;
        });
        const uniqueDetails = [...new Set(details)];
        const conflictMaIds = [...new Set((conflictMA as any[]).map((m: any) => m.mitarbeiter_id))];
        setConfirmState({
          title: "Mitarbeiter bereits in anderem Bericht",
          description: `Am ${datum} sind folgende Mitarbeiter bereits in einem anderen Leistungsbericht erfasst. Bei Fortfahren werden die Einträge dort entfernt:`,
          details: uniqueDetails,
          actionLabel: "Überschreiben & speichern",
          variant: "destructive",
          onConfirm: () => doSave({ cleanupBeforeInsert: true, activeMaIdsForCleanup: conflictMaIds }),
        });
        return;
      }
    }

    // Pre-Check 2 (nur NEW-Mode): Existiert bereits ein Bericht (User, Projekt, Datum)?
    if (!editingBerichtId && currentUserId && projektId) {
      const { data: existingBericht } = await supabase
        .from("leistungsberichte" as any)
        .select("id")
        .eq("erstellt_von", currentUserId)
        .eq("projekt_id", projektId)
        .eq("datum", datum)
        .maybeSingle();

      if ((existingBericht as any)?.id) {
        const existingId = (existingBericht as any).id;
        setConfirmState({
          title: "Bericht existiert bereits",
          description: `Du hast für dieses Projekt am ${datum} bereits einen Leistungsbericht. Möchtest du den bestehenden Bericht bearbeiten?`,
          actionLabel: "Bestehenden bearbeiten",
          onConfirm: () => loadBericht(existingId),
        });
        return;
      }
    }

    // Pre-Check 3: Sind MA am gleichen Tag in ANDEREN Berichten gebucht
    // (anderes Projekt, Werkstatt- oder LKW-Bericht — egal welcher Ersteller)?
    // Verhindert versehentliche Doppelbuchungen über Bericht-Typen hinweg
    // (Ursache der 16/18h-Tage). Bewusstes Fortfahren bleibt möglich.
    const pauseHoursPre = pauseMinuten / 60;
    const maMitStunden = mitarbeiterRows
      .filter((r) => r.mitarbeiterId)
      .map((r) => {
        const gross = sumStunden(r, zulagePositions);
        const netto = matrixBrutto ? Math.max(0, gross - pauseHoursPre) : gross;
        const p = profiles.find((pr) => pr.id === r.mitarbeiterId);
        return {
          id: r.mitarbeiterId,
          name: p ? `${p.vorname} ${p.nachname}` : "?",
          stunden: Math.round(netto * 100) / 100,
        };
      });
    const tagesKonflikte = await findeTagesKonflikte(
      datum,
      maMitStunden,
      editingBerichtId,
      projektId // gleiche-Projekt-Konflikte behandelt Pre-Check 1
    );
    if (tagesKonflikte.length > 0) {
      const sehrHoch = tagesKonflikte.some((k) => k.gesamt > 12);
      setConfirmState({
        title: sehrHoch ? "⚠ Achtung: sehr hohe Tagessumme!" : "Mitarbeiter bereits am gleichen Tag gebucht",
        description: `Folgende Mitarbeiter haben am ${format(new Date(datum + "T00:00:00"), "dd.MM.yyyy")} bereits Stunden in anderen Berichten. Mit diesem Bericht zusammen ergibt das:`,
        details: tagesKonflikte.map(
          (k) => `${k.mitarbeiterName}: ${String(k.bestehendeStunden).replace(".", ",")}h bestehend (${k.details.join("; ")}) + ${String(k.neueStunden).replace(".", ",")}h neu = ${String(k.gesamt).replace(".", ",")}h gesamt${k.gesamt > 12 ? " ⚠" : ""}`
        ),
        actionLabel: "Trotzdem speichern",
        variant: sehrHoch ? "destructive" : undefined,
        onConfirm: () => doSave({ cleanupBeforeInsert: false, activeMaIdsForCleanup: [] }),
      });
      return;
    }

    // Keine Konflikte → direkt speichern
    await doSave({ cleanupBeforeInsert: false, activeMaIdsForCleanup: [] });
  };

  // Helper: führt den eigentlichen Save (DELETE-bei-Edit + INSERT) aus
  const doSave = async (opts: { cleanupBeforeInsert: boolean; activeMaIdsForCleanup: string[] }) => {
    const { cleanupBeforeInsert, activeMaIdsForCleanup } = opts;
    setSaving(true);
    try {
      // erstellt_von bleibt beim Edit der Original-Ersteller (Admin/PL editieren
      // fremde Berichte — der Bericht darf dabei nicht den Besitzer wechseln,
      // sonst kollidiert der Re-Insert mit einem eigenen Bericht des Editors).
      const erstelltVonForSave = (editingBerichtId && originalErstelltVon) || currentUserId;

      // If editing, delete old records first
      if (editingBerichtId) {
        // SICHERHEITS-CHECK VOR dem Löschen: existiert bereits ein ANDERER
        // Bericht desselben Erstellers für (Projekt, Datum)? Dann würde der
        // Re-Insert am UNIQUE-Constraint scheitern, NACHDEM der alte Bericht
        // schon gelöscht wäre → Totalverlust. Lieber vorher abbrechen.
        const { data: dupCheck } = await supabase
          .from("leistungsberichte" as any)
          .select("id")
          .eq("erstellt_von", erstelltVonForSave)
          .eq("datum", datum)
          .eq("projekt_id", projektId)
          .neq("id", editingBerichtId)
          .maybeSingle();
        if (dupCheck) {
          toast({
            variant: "destructive",
            title: "Speichern nicht möglich",
            description: "Für dieses Projekt und Datum existiert bereits ein anderer Bericht desselben Erstellers. Bitte zuerst den anderen Bericht löschen oder Datum/Projekt anpassen.",
          });
          setSaving(false);
          return;
        }

        // time_entries ZUERST über die exakte Bericht-Verknüpfung löschen —
        // trifft garantiert nur die Einträge DIESES Berichts (auch wenn der
        // User MA entfernt oder Datum/Projekt geändert hat).
        const { error: teByBerichtErr } = await supabase
          .from("time_entries")
          .delete()
          .eq("bericht_id", editingBerichtId);
        if (teByBerichtErr) throw teByBerichtErr;

        // Legacy-Fallback: Alt-Berichte (vor Einführung von bericht_id) haben
        // time_entries ohne Verknüpfung — für die greift die alte Heuristik
        // (NUR Einträge ohne bericht_id, damit fremde Berichte sicher sind).
        // WICHTIG: gegen die ORIGINAL-Werte des geladenen Berichts laufen
        // (Datum/Projekt/MA-Union) — der User kann im Edit alles geändert haben.
        const editMaIds = Array.from(new Set([
          ...originalMaIds,
          ...mitarbeiterRows.filter((r) => r.mitarbeiterId).map((r) => r.mitarbeiterId),
        ]));
        const legacyDatum = originalDatum || datum;
        const legacyProjektId = originalProjektId || projektId;
        if (editMaIds.length > 0 && legacyProjektId) {
          await (supabase
            .from("time_entries")
            .delete()
            .is("bericht_id", null)
            .eq("datum", legacyDatum)
            .eq("project_id", legacyProjektId)
            .eq("entry_typ", "leistungsbericht")
            .in("user_id", editMaIds) as any)
            .not("taetigkeit", "in", '("Urlaub","Krankenstand","Fortbildung","Feiertag","Schule","Weiterbildung","ZA","Zeitausgleich","Arzt","Sonstiges")');
        }

        // Bericht-Kind-Tabellen + Bericht selbst löschen
        await supabase
          .from("leistungsbericht_stunden" as any)
          .delete()
          .eq("bericht_id", editingBerichtId);
        await supabase
          .from("leistungsbericht_mitarbeiter" as any)
          .delete()
          .eq("bericht_id", editingBerichtId);
        await supabase
          .from("leistungsbericht_taetigkeiten" as any)
          .delete()
          .eq("bericht_id", editingBerichtId);
        await supabase
          .from("leistungsbericht_geraete" as any)
          .delete()
          .eq("bericht_id", editingBerichtId);
        await supabase
          .from("leistungsbericht_materialien" as any)
          .delete()
          .eq("bericht_id", editingBerichtId);

        const { error: berichtDelErr } = await supabase
          .from("leistungsberichte" as any)
          .delete()
          .eq("id", editingBerichtId);
        if (berichtDelErr) throw berichtDelErr;
      }

      // Cleanup: Wenn der User "Überschreiben" gewählt hat (NEW-Modus mit existing entries),
      // alte Daten der betroffenen Mitarbeiter sauber entfernen.
      if (cleanupBeforeInsert && activeMaIdsForCleanup.length > 0) {
        // 2. Finde andere Leistungsberichte am gleichen Datum + GLEICHEM Projekt
        // mit den betroffenen Mitarbeitern (Multi-Bericht für anderes Projekt = OK, nicht aufräumen)
        const { data: overlappingMA, error: overlapErr } = await supabase
          .from("leistungsbericht_mitarbeiter" as any)
          .select("id, bericht_id, mitarbeiter_id, leistungsberichte!inner(id, datum, projekt_id)")
          .in("mitarbeiter_id", activeMaIdsForCleanup)
          .eq("leistungsberichte.datum" as any, datum)
          .eq("leistungsberichte.projekt_id" as any, projektId);
        if (overlapErr) throw overlapErr;

        const otherBerichtIds = new Set<string>();
        const otherMaRowIds: string[] = [];
        for (const om of (overlappingMA as any[]) || []) {
          otherBerichtIds.add(om.bericht_id);
          otherMaRowIds.push(om.id);
        }

        // 1. Lösche time_entries der betroffenen MA — exakt über die Bericht-
        // Verknüpfung der ÜBERLAPPENDEN Berichte (nie fremde Berichte) plus
        // Legacy-Einträge ohne Verknüpfung (alte Heuristik, nur bericht_id IS NULL).
        if (otherBerichtIds.size > 0) {
          await supabase
            .from("time_entries")
            .delete()
            .in("bericht_id", Array.from(otherBerichtIds))
            .in("user_id", activeMaIdsForCleanup);
        }
        await (supabase
          .from("time_entries")
          .delete()
          .is("bericht_id", null)
          .eq("datum", datum)
          .eq("project_id", projektId)
          .eq("entry_typ", "leistungsbericht")
          .in("user_id", activeMaIdsForCleanup) as any)
          .not("taetigkeit", "in", '("Urlaub","Krankenstand","Fortbildung","Feiertag","Schule","Weiterbildung","ZA","Zeitausgleich","Arzt","Sonstiges")');

        // 3. Lösche leistungsbericht_stunden für die betroffenen MA in den anderen Berichten
        if (otherBerichtIds.size > 0 && activeMaIdsForCleanup.length > 0) {
          await supabase
            .from("leistungsbericht_stunden" as any)
            .delete()
            .in("bericht_id", Array.from(otherBerichtIds))
            .in("mitarbeiter_id", activeMaIdsForCleanup);
        }

        // 4. Lösche die leistungsbericht_mitarbeiter Zeilen selbst
        if (otherMaRowIds.length > 0) {
          await supabase
            .from("leistungsbericht_mitarbeiter" as any)
            .delete()
            .in("id", otherMaRowIds);
        }

        // 5. Lösche jetzt-leere Berichte (keine Mitarbeiter mehr)
        for (const bid of otherBerichtIds) {
          const { count } = await supabase
            .from("leistungsbericht_mitarbeiter" as any)
            .select("id", { count: "exact", head: true })
            .eq("bericht_id", bid);
          if ((count ?? 0) === 0) {
            // Bericht hat keine Mitarbeiter mehr → komplett aufräumen
            // (Bericht-Delete räumt verknüpfte time_entries per FK CASCADE mit)
            await supabase.from("leistungsbericht_taetigkeiten" as any).delete().eq("bericht_id", bid);
            await supabase.from("leistungsbericht_geraete" as any).delete().eq("bericht_id", bid);
            await supabase.from("leistungsbericht_materialien" as any).delete().eq("bericht_id", bid);
            await supabase.from("leistungsberichte" as any).delete().eq("id", bid);
          }
        }
      }

      // Schutz-Schicht gegen verwaiste Alt-time_entries (ohne Bericht-Verknüpfung):
      // NUR Einträge mit bericht_id IS NULL anfassen — Einträge die zu einem
      // existierenden Bericht gehören, sind über die Verknüpfung geschützt und
      // werden hier nie gelöscht (vorher konnten sich Mehrfach-Berichte am selben
      // Tag gegenseitig die time_entries wegnehmen).
      const orphanCleanupMaIds = mitarbeiterRows.filter((r) => r.mitarbeiterId).map((r) => r.mitarbeiterId);
      if (orphanCleanupMaIds.length > 0 && projektId) {
        await (supabase
          .from("time_entries")
          .delete()
          .is("bericht_id", null)
          .eq("datum", datum)
          .eq("entry_typ", "leistungsbericht")
          .eq("project_id", projektId)
          .in("user_id", orphanCleanupMaIds) as any)
          .not("taetigkeit", "in", '("Urlaub","Krankenstand","Fortbildung","Feiertag","Schule","Weiterbildung","ZA","Zeitausgleich","Arzt","Sonstiges")');
      }

      // 1. Create Leistungsbericht
      // Abfahrt direkt berechnen aus echten Werten (nicht aus State, der ggf. veraltet ist)
      // Maximale Mitarbeiter-Stunden (für abfahrt-Berechnung).
      // Bei matrix_brutto=true: Eingabe ist brutto; Netto = max(0, gross - pause).
      // Bei matrix_brutto=false (legacy): Eingabe ist netto; max = sum direkt.
      const pauseHoursForSave = pauseMinuten / 60;
      const maxStundenForSave = Math.max(
        0,
        ...mitarbeiterRows.filter((r) => r.mitarbeiterId).map((r) => {
          const gross = sumStunden(r);
          return matrixBrutto ? Math.max(0, gross - pauseHoursForSave) : gross;
        })
      );
      const computedAbfahrt = arbeitsbeginn && maxStundenForSave > 0
        ? computeAbfahrt(arbeitsbeginn, maxStundenForSave, pauseMinuten)
        : abfahrtZeit;

      const { data: berichtData, error: berichtError } = await supabase
        .from("leistungsberichte" as any)
        .insert({
          erstellt_von: erstelltVonForSave,
          projekt_id: projektId,
          datum,
          objekt: objekt || null,
          arbeitsbeginn: arbeitsbeginn || null,
          ankunft_zeit: ankunftZeit,
          abfahrt_zeit: computedAbfahrt || abfahrtZeit,
          pause_von: keinePause ? null : (pauseVon || null),
          pause_bis: keinePause ? null : (pauseBis || null),
          pause_minuten: pauseMinuten,
          anmerkungen: anmerkungen || null,
          fertiggestellt,
          schmutzzulage_alle: schmutzzulageAlle,
          regen_schicht_alle: regenSchichtAlle,
          matrix_brutto: matrixBrutto,
        })
        .select("id")
        .single();

      if (berichtError) throw berichtError;
      const berichtId = (berichtData as any).id;

      // Rollback-Helfer: räumt bei Fehlern in Folge-Schritten den halben
      // Bericht weg, damit kein Bericht ohne time_entries stehen bleibt.
      const rollbackBericht = async () => {
        try {
          await supabase.from("leistungsbericht_stunden" as any).delete().eq("bericht_id", berichtId);
          await supabase.from("leistungsbericht_mitarbeiter" as any).delete().eq("bericht_id", berichtId);
          await supabase.from("leistungsbericht_taetigkeiten" as any).delete().eq("bericht_id", berichtId);
          await supabase.from("leistungsberichte" as any).delete().eq("id", berichtId);
        } catch {
          // best-effort
        }
      };

      // 2. Build final taetigkeiten list with auto-fills
      const finalTaetigkeiten: { position: number; bezeichnung: string; tag?: string }[] = [];
      for (const t of taetigkeiten) {
        const bez = t.position === 1
          ? pos1Text
          : t.bezeichnung.trim();
        if (bez) {
          finalTaetigkeiten.push({ position: t.position, bezeichnung: bez, tag: t.tag });
        }
      }

      // Add Pause position — IMMER größer als jede existierende Matrix-Position,
      // sonst kollidiert die Pause-Zeile mit Stunden einer (ggf. unbenannten)
      // Tätigkeits-Zeile und die Stunden landen auf "Pause" (Benda-Bug 06/2026).
      const maxPos = Math.max(0, ...taetigkeiten.map((t) => t.position));
      const pausePos = maxPos + 1;
      finalTaetigkeiten.push({ position: pausePos, bezeichnung: pauseText });

      // 3. Create taetigkeiten records (with tag)
      const { data: taetigkeitenData, error: taetigkeitenError } = await supabase
        .from("leistungsbericht_taetigkeiten" as any)
        .insert(
          finalTaetigkeiten.map((t) => ({
            bericht_id: berichtId,
            position: t.position,
            bezeichnung: t.bezeichnung,
            tag: t.tag || null,
          }))
        )
        .select("id, position");

      if (taetigkeitenError) { await rollbackBericht(); throw taetigkeitenError; }

      // Map position -> taetigkeit DB id
      const positionToTaetigkeitId: Record<number, string> = {};
      for (const t of (taetigkeitenData as any[]) || []) {
        positionToTaetigkeitId[t.position] = t.id;
      }

      // 4. Create mitarbeiter records - compute W/SCH/R flags from tagged activities
      const activeMitarbeiter = mitarbeiterRows.filter((r) => r.mitarbeiterId);

      // Build tag-to-positions map
      const tagPositions: Record<string, number[]> = {};
      for (const t of taetigkeiten) {
        if (t.tag) {
          if (!tagPositions[t.tag]) tagPositions[t.tag] = [];
          tagPositions[t.tag].push(t.position);
        }
      }

      const mitarbeiterInserts = activeMitarbeiter.map((r) => {
        // Calculate hours per tag from the stunden matrix
        let werkstattH = 0, schmutzH = 0, regenH = 0;
        for (const [posStr, rawH] of Object.entries(r.stunden)) {
          const pos = Number(posStr);
          const h = parseStunden(rawH);
          if (h > 0) {
            if (tagPositions.werkstatt?.includes(pos)) werkstattH += h;
            if (tagPositions.schmutz?.includes(pos)) schmutzH += h;
            if (tagPositions.regen?.includes(pos)) regenH += h;
          }
        }

        // summe_stunden = NETTO. Bei matrix_brutto=true: gross - pause; sonst direkt.
        const gross = sumStunden(r, zulagePositions);
        const summeNet = matrixBrutto ? Math.max(0, gross - pauseHoursForSave) : gross;
        return {
          bericht_id: berichtId,
          mitarbeiter_id: r.mitarbeiterId,
          ist_fahrer: r.istFahrer,
          ist_werkstatt: werkstattH > 0,
          schmutzzulage: schmutzH > 0,
          regen_schicht: regenH > 0,
          fahrer_stunden: null,
          werkstatt_stunden: werkstattH > 0 ? werkstattH : null,
          schmutzzulage_stunden: schmutzH > 0 ? schmutzH : null,
          regen_stunden: regenH > 0 ? regenH : null,
          summe_stunden: Math.round(summeNet * 100) / 100,
        };
      });

      const { error: mitarbeiterError } = await supabase
        .from("leistungsbericht_mitarbeiter" as any)
        .insert(mitarbeiterInserts);

      if (mitarbeiterError) { await rollbackBericht(); throw mitarbeiterError; }

      // 5. Create stunden records (matrix entries)
      const stundenInserts: any[] = [];
      for (const row of activeMitarbeiter) {
        for (const [posStr, rawHours] of Object.entries(row.stunden)) {
          const pos = Number(posStr);
          const hours = parseStunden(rawHours);
          if (hours > 0 && positionToTaetigkeitId[pos]) {
            stundenInserts.push({
              bericht_id: berichtId,
              mitarbeiter_id: row.mitarbeiterId,
              taetigkeit_id: positionToTaetigkeitId[pos],
              stunden: hours,
            });
          }
        }
      }

      if (stundenInserts.length > 0) {
        const { error: stundenError } = await supabase
          .from("leistungsbericht_stunden" as any)
          .insert(stundenInserts);

        if (stundenError) { await rollbackBericht(); throw stundenError; }
      }

      // 6. Create time_entries for each mitarbeiter
      const taetigkeitLabels = finalTaetigkeiten
        .filter((t) => !t.bezeichnung.startsWith("Pause"))
        .map((t) => t.bezeichnung);

      const timeEntryInserts = activeMitarbeiter.map((r) => {
        // Build activity description from hours
        const parts: string[] = [];
        for (const [posStr, rawHours] of Object.entries(r.stunden)) {
          const pos = Number(posStr);
          const hours = parseStunden(rawHours);
          if (hours > 0) {
            const tObj = finalTaetigkeiten.find((t) => t.position === pos);
            if (tObj && !tObj.bezeichnung.startsWith("Pause")) {
              parts.push(`${tObj.bezeichnung} (${hours}h)`);
            }
          }
        }

        // time_entries.stunden = NETTO. Bei matrix_brutto=true: gross - pause; sonst direkt.
        const grossEntry = sumStunden(r, zulagePositions);
        const stundenNet = matrixBrutto ? Math.max(0, grossEntry - pauseHoursForSave) : grossEntry;

        return {
          user_id: r.mitarbeiterId,
          project_id: projektId,
          datum,
          stunden: Math.round(stundenNet * 100) / 100,
          taetigkeit: parts.join(", ") || taetigkeitLabels.join(", "),
          // Arbeitsbeginn ist der echte Start der Arbeitszeit (z.B. zuhause / Werkstatt).
          // Nur Fallback auf ankunftZeit wenn arbeitsbeginn leer.
          start_time: arbeitsbeginn || ankunftZeit,
          end_time: computedAbfahrt || abfahrtZeit,
          pause_minutes: pauseMinuten,
          location_type: r.istWerkstatt ? "werkstatt" : "baustelle",
          entry_typ: "leistungsbericht",
          // Exakte Verknüpfung zum Bericht: Edit/Delete treffen damit garantiert
          // nur die eigenen Einträge; Bericht-Delete räumt per FK CASCADE auf.
          bericht_id: berichtId,
        };
      });

      const { error: timeError } = await supabase
        .from("time_entries")
        .insert(timeEntryInserts);

      if (timeError) { await rollbackBericht(); throw timeError; }

      // 7. Save Geräte
      if (geraete.length > 0) {
        const geraeteInserts = geraete
          .filter((g) => g.geraet.trim() && parseFloat(g.stunden) > 0)
          .map((g) => ({
            bericht_id: berichtId,
            geraet: g.geraet.trim(),
            stunden: parseFloat(g.stunden),
          }));
        if (geraeteInserts.length > 0) {
          const { error: geraeteError } = await supabase
            .from("leistungsbericht_geraete" as any)
            .insert(geraeteInserts);
          if (geraeteError) throw geraeteError;
        }
      }

      // 8. Save Materialien
      if (materialien.length > 0) {
        const materialienInserts = materialien
          .filter((m) => m.bezeichnung)
          .map((m) => ({
            bericht_id: berichtId,
            bezeichnung: m.bezeichnung,
            menge: m.menge,
          }));
        if (materialienInserts.length > 0) {
          const { error: materialienError } = await supabase
            .from("leistungsbericht_materialien" as any)
            .insert(materialienInserts);
          if (materialienError) throw materialienError;
        }
      }

      toast({
        title: "Gespeichert",
        description: `Leistungsbericht für ${format(
          new Date(datum),
          "dd.MM.yyyy"
        )} wurde erfolgreich gespeichert.`,
      });

      // Reset form and advance to next working day
      const savedDate = datum;
      resetForm();
      // Set next working day
      const next = new Date(savedDate + "T00:00:00");
      do { next.setDate(next.getDate() + 1); } while (next.getDay() === 0 || next.getDay() === 6);
      setDatum(format(next, "yyyy-MM-dd"));
      loadBerichte();
    } catch (err: any) {
      console.error("Save error:", err);
      toast({
        variant: "destructive",
        title: "Fehler beim Speichern",
        description: err.message || "Unbekannter Fehler",
      });
    } finally {
      setSaving(false);
    }
  };

  // -------------------------------------------------------------------------
  // Reset form
  // -------------------------------------------------------------------------
  const resetForm = () => {
    setEditingBerichtId(null);
    setOriginalMaIds([]);
    setOriginalDatum(null);
    setOriginalProjektId(null);
    setOriginalErstelltVon(null);
    setProjektId("");
    setObjekt("");
    setArbeitsbeginn("06:30");
    setAnkunftZeit("07:00");
    setAbfahrtZeit("16:00");
    setPauseVon("12:00");
    setPauseBis("12:30");
    setKeinePause(false);
    setSchmutzzulageAlle(false);
    setRegenSchichtAlle(false);
    setGeraete([]);
    setMaterialien([]);
    setAnmerkungen("");
    setFertiggestellt(false);
    setTaetigkeiten([
      { position: 1, bezeichnung: "Rüstzeit/Anfahrt, Ankunftszeit Baustelle" },
      { position: 2, bezeichnung: "" },
      { position: 3, bezeichnung: "" },
      { position: 4, bezeichnung: "" },
    ]);
    setMitarbeiterRows([{ ...createEmptyMitarbeiterRow(), mitarbeiterId: currentUserId || "" }]);
    setGleicheStundenFuerAlle(false);
    setMatrixBrutto(true); // neue Berichte: Brutto-Eingabe + Auto-Pause-Abzug
    setDatum(format(new Date(), "yyyy-MM-dd"));
  };

  // -------------------------------------------------------------------------
  // Load existing Bericht for editing
  // -------------------------------------------------------------------------
  const loadBericht = async (id: string) => {
    try {
      const { data: bericht, error } = await supabase
        .from("leistungsberichte" as any)
        .select("*")
        .eq("id", id)
        .single();

      if (error) throw error;
      const b = bericht as any;

      setEditingBerichtId(id);
      setDatum(b.datum);
      setProjektId(b.projekt_id);
      // Original-Snapshot für den Edit-Save (Legacy-Cleanup + erstellt_von)
      setOriginalDatum(b.datum);
      setOriginalProjektId(b.projekt_id);
      setOriginalErstelltVon(b.erstellt_von || null);
      setObjekt(b.objekt || "");
      setArbeitsbeginn(b.arbeitsbeginn || "06:30");
      setAnkunftZeit(b.ankunft_zeit || "07:00");
      setAbfahrtZeit(b.abfahrt_zeit || "16:00");
      setPauseVon(b.pause_von || "12:00");
      setPauseBis(b.pause_bis || "12:30");
      // Bericht wurde mit "Keine Pause" gespeichert (pause_von/bis = null) → Toggle aktivieren
      setKeinePause(!b.pause_von && !b.pause_bis);
      setSchmutzzulageAlle(b.schmutzzulage_alle || false);
      setRegenSchichtAlle(b.regen_schicht_alle || false);
      setAnmerkungen(b.anmerkungen || "");
      setFertiggestellt(b.fertiggestellt || false);
      // Matrix-Konvention aus DB: alte Berichte = false (Netto), neue = true (Brutto).
      setMatrixBrutto(!!b.matrix_brutto);

      // Load taetigkeiten
      const { data: tData } = await supabase
        .from("leistungsbericht_taetigkeiten" as any)
        .select("*")
        .eq("bericht_id", id)
        .order("position");

      if (tData && (tData as any[]).length > 0) {
        // Filter out auto-generated LKW and Pause entries
        const manualT = (tData as any[]).filter(
          (t) =>
            !t.bezeichnung.startsWith("LKW AN+ABFAHRT") &&
            !t.bezeichnung.startsWith("Pause")
        );
        const mapped = manualT.map((t: any) => ({
          position: t.position,
          bezeichnung: t.bezeichnung,
          tag: t.tag || undefined,
        }));
        setTaetigkeiten(
          mapped.length > 0
            ? mapped
            : [{ position: 1, bezeichnung: "Rüstzeit/Anfahrt, Ankunftszeit Baustelle" }]
        );
      }

      // Load mitarbeiter
      const { data: mData } = await supabase
        .from("leistungsbericht_mitarbeiter" as any)
        .select("*")
        .eq("bericht_id", id);

      // Load stunden
      const { data: sData } = await supabase
        .from("leistungsbericht_stunden" as any)
        .select("*")
        .eq("bericht_id", id);

      // Build taetigkeit_id -> position mapping — NUR für die behaltenen
      // (sichtbaren) Tätigkeiten. Alt-Berichte mit dem Pause-Kollisions-Bug
      // haben Stunden auf der ausgefilterten Pause-Zeile; würden wir die in
      // die Matrix laden, hätte der User unsichtbare Stunden, die die
      // Validierung blockieren und beim Re-Save verloren gehen.
      const taetigkeitIdToPos: Record<string, number> = {};
      for (const t of (tData as any[]) || []) {
        const bez = (t.bezeichnung as string) || "";
        if (bez.startsWith("LKW AN+ABFAHRT") || bez.startsWith("Pause")) continue;
        taetigkeitIdToPos[t.id] = t.position;
      }

      if (mData && (mData as any[]).length > 0) {
        const rows: MitarbeiterRow[] = (mData as any[]).map((m: any) => {
          const stundenMap: Record<number, number> = {};
          for (const s of (sData as any[]) || []) {
            if (s.mitarbeiter_id === m.mitarbeiter_id) {
              const pos = taetigkeitIdToPos[s.taetigkeit_id];
              if (pos) stundenMap[pos] = s.stunden;
            }
          }
          return {
            id: crypto.randomUUID(),
            mitarbeiterId: m.mitarbeiter_id,
            istFahrer: m.ist_fahrer || false,
            istWerkstatt: m.ist_werkstatt || false,
            schmutzzulage: m.schmutzzulage || false,
            regenSchicht: m.regen_schicht || false,
            fahrerStunden: m.fahrer_stunden != null ? String(m.fahrer_stunden) : "",
            werkstattStunden: m.werkstatt_stunden != null ? String(m.werkstatt_stunden) : "",
            schmutzzulageStunden: m.schmutzzulage_stunden != null ? String(m.schmutzzulage_stunden) : "",
            regenStunden: m.regen_stunden != null ? String(m.regen_stunden) : "",
            stunden: stundenMap,
          };
        });
        setMitarbeiterRows(rows);
        setOriginalMaIds(rows.map(r => r.mitarbeiterId).filter(Boolean));
      }

      // Load geraete
      const { data: geraeteData } = await supabase
        .from("leistungsbericht_geraete" as any)
        .select("*")
        .eq("bericht_id", id);

      if (geraeteData && (geraeteData as any[]).length > 0) {
        setGeraete(
          (geraeteData as any[]).map((g: any) => ({
            id: crypto.randomUUID(),
            geraet: g.geraet,
            stunden: String(g.stunden),
          }))
        );
      } else {
        setGeraete([]);
      }

      // Load materialien
      const { data: materialienData } = await supabase
        .from("leistungsbericht_materialien" as any)
        .select("*")
        .eq("bericht_id", id);

      if (materialienData && (materialienData as any[]).length > 0) {
        setMaterialien(
          (materialienData as any[]).map((m: any) => ({
            id: crypto.randomUUID(),
            bezeichnung: m.bezeichnung,
            menge: m.menge || "",
          }))
        );
      } else {
        setMaterialien([]);
      }

      // Scroll to top
      window.scrollTo({ top: 0, behavior: "smooth" });

      toast({
        title: "Bericht geladen",
        description: "Der Leistungsbericht wurde zum Bearbeiten geladen.",
      });
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Fehler",
        description: "Bericht konnte nicht geladen werden.",
      });
    }
  };

  // -------------------------------------------------------------------------
  // Delete Bericht
  // -------------------------------------------------------------------------
  const deleteBericht = async (id: string) => {
    if (!confirm("Diesen Leistungsbericht wirklich löschen?")) return;

    try {
      // Legacy-time_entries (ohne bericht_id-Verknüpfung) manuell aufräumen,
      // damit keine Stunden in der Auswertung übrig bleiben. Neue Einträge
      // (mit Verknüpfung) löscht der FK CASCADE beim Bericht-Delete automatisch.
      const { data: berichtData } = await supabase
        .from("leistungsberichte" as any)
        .select("datum, projekt_id, bericht_typ")
        .eq("id", id)
        .maybeSingle();
      const { data: maRows } = await supabase
        .from("leistungsbericht_mitarbeiter" as any)
        .select("mitarbeiter_id")
        .eq("bericht_id", id);
      const b = berichtData as any;
      const maIds = ((maRows as any[]) || []).map((m) => m.mitarbeiter_id).filter(Boolean);
      if (b && maIds.length > 0) {
        let legacyQ: any = supabase
          .from("time_entries")
          .delete()
          .is("bericht_id", null)
          .eq("datum", b.datum)
          .eq("entry_typ", b.bericht_typ || "leistungsbericht")
          .in("user_id", maIds)
          .not("taetigkeit", "in", '("Urlaub","Krankenstand","Fortbildung","Feiertag","Schule","Weiterbildung","ZA","Zeitausgleich","Arzt","Sonstiges")');
        if (b.projekt_id) legacyQ = legacyQ.eq("project_id", b.projekt_id);
        await legacyQ;
      }

      await supabase
        .from("leistungsbericht_stunden" as any)
        .delete()
        .eq("bericht_id", id);
      await supabase
        .from("leistungsbericht_mitarbeiter" as any)
        .delete()
        .eq("bericht_id", id);
      await supabase
        .from("leistungsbericht_taetigkeiten" as any)
        .delete()
        .eq("bericht_id", id);
      await supabase
        .from("leistungsbericht_geraete" as any)
        .delete()
        .eq("bericht_id", id);
      await supabase
        .from("leistungsbericht_materialien" as any)
        .delete()
        .eq("bericht_id", id);
      // Bericht-Delete: FK CASCADE entfernt verknüpfte time_entries automatisch.
      const { error: delErr } = await supabase
        .from("leistungsberichte" as any)
        .delete()
        .eq("id", id);
      if (delErr) throw delErr;

      toast({ title: "Gelöscht", description: "Bericht wurde gelöscht." });
      loadBerichte();

      if (editingBerichtId === id) resetForm();
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Fehler",
        description: "Bericht konnte nicht gelöscht werden.",
      });
    }
  };

  // (Old simple warning removed — the existingTodayBerichte card above shows
  // detailed info with project name, time range and edit button.)

  // Check existing hours for all selected MA
  useEffect(() => {
    const checkMaHours = async () => {
      if (!datum) { setMaExistingHours({}); return; }
      const selectedIds = mitarbeiterRows.filter(r => r.mitarbeiterId && r.mitarbeiterId !== currentUserId).map(r => r.mitarbeiterId);
      if (selectedIds.length === 0) { setMaExistingHours({}); return; }
      // Voll-Absenzen (Urlaub/Krank/Feiertag/etc.) ausschliessen — fuehren zu
      // separater Block-Warnung im LB-Form. Teil-Absenzen (Arzt 2h, ZA-Teilzeit)
      // werden mitgezaehlt, damit der Spielraum-Check korrekt funktioniert
      // (z.B. 2h Arzt + 8h LB = 10h Konflikt).
      const { data } = await supabase
        .from("time_entries")
        .select("user_id, stunden, taetigkeit")
        .eq("datum", datum)
        .in("user_id", selectedIds);
      const hours: Record<string, number> = {};
      for (const e of (data || [])) {
        if (VOLL_ABSENZ_TAETIGKEITEN.includes(e.taetigkeit)) continue;
        hours[e.user_id] = (hours[e.user_id] || 0) + (parseFloat(e.stunden as any) || 0);
      }
      setMaExistingHours(hours);
    };
    checkMaHours();
  }, [datum, mitarbeiterRows, currentUserId]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <PageHeader title="Leistungsbericht" />
        <div className="container mx-auto px-3 sm:px-4 lg:px-6 py-6">
          <p className="text-muted-foreground">Laden...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <PageHeader title="Leistungsbericht" />

      <div className="container mx-auto px-3 sm:px-4 lg:px-6 py-4 sm:py-6 space-y-6 max-w-5xl">
        {/* Edit-Mode Banner */}
        {editingBerichtId && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-700 px-4 py-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm">
              <Save className="h-4 w-4 text-amber-600" />
              <span className="font-medium">Bestehenden Leistungsbericht bearbeiten</span>
              <span className="text-muted-foreground hidden sm:inline">
                — Änderungen werden mit "Bericht aktualisieren" gespeichert
              </span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                resetForm();
                setSearchParams({});
              }}
            >
              Abbrechen
            </Button>
          </div>
        )}

        {/* "Buchungen heute"-Karte (Multi-Bericht-Übersicht) */}
        {(existingTodayBerichte.length > 0 || existingTodayPLStunden > 0) && (
          <Card className="border-blue-200 bg-blue-50/30 dark:bg-blue-950/10 dark:border-blue-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="h-4 w-4 text-blue-600" />
                {editingBerichtId ? "Weitere Buchungen heute" : "Bereits heute gebucht"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {existingTodayBerichte.map((b) => {
                // Start: arbeitsbeginn (echte Anwesenheit ab Werkstatt/zuhause), Fallback ankunft_zeit
                const startRaw = (b.arbeitsbeginn || b.ankunft_zeit || "").substring(0, 5);
                const start = startRaw || "?";

                // Abfahrt: aus arbeitsbeginn + total_stunden + pause berechnen
                let pauseMin = 0;
                if (b.pause_von && b.pause_bis) {
                  const [pvh, pvm] = b.pause_von.split(":").map(Number);
                  const [pbh, pbm] = b.pause_bis.split(":").map(Number);
                  pauseMin = Math.max(0, (pbh * 60 + pbm) - (pvh * 60 + pvm));
                }
                const computed = startRaw && b.total_stunden > 0
                  ? computeAbfahrt(startRaw, b.total_stunden, pauseMin)
                  : "";
                const abfahrt = computed || (b.abfahrt_zeit ? b.abfahrt_zeit.substring(0, 5) : "?");

                // Typ-aware Display + Edit-Routing
                const isLB = b.bericht_typ === "leistungsbericht";
                const isWerk = b.bericht_typ === "werk";
                const isLkw = b.bericht_typ === "lkw";
                const titleLabel = isWerk
                  ? "Leistungsbericht Werkstatt"
                  : isLkw
                    ? "Leistungsbericht LKW"
                    : (b.projekt_name || "Leistungsbericht");
                const editPath = isWerk
                  ? "/werk-bericht"
                  : isLkw
                    ? "/lkw-bericht"
                    : null; // LB: stay on same page
                return (
                  <div
                    key={b.id}
                    className="flex items-center justify-between gap-2 p-2 rounded border bg-card"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate flex items-center gap-2">
                        {!isLB && (
                          <Badge variant="outline" className={isWerk ? "border-amber-300 text-amber-700 bg-amber-50" : "border-orange-300 text-orange-700 bg-orange-50"}>
                            {isWerk ? "Werkstatt" : "LKW"}
                          </Badge>
                        )}
                        <span className="truncate">{titleLabel}</span>
                      </div>
                      <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
                        <span>{start}–{abfahrt}</span>
                        <span>·</span>
                        <span>{b.total_stunden.toFixed(2).replace(".", ",")}h</span>
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        if (editPath) {
                          navigate(`${editPath}?edit=${b.id}`);
                        } else {
                          setSearchParams({ edit: b.id });
                        }
                      }}
                    >
                      <FileText className="h-3.5 w-3.5 mr-1" />
                      Bearbeiten
                    </Button>
                  </div>
                );
              })}
              {existingTodayPLStunden > 0 && (
                <div className="flex items-center justify-between gap-2 p-2 rounded border bg-card">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm flex items-center gap-2">
                      <Badge variant="outline" className="border-purple-300 text-purple-700 bg-purple-50">PL</Badge>
                      <span>Projektleiter-Stunden</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {existingTodayPLStunden.toFixed(2).replace(".", ",")}h gesamt
                    </div>
                  </div>
                </div>
              )}
              <div className="text-xs text-muted-foreground pt-2 border-t space-y-1">
                <div className="flex items-center justify-between flex-wrap gap-1">
                  <span>
                    Gesamt heute (eigene Berichte): <strong className="text-foreground">
                      {existingTodayBerichte.reduce((s, b) => s + b.total_stunden, 0).toFixed(2).replace(".", ",")}h
                    </strong>
                  </span>
                </div>
                {!editingBerichtId && (() => {
                  // Berechne lastEnd aus arbeitsbeginn + total_stunden + pause
                  const ends = existingTodayBerichte.map((b) => {
                    const startRaw = (b.arbeitsbeginn || b.ankunft_zeit || "").substring(0, 5);
                    let pauseMin = 0;
                    if (b.pause_von && b.pause_bis) {
                      const [pvh, pvm] = b.pause_von.split(":").map(Number);
                      const [pbh, pbm] = b.pause_bis.split(":").map(Number);
                      pauseMin = Math.max(0, (pbh * 60 + pbm) - (pvh * 60 + pvm));
                    }
                    return startRaw && b.total_stunden > 0
                      ? computeAbfahrt(startRaw, b.total_stunden, pauseMin)
                      : (b.abfahrt_zeit ? b.abfahrt_zeit.substring(0, 5) : "");
                  }).filter(Boolean).sort((a, b) => b.localeCompare(a));
                  const lastEnd = ends[0];
                  if (lastEnd) {
                    return (
                      <div className="text-blue-700 dark:text-blue-400">
                        ℹ Arbeitsbeginn und Ankunft wurden automatisch auf <strong>{lastEnd}</strong> gesetzt
                        (Endzeit der letzten Buchung). Bei Bedarf manuell anpassen.
                      </div>
                    );
                  }
                  return null;
                })()}
              </div>
            </CardContent>
          </Card>
        )}

        {/* ---------- HEADER ---------- */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <CardTitle className="text-xl sm:text-2xl">
                  Leistungsbericht
                </CardTitle>
                <p className="text-sm text-red-600 font-medium mt-1">
                  Der Leistungsbericht ist täglich abzugeben!
                </p>
              </div>
              <div className="flex items-center gap-2">
                {editingBerichtId && (
                  <Badge variant="secondary" className="text-xs">
                    Bearbeiten
                  </Badge>
                )}
                <Input
                  type="date"
                  value={datum}
                  onChange={(e) => {
                    setDatum(e.target.value);
                    // Reset stunden when date changes (new day = fresh start, keep auto-calculated Rüstzeit für Tätigkeit 1)
                    if (!editingBerichtId) {
                      setMitarbeiterRows((prev) =>
                        prev.map((row) => ({ ...row, stunden: { 1: ruestzeitStunden } }))
                      );
                    }
                  }}
                  className="w-auto"
                />
              </div>
            </div>
          </CardHeader>
        </Card>

        {/* ---------- BAUVORHABEN ---------- */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Bauvorhaben</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Projekt *</Label>
                <div className="flex gap-2">
                  <Select value={projektId} onValueChange={setProjektId}>
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="Projekt auswählen..." />
                    </SelectTrigger>
                    <SelectContent>
                      {projects.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="shrink-0 h-10 w-10"
                    onClick={() => setShowNewProjectDialog(true)}
                    title="Neues Projekt erstellen"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Ort</Label>
                <Input
                  value={
                    selectedProject
                      ? `${selectedProject.plz} ${selectedProject.adresse || ""}`
                      : ""
                  }
                  readOnly
                  className="bg-muted"
                  placeholder="Wird automatisch ausgefüllt"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Objekt</Label>
              <Input
                value={objekt}
                onChange={(e) => setObjekt(e.target.value)}
                placeholder="z.B. Umbau, Fassade, Dachverlängerung..."
              />
            </div>
          </CardContent>
        </Card>

        {/* ---------- ZEITANGABEN ---------- */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Zeitangaben</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="space-y-2">
                <Label>Arbeitsbeginn</Label>
                <Input
                  type="time"
                  value={arbeitsbeginn}
                  onChange={(e) => setArbeitsbeginn(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Ankunft Baustelle</Label>
                <Input
                  type="time"
                  value={ankunftZeit}
                  onChange={(e) => setAnkunftZeit(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Pause von</Label>
                <Input
                  type="time"
                  value={pauseVon}
                  onChange={(e) => setPauseVon(e.target.value)}
                  disabled={keinePause}
                  className={keinePause ? "opacity-50" : ""}
                />
              </div>
              <div className="space-y-2">
                <Label>Pause bis</Label>
                <Input
                  type="time"
                  value={pauseBis}
                  onChange={(e) => setPauseBis(e.target.value)}
                  disabled={keinePause}
                  className={keinePause ? "opacity-50" : ""}
                />
              </div>
            </div>

            <div className="flex items-center gap-3 pt-1">
              <Switch
                id="keine-pause"
                checked={keinePause}
                onCheckedChange={setKeinePause}
              />
              <Label htmlFor="keine-pause" className="cursor-pointer">
                Keine Pause (kein Abzug)
              </Label>
            </div>

            {keinePause && (
              <div className="rounded-md border border-blue-200 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-800 px-3 py-2 text-xs text-blue-900 dark:text-blue-200">
                Diese Buchung enthält keine Pause. Falls du heute schon eine andere Buchung mit Pause angelegt hast, wird die Pause nur einmal abgezogen.
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 items-end">
              <div className="space-y-2">
                <Label>Pause</Label>
                <div className="flex items-center h-10 px-3 rounded-md border bg-muted text-sm">
                  {pauseMinuten} Minuten
                </div>
              </div>
            </div>

          </CardContent>
        </Card>

        {/* ---------- TAETIGKEITEN ---------- */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Tätigkeiten</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {taetigkeiten.map((t) => (
              <div key={t.position} className="flex items-center gap-2">
                <span className="w-8 text-center font-mono text-sm font-bold text-muted-foreground shrink-0">
                  {t.position}.
                </span>
                {t.tag && (
                  <Badge variant="outline" className={cn(
                    "shrink-0 text-[10px] px-1.5",
                    t.tag === "werkstatt" && "border-blue-300 text-blue-700 bg-blue-50",
                    t.tag === "schmutz" && "border-amber-300 text-amber-700 bg-amber-50",
                    t.tag === "regen" && "border-cyan-300 text-cyan-700 bg-cyan-50",
                  )}>
                    {t.tag === "werkstatt" ? "W" : t.tag === "schmutz" ? "SCH" : "R"}
                  </Badge>
                )}
                <Input
                  value={t.bezeichnung}
                  onChange={(e) => updateTaetigkeit(t.position, e.target.value)}
                  placeholder={t.position === 1 ? pos1Text : `Tätigkeit ${t.position}...`}
                  className="flex-1"
                  list={t.position === 1 ? undefined : "taetigkeit-templates"}
                />
                {taetigkeiten.length > 1 && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="shrink-0 h-8 w-8 text-muted-foreground hover:text-destructive"
                    onClick={() => removeTaetigkeit(t.position)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}

            {/* + Zeile Buttons */}
            {taetigkeiten.length < 8 && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="w-8 shrink-0" />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9"
                  onClick={addTaetigkeit}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Tätigkeit
                </Button>
                <div className="relative">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 border-dashed"
                    onClick={() => setShowZulageMenu(!showZulageMenu)}
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Schmutz / Regen / Werkstatt
                  </Button>
                  {showZulageMenu && (
                    <div className="absolute top-full left-0 mt-1 z-50 bg-white border rounded-lg shadow-lg p-1 min-w-[160px]">
                      <button
                        className="w-full text-left px-3 py-2 text-sm rounded hover:bg-muted flex items-center gap-2"
                        onClick={() => { addZulage("werkstatt"); setShowZulageMenu(false); }}
                      >
                        <span className="w-5 text-center font-bold text-blue-600 text-xs">W</span>
                        Werkstatt
                      </button>
                      <button
                        className="w-full text-left px-3 py-2 text-sm rounded hover:bg-muted flex items-center gap-2"
                        onClick={() => { addZulage("schmutz"); setShowZulageMenu(false); }}
                      >
                        <span className="w-5 text-center font-bold text-amber-600 text-xs">SCH</span>
                        Schmutzzulage
                      </button>
                      <button
                        className="w-full text-left px-3 py-2 text-sm rounded hover:bg-muted flex items-center gap-2"
                        onClick={() => { addZulage("regen"); setShowZulageMenu(false); }}
                      >
                        <span className="w-5 text-center font-bold text-cyan-600 text-xs">R</span>
                        Regen
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            <p className="text-xs text-muted-foreground ml-8">
              Schmutzzulage, Regen oder Werkstatt? Bitte über den Button oben hinzufügen — nicht als Tätigkeit reinschreiben.
            </p>

            {/* Auto-displayed Pause info */}
            <div className="flex items-center gap-2 opacity-60">
              <span className="w-8 text-center font-mono text-sm font-bold text-muted-foreground shrink-0">
                +
              </span>
              <div className="flex-1 text-sm px-3 py-2 rounded-md bg-muted border">
                {pauseText}
              </div>
            </div>

            {/* Datalist mit Tätigkeits-Vorlagen (Browser-native, Mobile-friendly) */}
            <datalist id="taetigkeit-templates">
              {taetigkeitTemplates.map((bez) => (
                <option key={bez} value={bez} />
              ))}
            </datalist>
          </CardContent>
        </Card>

        {/* ---------- MITARBEITER & STUNDEN MATRIX ---------- */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg">Mitarbeiter & Stunden</CardTitle>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {(() => {
                    const d = new Date(datum + "T00:00:00");
                    const days = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
                    const isFr = d.getDay() === 5;
                    return `${days[d.getDay()]}, ${d.toLocaleDateString("de-AT")} — Regelarbeitszeit: ${isFr ? "7" : "8"} Stunden`;
                  })()}
                </p>
              </div>
              {!isSelfOnly && (
                <Button variant="outline" size="sm" onClick={openMitarbeiterDialog}>
                  <Plus className="h-4 w-4 mr-1" />
                  Mitarbeiter
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {/* Hinweis: Brutto-Eingabe + Auto-Pause-Abzug (nur bei neuen Berichten) */}
            {matrixBrutto && (
              <div className="mb-3 rounded-md border border-blue-200 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-800 px-3 py-2 text-xs text-blue-900 dark:text-blue-200">
                Stunden inkl. Pause eintragen — die Pause wird automatisch abgezogen.
              </div>
            )}

            {/* Gleiche Stunden toggle - nicht für Mitarbeiter/Extern (eintraegt sich nur selbst) */}
            {!isSelfOnly && (
              <div className="flex items-center gap-3 mb-4">
                <Switch
                  id="gleiche-stunden"
                  checked={gleicheStundenFuerAlle}
                  onCheckedChange={setGleicheStundenFuerAlle}
                />
                <Label htmlFor="gleiche-stunden" className="text-sm cursor-pointer">
                  Stunden für alle Mitarbeiter gleich übernehmen
                </Label>
              </div>
            )}

            {/* ===== MOBILE: Card-Layout (< sm) ===== */}
            <div className="sm:hidden space-y-3">
              {mitarbeiterRows.map((row) => {
                const totalGross = sumStunden(row, zulagePositions);
                const total = matrixBrutto ? Math.max(0, totalGross - pauseMinuten / 60) : totalGross;
                const selectedProfile = profiles.find(p => p.id === row.mitarbeiterId);
                return (
                  <div key={row.id} className="border-2 rounded-xl p-4 bg-card space-y-3">
                    {/* Name prominent + Delete */}
                    <div className="flex items-center gap-2">
                      <Select
                        value={row.mitarbeiterId}
                        onValueChange={(v) => updateMitarbeiterField(row.id, "mitarbeiterId", v)}
                      >
                        <SelectTrigger className="h-11 text-base font-semibold flex-1">
                          <SelectValue placeholder="Mitarbeiter wählen..." />
                        </SelectTrigger>
                        <SelectContent>
                          {profiles.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.nachname} {p.vorname}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {mitarbeiterRows.length > 1 && (
                        <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0 text-muted-foreground hover:text-destructive"
                          onClick={() => removeMitarbeiter(row.id)}>
                          <Trash2 className="h-5 w-5" />
                        </Button>
                      )}
                    </div>
                    {/* Warning if this MA already has hours */}
                    {row.mitarbeiterId && maExistingHours[row.mitarbeiterId] > 0 && (
                      <div className="bg-amber-50 border border-amber-200 rounded px-2 py-1 text-xs text-amber-800">
                        Bereits {maExistingHours[row.mitarbeiterId]}h eingetragen
                      </div>
                    )}

                    {/* Flags: Nur F (Fahrer) als Toggle */}
                    <div className="flex flex-wrap gap-x-4 gap-y-2">
                      <label className="flex items-center gap-2 text-sm font-medium">
                        <Checkbox checked={row.istFahrer} onCheckedChange={(v) => updateMitarbeiterField(row.id, "istFahrer", v === true)} />
                        Fahrer
                      </label>
                    </div>

                    {/* Activities */}
                    <div className="space-y-2">
                      {taetigkeiten.map((t) => (
                        <div key={t.position} className="flex items-center gap-2">
                          <span className="text-sm text-muted-foreground w-5 text-right shrink-0 font-mono">{t.position}.</span>
                          <span className="text-sm flex-1 truncate">
                            {t.bezeichnung || (t.position === 1 ? pos1Text : `Tätigkeit ${t.position}`)}
                          </span>
                          <Input
                            type="number" step="any" min="0" max="24"
                            className="h-10 w-20 text-center text-base font-medium"
                            value={row.stunden[t.position] ?? ""}
                            onChange={(e) => {
                              updateMitarbeiterStunden(row.id, t.position, e.target.value === "" ? "" : e.target.value);
                            }}
                            placeholder="–"
                          />
                        </div>
                      ))}
                    </div>

                    {/* Sum */}
                    <div className={`text-right text-base font-bold rounded-lg px-3 py-2 ${total > 0 ? "bg-green-100 text-green-800" : "bg-muted text-muted-foreground"}`}>
                      {total > 0 ? `Σ ${total.toFixed(1)} Stunden` : "Keine Stunden"}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* ===== DESKTOP: Scrollable matrix table (≥ sm) ===== */}
            <div className="hidden sm:block overflow-x-auto -mx-4 sm:-mx-6 px-4 sm:px-6">
              <table className="w-full text-sm border-collapse min-w-[600px]">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="sticky left-0 z-10 bg-muted/50 text-left px-2 py-2 font-medium whitespace-nowrap min-w-[160px]">
                      Name
                    </th>
                    <th className="px-1 py-2 font-medium text-center min-w-[50px] text-xs">
                      Fahrer
                    </th>
                    {taetigkeiten.map((t) => (
                      <th
                        key={t.position}
                        className={cn(
                          "px-1 py-2 font-medium text-center w-16",
                          t.tag === "werkstatt" && "bg-blue-50",
                          t.tag === "schmutz" && "bg-amber-50",
                          t.tag === "regen" && "bg-cyan-50",
                        )}
                        title={
                          t.bezeichnung ||
                          (t.position === 1 ? pos1Text : `Tätigkeit ${t.position}`)
                        }
                      >
                        <div className="text-xs">{t.position}</div>
                        {t.tag && (
                          <div className={cn(
                            "text-[9px] font-bold",
                            t.tag === "werkstatt" && "text-blue-600",
                            t.tag === "schmutz" && "text-amber-600",
                            t.tag === "regen" && "text-cyan-600",
                          )}>
                            {t.tag === "werkstatt" ? "W" : t.tag === "schmutz" ? "SCH" : "R"}
                          </div>
                        )}
                      </th>
                    ))}
                    <th className="px-2 py-2 font-medium text-center whitespace-nowrap min-w-[80px]">
                      <div>Summe</div>
                      <div className="text-[10px] font-normal text-muted-foreground">
                        Soll: {new Date(datum + "T00:00:00").getDay() === 5 ? "7h" : "8h"}
                      </div>
                    </th>
                    <th className="px-1 py-2 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {mitarbeiterRows.map((row) => {
                    const totalGross = sumStunden(row, zulagePositions);
                const total = matrixBrutto ? Math.max(0, totalGross - pauseMinuten / 60) : totalGross;
                    return (
                      <tr key={row.id} className="border-b hover:bg-muted/30">
                        {/* Name select */}
                        <td className="sticky left-0 z-10 bg-card px-2 py-1.5">
                          <Select
                            value={row.mitarbeiterId}
                            onValueChange={(v) =>
                              updateMitarbeiterField(row.id, "mitarbeiterId", v)
                            }
                          >
                            <SelectTrigger className="h-9 text-sm">
                              <SelectValue placeholder="Mitarbeiter..." />
                            </SelectTrigger>
                            <SelectContent>
                              {profiles.map((p) => (
                                <SelectItem key={p.id} value={p.id}>
                                  {p.nachname} {p.vorname}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                        {/* F - Fahrer */}
                        <td className="px-1 py-1.5 text-center">
                          <div className="flex items-center justify-center gap-0.5">
                            <Checkbox
                              checked={row.istFahrer}
                              onCheckedChange={(v) =>
                                updateMitarbeiterField(
                                  row.id,
                                  "istFahrer",
                                  v === true
                                )
                              }
                            />
                            {/* F = nur Toggle, keine Stunden-Eingabe */}
                          </div>
                        </td>
                        {/* W/SCH/R removed - now handled via Tätigkeiten with tags */}
                        {/* Hours per activity */}
                        {taetigkeiten.map((t) => (
                          <td key={t.position} className="px-1 py-1.5 text-center">
                            <Input
                              type="number" step="any" min="0" max="24"
                              className="h-9 w-16 text-center text-sm px-1"
                              value={row.stunden[t.position] ?? ""}
                              onChange={(e) => {
                                updateMitarbeiterStunden(row.id, t.position, e.target.value === "" ? "" : e.target.value);
                              }}
                              placeholder="–"
                            />
                          </td>
                        ))}
                        {/* Sum */}
                        <td className="px-2 py-1.5 text-center font-semibold">
                          <div
                            className={`rounded px-2 py-1 ${
                              total > 0
                                ? "bg-green-100 text-green-800"
                                : "text-muted-foreground"
                            }`}
                          >
                            {total > 0 ? total.toFixed(2) : "–"}
                          </div>
                        </td>
                        {/* Remove */}
                        <td className="px-1 py-1.5 text-center">
                          {mitarbeiterRows.length > 1 && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-destructive"
                              onClick={() => removeMitarbeiter(row.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* ---------- ZUSÄTZLICHE ANGABEN (einklappbar) ---------- */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Zusätzliche Angaben</CardTitle>
            <p className="text-sm text-muted-foreground">Geräteeinsatz, Materialien, Anmerkungen</p>
          </CardHeader>
          <CardContent>
            <Accordion type="multiple" className="w-full">
              {/* Geräteeinsatz */}
              <AccordionItem value="geraete">
                <AccordionTrigger className="text-sm font-medium py-2">
                  Geräteeinsatz {geraete.length > 0 && <Badge variant="secondary" className="ml-2 text-xs">{geraete.length}</Badge>}
                </AccordionTrigger>
                <AccordionContent className="space-y-2 pb-4">
                  <p className="text-xs text-muted-foreground mb-2">LKW, Kran (in Stunden)</p>
                  {geraete.map((g) => (
                    <div key={g.id} className="flex items-center gap-2">
                      {!GERAETE_OPTIONEN.includes(g.geraet) && g.geraet !== "" ? (
                        <Input
                          value={g.geraet.trim()}
                          onChange={(e) =>
                            setGeraete((prev) =>
                              prev.map((item) =>
                                item.id === g.id ? { ...item, geraet: e.target.value } : item
                              )
                            )
                          }
                          placeholder="Gerät eingeben..."
                          className="flex-1"
                        />
                      ) : (
                        <Select
                          value={g.geraet}
                          onValueChange={(v) =>
                            setGeraete((prev) =>
                              prev.map((item) =>
                                item.id === g.id ? { ...item, geraet: v === "Sonstiges" ? " " : v } : item
                              )
                            )
                          }
                        >
                          <SelectTrigger className="flex-1">
                            <SelectValue placeholder="Gerät auswählen..." />
                          </SelectTrigger>
                          <SelectContent>
                            {GERAETE_OPTIONEN.map((opt) => (
                              <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                      <Input
                        type="number" step="0.5" min="0"
                        value={g.stunden}
                        onChange={(e) =>
                          setGeraete((prev) =>
                            prev.map((item) => item.id === g.id ? { ...item, stunden: e.target.value } : item)
                          )
                        }
                        placeholder="Std."
                        className="w-20"
                      />
                      <Button variant="ghost" size="icon" className="shrink-0 h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => setGeraete((prev) => prev.filter((item) => item.id !== g.id))}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                  <Button variant="outline" size="sm"
                    onClick={() => setGeraete((prev) => [...prev, { id: crypto.randomUUID(), geraet: "", stunden: "" }])}
                  >
                    <Plus className="h-4 w-4 mr-1" /> Gerät
                  </Button>
                </AccordionContent>
              </AccordionItem>

              {/* Materialien */}
              <AccordionItem value="materialien">
                <AccordionTrigger className="text-sm font-medium py-2">
                  Verbrauchte Materialien {materialien.length > 0 && <Badge variant="secondary" className="ml-2 text-xs">{materialien.length}</Badge>}
                </AccordionTrigger>
                <AccordionContent className="space-y-2 pb-4">
                  {materialien.map((m) => (
                    <div key={m.id} className="flex items-center gap-2">
                      <Input value={m.bezeichnung}
                        onChange={(e) => setMaterialien((prev) => prev.map((item) => item.id === m.id ? { ...item, bezeichnung: e.target.value } : item))}
                        placeholder="Bezeichnung..." className="flex-1"
                      />
                      <Input value={m.menge}
                        onChange={(e) => setMaterialien((prev) => prev.map((item) => item.id === m.id ? { ...item, menge: e.target.value } : item))}
                        placeholder="Menge" className="w-24"
                      />
                      <Button variant="ghost" size="icon" className="shrink-0 h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => setMaterialien((prev) => prev.filter((item) => item.id !== m.id))}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                  <Button variant="outline" size="sm"
                    onClick={() => setMaterialien((prev) => [...prev, { id: crypto.randomUUID(), bezeichnung: "", menge: "" }])}
                  >
                    <Plus className="h-4 w-4 mr-1" /> Material
                  </Button>
                </AccordionContent>
              </AccordionItem>

              {/* Anmerkungen */}
              <AccordionItem value="anmerkungen">
                <AccordionTrigger className="text-sm font-medium py-2">
                  Anmerkungen {anmerkungen && <Badge variant="secondary" className="ml-2 text-xs">1</Badge>}
                </AccordionTrigger>
                <AccordionContent className="pb-4">
                  <Textarea rows={3} value={anmerkungen}
                    onChange={(e) => setAnmerkungen(e.target.value)}
                    placeholder="Anmerkungen zum Leistungsbericht..."
                  />
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </CardContent>
        </Card>

        {/* ---------- TAGESGESAMT-ZUSAMMENFASSUNG ---------- */}
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="pt-4 pb-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Mitarbeiter</span>
              <span className="font-medium">{aktiveMaCount}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Tätigkeiten</span>
              <span className="font-medium">{taetigkeitenCount}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                {matrixBrutto ? "Stunden eingegeben (brutto)" : "Stunden eingegeben"}
              </span>
              <span className="font-medium tabular-nums">{tagGrossStunden.toFixed(2).replace(".", ",")}h</span>
            </div>
            {pauseAbzugTotal > 0 && (
              <div className="flex items-center justify-between text-orange-700 dark:text-orange-400">
                <span className="text-sm">
                  Pause-Abzug ({pauseMinuten} Min × {aktiveMaCount} MA)
                </span>
                <span className="font-medium tabular-nums">
                  −{pauseAbzugTotal.toFixed(2).replace(".", ",")}h
                </span>
              </div>
            )}
            <div className="flex items-center justify-between pt-2 border-t">
              <span className="text-base font-semibold">
                {matrixBrutto ? "Stunden gebucht (netto)" : "Stunden gebucht"}
              </span>
              <span className="text-xl font-bold tabular-nums">
                {tagTotalStunden.toFixed(2).replace(".", ",")}h
              </span>
            </div>
            {abfahrtZeit && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Abfahrt Baustelle (berechnet)</span>
                <span className="font-medium tabular-nums">{abfahrtZeit}</span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ---------- SICHERHEITSHINWEIS ---------- */}
        <Card className="bg-muted">
          <CardContent className="pt-4">
            <div className="flex items-start gap-3">
              <Info className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
              <p className="text-sm text-muted-foreground">
                Maßnahmen gemäß § 14 ASchG &amp; BauV § 154 sowie Hinweis zur Verwendung von Persönlicher Schutzausrüstung zur Kenntnis genommen!
              </p>
            </div>
          </CardContent>
        </Card>

        {/* ---------- SUBMIT ---------- */}
        <div className="sticky bottom-0 z-20 bg-background/95 backdrop-blur border-t -mx-3 sm:-mx-4 lg:-mx-6 px-3 sm:px-4 lg:px-6 py-3">
          <div className="flex flex-col sm:flex-row gap-2">
            <Button
              onClick={handleSave}
              disabled={saving}
              className="w-full sm:w-auto h-12 sm:h-10 text-base sm:text-sm"
              size="lg"
            >
              <Save className="h-5 w-5 mr-2" />
              {saving
                ? "Speichern..."
                : editingBerichtId
                ? "Bericht aktualisieren"
                : "Leistungsbericht speichern"}
            </Button>
            {editingBerichtId && (
              <Button
                variant="outline"
                size="lg"
                className="w-full sm:w-auto h-12 sm:h-10"
                onClick={() => {
                  resetForm();
                  setSearchParams({});
                }}
              >
                Abbrechen
              </Button>
            )}
          </div>
        </div>

      </div>

      {/* ---------- MITARBEITER AUSWAHL DIALOG ---------- */}
      <Dialog open={showMitarbeiterDialog} onOpenChange={setShowMitarbeiterDialog}>
        <DialogContent className="sm:max-w-md max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Mitarbeiter hinzufügen</DialogTitle>
          </DialogHeader>
          <div className="flex items-center gap-2 mb-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const allIds = new Set(
                  profiles
                    .filter((p) => !alreadyAddedMitarbeiterIds.has(p.id))
                    .map((p) => p.id)
                );
                setSelectedNewMitarbeiter(allIds);
              }}
            >
              Alle auswählen
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelectedNewMitarbeiter(new Set())}
            >
              Alle abwählen
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto space-y-1 pr-1">
            {profiles.map((p) => {
              const alreadyAdded = alreadyAddedMitarbeiterIds.has(p.id);
              const isSelected = alreadyAdded || selectedNewMitarbeiter.has(p.id);
              return (
                <label
                  key={p.id}
                  className={`flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer hover:bg-muted/50 ${
                    alreadyAdded ? "opacity-50 cursor-not-allowed" : ""
                  }`}
                >
                  <Checkbox
                    checked={isSelected}
                    disabled={alreadyAdded}
                    onCheckedChange={(checked) => {
                      if (alreadyAdded) return;
                      setSelectedNewMitarbeiter((prev) => {
                        const next = new Set(prev);
                        if (checked) {
                          next.add(p.id);
                        } else {
                          next.delete(p.id);
                        }
                        return next;
                      });
                    }}
                  />
                  <span className="text-sm">
                    {p.nachname} {p.vorname}
                    {alreadyAdded && (
                      <span className="ml-2 text-xs text-muted-foreground">(bereits hinzugefügt)</span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setShowMitarbeiterDialog(false)}>
              Abbrechen
            </Button>
            <Button onClick={handleAddSelectedMitarbeiter} disabled={selectedNewMitarbeiter.size === 0}>
              {selectedNewMitarbeiter.size > 0
                ? `${selectedNewMitarbeiter.size} Mitarbeiter hinzufügen`
                : "Hinzufügen"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Neues Projekt Dialog */}
      <Dialog open={showNewProjectDialog} onOpenChange={setShowNewProjectDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Neues Projekt erstellen</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Projektname *</Label>
              <Input
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                placeholder="z.B. Schönlieb, VS-Rosegg..."
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label>PLZ *</Label>
              <Input
                value={newProjectPlz}
                onChange={(e) => setNewProjectPlz(e.target.value)}
                placeholder="z.B. 9072"
                inputMode="numeric"
              />
            </div>
            <div className="space-y-2">
              <Label>Adresse</Label>
              <Input
                value={newProjectAdresse}
                onChange={(e) => setNewProjectAdresse(e.target.value)}
                placeholder="Straße, Ort (optional)"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowNewProjectDialog(false)}>
              Abbrechen
            </Button>
            <Button onClick={handleCreateProject} disabled={creatingProject}>
              {creatingProject ? "Erstellt..." : "Projekt erstellen"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- CONFIRM DIALOG (Konflikte beim Speichern) ---------- */}
      <AlertDialog open={!!confirmState} onOpenChange={(o) => !o && setConfirmState(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmState?.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirmState?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          {confirmState?.details && confirmState.details.length > 0 && (
            <div className="rounded border bg-muted/40 p-3 text-sm space-y-1 max-h-[200px] overflow-y-auto">
              {confirmState.details.map((d, i) => (
                <div key={i}>{d}</div>
              ))}
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>{confirmState?.cancelLabel || "Abbrechen"}</AlertDialogCancel>
            <AlertDialogAction
              className={confirmState?.variant === "destructive" ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : undefined}
              onClick={async () => {
                const fn = confirmState?.onConfirm;
                setConfirmState(null);
                if (fn) await fn();
              }}
            >
              {confirmState?.actionLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default TimeTracking;
