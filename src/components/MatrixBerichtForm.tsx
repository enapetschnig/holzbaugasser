/**
 * MatrixBerichtForm — geteilte UI für Werk- und LKW-Berichte.
 *
 * Beide Bericht-Typen sind matrix-basiert:
 *   Zeilen = Mitarbeiter, Spalten = Projekte (variable 1–12).
 * Eine Stunden-Matrix-Zelle = Stunden eines MA für ein Projekt an dem Tag.
 *
 * Pause-Logik wie LB: pause_von/pause_bis wird abgezogen.
 * Beim Speichern wird pro (MA × Projekt-Zelle mit Stunden) ein time_entries-Eintrag
 * angelegt mit entry_typ='werk' bzw. 'lkw' und project_id = projekt-zelle.
 */

import { useState, useEffect, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Plus, Trash2, Save, FileText } from "lucide-react";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { PageHeader } from "@/components/PageHeader";
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
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { localDateString } from "@/lib/workingHours";
import { findAbsenceTypeByTaetigkeit } from "@/lib/absenceTypes";

// ----------------------------- Types -----------------------------
type BerichtTyp = "werk" | "lkw";

type Project = { id: string; name: string };

type MitarbeiterOption = {
  id: string;
  name: string;
  role: string | null;
};

type ProjektZeile = {
  localId: string;
  projektId: string; // empty = noch nicht gewählt
};

type MitarbeiterRow = {
  localId: string;
  mitarbeiterId: string;
  stunden: Record<string, string>; // key = projektZeile.localId, value = Stunden als String
};

type GeraetItem = { id: string; geraet: string; stunden: string };
type MaterialItem = { id: string; bezeichnung: string; menge: string };

const GERAETE_OPTIONEN = ["LKW", "Kran", "Bagger", "Sonstiges"];

// ----------------------------- Helpers -----------------------------
function randomId(): string {
  return `tmp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function parseStunden(s: string): number {
  if (!s) return 0;
  const n = parseFloat(s.replace(",", "."));
  return isNaN(n) ? 0 : n;
}

function formatStunden(n: number): string {
  if (n === 0) return "";
  if (n === Math.floor(n)) return `${n}`;
  return n.toString().replace(".", ",");
}

function timeToMin(t: string): number | null {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
}

function computeAbfahrt(arbeitsbeginn: string, stunden: number, pauseMinuten: number): string {
  if (!arbeitsbeginn || stunden <= 0) return "";
  const start = timeToMin(arbeitsbeginn);
  if (start == null) return "";
  const totalMin = start + Math.round(stunden * 60) + pauseMinuten;
  if (totalMin >= 24 * 60) return "";
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function calcPauseMinutes(von: string, bis: string): number {
  const v = timeToMin(von);
  const b = timeToMin(bis);
  if (v == null || b == null || b <= v) return 0;
  return b - v;
}

// ----------------------------- Component -----------------------------
type Props = {
  berichtTyp: BerichtTyp;
  pageTitle: string; // z.B. "Werk-Bericht"
  taetigkeitPrefix: string; // z.B. "Werk" → "Werk: <projekt>"
};

export default function MatrixBerichtForm({ berichtTyp, pageTitle, taetigkeitPrefix }: Props) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { toast } = useToast();

  // ----- Auth & Role -----
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // ----- Datum & Zeit -----
  const [datum, setDatum] = useState(() => localDateString());
  const [arbeitsbeginn, setArbeitsbeginn] = useState("06:30");
  // Werkstatt/LKW haben kein "Ankunft Baustelle" — wir verwenden arbeitsbeginn als
  // Fallback für DB-Felder, die NOT NULL sind.
  const [pauseVon, setPauseVon] = useState("12:00");
  const [pauseBis, setPauseBis] = useState("12:30");
  // Wenn true: Pause wird in diesem Bericht NICHT abgezogen (z.B. weil sie schon in
  // einem anderen Bericht des Tages gebucht wurde). Auto-Detect oder manueller Override.
  const [keinePause, setKeinePause] = useState(false);

  // ----- Projekt-Zeilen -----
  const [projektZeilen, setProjektZeilen] = useState<ProjektZeile[]>([
    { localId: randomId(), projektId: "" },
  ]);

  // ----- Mitarbeiter-Zeilen -----
  const [mitarbeiterRows, setMitarbeiterRows] = useState<MitarbeiterRow[]>([]);

  // ----- Reference-Daten -----
  const [projects, setProjects] = useState<Project[]>([]);
  const [availableMitarbeiter, setAvailableMitarbeiter] = useState<MitarbeiterOption[]>([]);
  const [gleicheStundenFuerAlle, setGleicheStundenFuerAlle] = useState(false);

  // ----- Geräte / Material / Anmerkungen -----
  const [geraete, setGeraete] = useState<GeraetItem[]>([]);
  const [materialien, setMaterialien] = useState<MaterialItem[]>([]);
  const [anmerkungen, setAnmerkungen] = useState("");
  const [fertiggestellt, setFertiggestellt] = useState(false);

  // ----- Edit-Mode -----
  const editingBerichtId = searchParams.get("edit");
  const [originalMaIds, setOriginalMaIds] = useState<string[]>([]);

  // ----- "Bereits heute gebucht"-Card: alle eigenen Berichte (LB + Werkstatt + LKW)
  // für (User, Datum), exkl. dem aktuell editierten. -----
  const [existingTodayBerichte, setExistingTodayBerichte] = useState<{
    id: string;
    bericht_typ: "leistungsbericht" | "werk" | "lkw";
    projekt_name: string;
    arbeitsbeginn: string | null;
    pause_von: string | null;
    pause_bis: string | null;
    total_stunden: number;
  }[]>([]);

  // Aggregierte Projektleiter-Stunden des Users für den Tag (separate Info-Zeile).
  const [existingTodayPLStunden, setExistingTodayPLStunden] = useState<number>(0);

  // ----- Saving -----
  const [saving, setSaving] = useState(false);

  // ----- Derived -----
  const isAdmin = userRole === "administrator";
  const isVorarbeiter = userRole === "vorarbeiter";
  const isProjektleiter = userRole === "projektleiter";
  const canBookForOthers = isAdmin || isVorarbeiter || isProjektleiter;

  const pauseMinuten = useMemo(
    () => keinePause ? 0 : calcPauseMinutes(pauseVon, pauseBis),
    [pauseVon, pauseBis, keinePause]
  );

  const projektMap = useMemo(() => {
    const m: Record<string, string> = {};
    projects.forEach((p) => { m[p.id] = p.name; });
    return m;
  }, [projects]);

  const pauseHours = pauseMinuten / 60;

  // Wenn "Stunden für alle übernehmen" aktiviert wird, übernimmt sofort die Stunden
  // des ersten MAs auf alle anderen Zeilen (analog zum Leistungsbericht).
  useEffect(() => {
    if (gleicheStundenFuerAlle) {
      setMitarbeiterRows((prev) => {
        if (prev.length <= 1) return prev;
        const firstStunden = prev[0].stunden;
        return prev.map((r, i) => i === 0 ? r : { ...r, stunden: { ...firstStunden } });
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gleicheStundenFuerAlle]);

  // Tag-Total: Summe aller MA-Netto-Stunden (Pause schon pro MA abgezogen)
  const tagTotalStunden = useMemo(() => {
    let sum = 0;
    for (const row of mitarbeiterRows) {
      if (!row.mitarbeiterId) continue;
      const gross = projektZeilen.reduce((s, z) => s + parseStunden(row.stunden[z.localId] || ""), 0);
      sum += Math.max(0, gross - pauseHours);
    }
    return Math.round(sum * 100) / 100;
  }, [mitarbeiterRows, projektZeilen, pauseHours]);

  const tagGrossStunden = useMemo(() => {
    let sum = 0;
    for (const row of mitarbeiterRows) {
      if (!row.mitarbeiterId) continue;
      for (const z of projektZeilen) {
        sum += parseStunden(row.stunden[z.localId] || "");
      }
    }
    return Math.round(sum * 100) / 100;
  }, [mitarbeiterRows, projektZeilen]);

  const maxMaStunden = useMemo(() => {
    let max = 0;
    for (const row of mitarbeiterRows) {
      if (!row.mitarbeiterId) continue;
      const gross = projektZeilen.reduce((s, z) => s + parseStunden(row.stunden[z.localId] || ""), 0);
      const net = Math.max(0, gross - pauseHours);
      if (net > max) max = net;
    }
    return max;
  }, [mitarbeiterRows, projektZeilen, pauseHours]);

  const computedAbfahrt = useMemo(
    () => computeAbfahrt(arbeitsbeginn, maxMaStunden, pauseMinuten),
    [arbeitsbeginn, maxMaStunden, pauseMinuten]
  );

  // ----------------------------- Init -----------------------------
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        navigate("/auth");
        return;
      }
      setCurrentUserId(user.id);

      const { data: roleData } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .maybeSingle();
      const role = (roleData?.role as string | null) || null;
      setUserRole(role);

      if (role === "extern") {
        toast({
          variant: "destructive",
          title: "Kein Zugriff",
          description: "Externe Mitarbeiter haben keinen Zugriff auf diese Seite.",
        });
        navigate("/");
        return;
      }

      // Projekte laden
      const { data: projData } = await supabase
        .from("projects")
        .select("id, name, status")
        .in("status", ["aktiv", "in_planung"])
        .order("name");
      if (projData) setProjects(projData);

      // Mitarbeiter-Liste (alle aktiven, nicht hidden — externe MA SIND auswählbar,
      // damit Admin/Vorarbeiter/Projektleiter sie zu Leistungsberichten hinzufügen können).
      const [profilesRes, rolesRes] = await Promise.all([
        supabase
          .from("profiles")
          .select("id, vorname, nachname, is_hidden")
          .eq("is_active", true)
          .order("nachname"),
        supabase.from("user_roles").select("user_id, role"),
      ]);
      const roleMap: Record<string, string> = {};
      (rolesRes.data || []).forEach((r: any) => { roleMap[r.user_id] = r.role; });
      const list: MitarbeiterOption[] = ((profilesRes.data || []) as any[])
        .filter((p) => !p.is_hidden)
        .map((p) => ({
          id: p.id,
          name: `${p.vorname || ""} ${p.nachname || ""}`.trim() || "(ohne Name)",
          role: roleMap[p.id] || null,
        }));
      setAvailableMitarbeiter(list);

      // Default: aktueller User als erste Mitarbeiter-Zeile
      setMitarbeiterRows([{ localId: randomId(), mitarbeiterId: user.id, stunden: {} }]);

      setLoading(false);
    })();
  }, [navigate, toast]);

  // ----------------------------- Edit-Mode laden -----------------------------
  useEffect(() => {
    if (!editingBerichtId || !currentUserId) return;
    let cancelled = false;
    (async () => {
      const { data: bericht, error } = await supabase
        .from("leistungsberichte" as any)
        .select("*")
        .eq("id", editingBerichtId)
        .maybeSingle();
      if (cancelled) return;
      if (error || !bericht) {
        toast({ variant: "destructive", title: "Fehler", description: "Bericht nicht gefunden." });
        navigate("/");
        return;
      }
      const b = bericht as any;
      if (b.bericht_typ !== berichtTyp) {
        // Falsche Page → auf richtige umleiten
        const target = b.bericht_typ === "werk" ? "/werk-bericht" : b.bericht_typ === "lkw" ? "/lkw-bericht" : "/time-tracking";
        navigate(`${target}?edit=${editingBerichtId}`, { replace: true });
        return;
      }

      // Berechtigungs-Check: nur eigene Berichte oder canBookForOthers
      const canEdit = b.erstellt_von === currentUserId || isAdmin || isVorarbeiter || isProjektleiter;
      if (!canEdit) {
        toast({ variant: "destructive", title: "Keine Berechtigung", description: "Du kannst nur eigene Berichte bearbeiten." });
        navigate("/");
        return;
      }

      // Felder befüllen
      setDatum(b.datum);
      setArbeitsbeginn(b.arbeitsbeginn?.substring(0, 5) || "06:30");
      setPauseVon(b.pause_von?.substring(0, 5) || "12:00");
      setPauseBis(b.pause_bis?.substring(0, 5) || "12:30");
      // Bericht wurde mit "Keine Pause" gespeichert (pause_von/bis = null) → Toggle aktivieren
      setKeinePause(!b.pause_von && !b.pause_bis);
      setAnmerkungen(b.anmerkungen || "");
      setFertiggestellt(b.fertiggestellt || false);

      // Projekt-Zeilen aus leistungsbericht_taetigkeiten
      const { data: taetData } = await supabase
        .from("leistungsbericht_taetigkeiten" as any)
        .select("id, position, projekt_id, bezeichnung")
        .eq("bericht_id", editingBerichtId)
        .order("position");
      const zeilen: ProjektZeile[] = ((taetData || []) as any[]).map((t) => ({
        localId: t.id, // wir verwenden DB-ID als localId für Edit
        projektId: t.projekt_id || "",
      }));
      const tidByLocalId: Record<string, string> = {};
      ((taetData || []) as any[]).forEach((t) => { tidByLocalId[t.id] = t.id; });

      // Mitarbeiter-Zeilen
      const { data: maData } = await supabase
        .from("leistungsbericht_mitarbeiter" as any)
        .select("id, mitarbeiter_id")
        .eq("bericht_id", editingBerichtId);
      const maList = (maData || []) as any[];
      const maIds = maList.map((m) => m.mitarbeiter_id);

      // Stunden
      const { data: stundenData } = await supabase
        .from("leistungsbericht_stunden" as any)
        .select("mitarbeiter_id, taetigkeit_id, stunden")
        .eq("bericht_id", editingBerichtId);

      const rows: MitarbeiterRow[] = maList.map((m) => {
        const stundenMap: Record<string, string> = {};
        ((stundenData || []) as any[])
          .filter((s) => s.mitarbeiter_id === m.mitarbeiter_id)
          .forEach((s) => {
            stundenMap[s.taetigkeit_id] = formatStunden(parseFloat(s.stunden) || 0);
          });
        return {
          localId: randomId(),
          mitarbeiterId: m.mitarbeiter_id,
          stunden: stundenMap,
        };
      });

      // Geräte / Material
      const { data: geraeteData } = await supabase
        .from("leistungsbericht_geraete" as any)
        .select("geraet, stunden")
        .eq("bericht_id", editingBerichtId);
      const { data: matData } = await supabase
        .from("leistungsbericht_materialien" as any)
        .select("bezeichnung, menge")
        .eq("bericht_id", editingBerichtId);

      if (cancelled) return;
      setProjektZeilen(zeilen.length > 0 ? zeilen : [{ localId: randomId(), projektId: "" }]);
      setMitarbeiterRows(rows.length > 0 ? rows : [{ localId: randomId(), mitarbeiterId: currentUserId, stunden: {} }]);
      setOriginalMaIds(maIds);
      setGeraete(((geraeteData || []) as any[]).map((g) => ({ id: randomId(), geraet: g.geraet, stunden: formatStunden(parseFloat(g.stunden) || 0) })));
      setMaterialien(((matData || []) as any[]).map((m) => ({ id: randomId(), bezeichnung: m.bezeichnung, menge: m.menge || "" })));
    })();
    return () => { cancelled = true; };
  }, [editingBerichtId, currentUserId, berichtTyp, navigate, toast, isAdmin, isVorarbeiter, isProjektleiter]);

  // ----------------------------- "Bereits heute gebucht": alle eigenen Berichte für den Tag -----------------------------
  // Lädt LB + Werkstatt + LKW Berichte des Users für den Tag (außer dem editierten),
  // plus aggregierte PL-Stunden. Edit-Button routet typ-aware zur jeweiligen Page.
  useEffect(() => {
    if (!currentUserId || !datum) return;
    let cancelled = false;
    (async () => {
      // Berichte ALLER Typen
      let q = supabase
        .from("leistungsberichte" as any)
        .select("id, projekt_id, bericht_typ, arbeitsbeginn, ankunft_zeit, pause_von, pause_bis")
        .eq("erstellt_von", currentUserId)
        .eq("datum", datum);
      if (editingBerichtId) q = q.neq("id", editingBerichtId);
      const { data: berichte } = await q;

      if (cancelled) return;

      if (!berichte || (berichte as any[]).length === 0) {
        if (!cancelled) setExistingTodayBerichte([]);
      } else {
        // Projekt-Namen für LB-Berichte (Werkstatt/LKW haben projekt_id=NULL)
        const projIds = [...new Set((berichte as any[]).map((b: any) => b.projekt_id).filter(Boolean))];
        const projNameMap: Record<string, string> = {};
        if (projIds.length > 0) {
          const { data: projData } = await supabase
            .from("projects")
            .select("id, name")
            .in("id", projIds);
          (projData || []).forEach((p: any) => { projNameMap[p.id] = p.name; });
        }

        // Stunden pro Bericht (für aktuellen User)
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

        const list = (berichte as any[]).map((b: any) => ({
          id: b.id as string,
          bericht_typ: ((b.bericht_typ as string) || "leistungsbericht") as "leistungsbericht" | "werk" | "lkw",
          projekt_name: b.projekt_id ? (projNameMap[b.projekt_id] || "-") : "",
          arbeitsbeginn: b.arbeitsbeginn,
          pause_von: b.pause_von,
          pause_bis: b.pause_bis,
          total_stunden: stundenPerBericht[b.id] || 0,
        }));
        if (!cancelled) setExistingTodayBerichte(list);
      }

      // PL-Aggregat (Projektleiter-Stunden für den Tag, separater Info-Eintrag)
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
  }, [currentUserId, datum, berichtTyp, editingBerichtId]);

  // ----------------------------- Auto-Fill arbeitsbeginn aus Teil-Absenz -----------------------------
  // Wenn der User am Tag schon eine Teil-Absenz hat (Arzt 07:00-09:00),
  // setzt sich arbeitsbeginn automatisch auf 09:00. Nur im NEW-Modus.
  useEffect(() => {
    if (editingBerichtId || !currentUserId || !datum) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("time_entries")
        .select("end_time, taetigkeit")
        .eq("user_id", currentUserId)
        .eq("datum", datum);
      if (cancelled || !data) return;
      let latestEnd: string | null = null;
      for (const e of data as any[]) {
        const typ = findAbsenceTypeByTaetigkeit(e.taetigkeit);
        if (typ?.hourlyEditable && e.end_time) {
          const t = (e.end_time as string).substring(0, 5);
          if (!latestEnd || t > latestEnd) latestEnd = t;
        }
      }
      if (latestEnd) setArbeitsbeginn(latestEnd);
    })();
    return () => { cancelled = true; };
  }, [currentUserId, datum, editingBerichtId]);

  // ----------------------------- Auto-Detect: "Keine Pause" wenn schon in anderem Bericht gebucht -----------------------------
  // Nur für neue Berichte (nicht im Edit-Mode). Wenn der User bereits einen Bericht
  // mit Pause für den Tag hat (egal welcher Typ), wird hier "Keine Pause" pre-checked,
  // damit die Pause nicht doppelt abgezogen wird.
  useEffect(() => {
    if (editingBerichtId) return;
    if (existingTodayBerichte.length === 0) {
      setKeinePause(false);
      return;
    }
    const anyHasPause = existingTodayBerichte.some(
      (b) => !!b.pause_von && !!b.pause_bis
    );
    setKeinePause(anyHasPause);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingTodayBerichte.length, editingBerichtId]);

  // ----------------------------- Helpers UI -----------------------------
  const addProjektZeile = () => {
    if (projektZeilen.length >= 12) return;
    setProjektZeilen((prev) => [...prev, { localId: randomId(), projektId: "" }]);
  };
  const removeProjektZeile = (localId: string) => {
    if (projektZeilen.length <= 1) return;
    setProjektZeilen((prev) => prev.filter((z) => z.localId !== localId));
    // Stunden-Spalte aus jedem MA entfernen
    setMitarbeiterRows((prev) => prev.map((r) => {
      const next = { ...r.stunden };
      delete next[localId];
      return { ...r, stunden: next };
    }));
  };
  const updateProjektZeile = (localId: string, projektId: string) => {
    setProjektZeilen((prev) => prev.map((z) => z.localId === localId ? { ...z, projektId } : z));
  };

  const updateMaStunden = (rowLocalId: string, zeileLocalId: string, value: string) => {
    if (gleicheStundenFuerAlle) {
      // Broadcast: alle MAs für diese Projekt-Zeile auf den Wert setzen
      setMitarbeiterRows((prev) => prev.map((r) => ({
        ...r,
        stunden: { ...r.stunden, [zeileLocalId]: value },
      })));
    } else {
      setMitarbeiterRows((prev) => prev.map((r) =>
        r.localId === rowLocalId
          ? { ...r, stunden: { ...r.stunden, [zeileLocalId]: value } }
          : r
      ));
    }
  };

  const addMitarbeiter = (id: string) => {
    if (id && mitarbeiterRows.some((r) => r.mitarbeiterId === id)) return;
    // Wenn Toggle ON: Stunden des ersten existierenden MAs übernehmen
    const initialStunden: Record<string, string> = gleicheStundenFuerAlle && mitarbeiterRows.length > 0
      ? { ...mitarbeiterRows[0].stunden }
      : {};
    setMitarbeiterRows((prev) => [...prev, { localId: randomId(), mitarbeiterId: id, stunden: initialStunden }]);
  };

  // Eine leere MA-Zeile hinzufügen (User wählt dann via Select). Pre-fill mit erstem nicht-vergebenen MA.
  const addEmptyMitarbeiterRow = () => {
    const usedIds = new Set(mitarbeiterRows.map((r) => r.mitarbeiterId).filter(Boolean));
    const nextMa = availableMitarbeiter.find((m) => !usedIds.has(m.id));
    addMitarbeiter(nextMa?.id || "");
  };

  const updateMitarbeiterId = (rowLocalId: string, newId: string) => {
    setMitarbeiterRows((prev) => prev.map((r) =>
      r.localId === rowLocalId ? { ...r, mitarbeiterId: newId } : r
    ));
  };

  const removeMitarbeiter = (rowLocalId: string) => {
    setMitarbeiterRows((prev) => {
      const filtered = prev.filter((r) => r.localId !== rowLocalId);
      // Mind. eine MA-Zeile, defaultet auf currentUserId
      if (filtered.length === 0 && currentUserId) {
        return [{ localId: randomId(), mitarbeiterId: currentUserId, stunden: {} }];
      }
      return filtered;
    });
  };

  // ----------------------------- Save -----------------------------
  const handleSave = async () => {
    if (!currentUserId) return;

    // Validierung
    if (projektZeilen.length === 0) {
      toast({ variant: "destructive", title: "Fehler", description: "Mindestens ein Projekt erforderlich." });
      return;
    }
    const validZeilen = projektZeilen.filter((z) => z.projektId);
    if (validZeilen.length === 0) {
      toast({ variant: "destructive", title: "Fehler", description: "Mindestens ein Projekt auswählen." });
      return;
    }
    const activeMaRows = mitarbeiterRows.filter((r) => r.mitarbeiterId);
    if (activeMaRows.length === 0) {
      toast({ variant: "destructive", title: "Fehler", description: "Mindestens ein Mitarbeiter erforderlich." });
      return;
    }

    // Stunden-Validierung: zumindest eine Zelle > 0
    let hasAnyStunden = false;
    for (const row of activeMaRows) {
      for (const z of validZeilen) {
        if (parseStunden(row.stunden[z.localId] || "") > 0) {
          hasAnyStunden = true;
          break;
        }
      }
      if (hasAnyStunden) break;
    }
    if (!hasAnyStunden) {
      toast({ variant: "destructive", title: "Fehler", description: "Mindestens eine Stunden-Zelle muss > 0 sein." });
      return;
    }

    setSaving(true);
    try {
      // Wenn nicht im URL-Edit-Mode, aber ein bestehender Bericht für (user, datum, typ) existiert,
      // diesen wie Edit-Mode behandeln (überschreiben). Vermeidet UNIQUE-Constraint-Violation.
      let cleanupBerichtId: string | null = editingBerichtId;
      if (!cleanupBerichtId) {
        const { data: existing } = await supabase
          .from("leistungsberichte" as any)
          .select("id")
          .eq("erstellt_von", currentUserId)
          .eq("datum", datum)
          .eq("bericht_typ", berichtTyp)
          .maybeSingle();
        if (existing) cleanupBerichtId = (existing as any).id as string;
      }

      // 1. Editing oder Auto-Overwrite? Alte Daten löschen
      if (cleanupBerichtId) {
        await supabase.from("leistungsbericht_stunden" as any).delete().eq("bericht_id", cleanupBerichtId);
        await supabase.from("leistungsbericht_mitarbeiter" as any).delete().eq("bericht_id", cleanupBerichtId);
        await supabase.from("leistungsbericht_taetigkeiten" as any).delete().eq("bericht_id", cleanupBerichtId);
        await supabase.from("leistungsbericht_geraete" as any).delete().eq("bericht_id", cleanupBerichtId);
        await supabase.from("leistungsbericht_materialien" as any).delete().eq("bericht_id", cleanupBerichtId);

        // time_entries: alle alten MAs (originalMaIds) ∪ aktuelle MAs für den Tag mit unserem Typ
        const allAffectedMaIds = Array.from(new Set([...originalMaIds, ...activeMaRows.map((r) => r.mitarbeiterId)]));
        if (allAffectedMaIds.length > 0) {
          const teQuery: any = supabase.from("time_entries").delete();
          await teQuery.eq("datum", datum).eq("entry_typ", berichtTyp).in("user_id", allAffectedMaIds);
        }
        await supabase.from("leistungsberichte" as any).delete().eq("id", cleanupBerichtId);
      }

      // Schutz-Schicht gegen Orphan-time_entries: vor jedem INSERT alle bestehenden
      // time_entries für (user, datum, typ) löschen — auch wenn kein Bericht-Match
      // gefunden wurde. Verhindert Doppelbuchungen falls aus früheren Delete-Bugs
      // ein time_entry ohne zugehörigen Bericht in der DB liegt.
      const activeMaIdsForOrphanCleanup = activeMaRows.map((r) => r.mitarbeiterId).filter(Boolean);
      if (activeMaIdsForOrphanCleanup.length > 0) {
        await supabase
          .from("time_entries")
          .delete()
          .eq("datum", datum)
          .eq("entry_typ", berichtTyp)
          .in("user_id", activeMaIdsForOrphanCleanup);
      }

      // 2. INSERT leistungsberichte
      // ankunft_zeit + abfahrt_zeit sind in der DB NOT NULL → niemals null senden.
      // ankunft_zeit + abfahrt_zeit sind in der DB NOT NULL. Wir verwenden arbeitsbeginn
      // als Fallback für ankunft_zeit (Werkstatt/LKW haben kein eigenes Ankunfts-Feld).
      const safeAnkunft = arbeitsbeginn || "06:30";
      const safeAbfahrt = computedAbfahrt || safeAnkunft;
      const { data: berichtData, error: berichtErr } = await supabase
        .from("leistungsberichte" as any)
        .insert({
          erstellt_von: currentUserId,
          projekt_id: null,
          bericht_typ: berichtTyp,
          datum,
          arbeitsbeginn: arbeitsbeginn || null,
          ankunft_zeit: safeAnkunft,
          abfahrt_zeit: safeAbfahrt,
          pause_von: keinePause ? null : (pauseVon || null),
          pause_bis: keinePause ? null : (pauseBis || null),
          pause_minuten: pauseMinuten,
          anmerkungen: anmerkungen || null,
          fertiggestellt,
        } as any)
        .select("id")
        .single();
      if (berichtErr) throw berichtErr;
      const berichtId = (berichtData as any).id as string;

      // Hilfs-Funktion: bei Fehlern in Folge-Steps Orphan-Bericht aufräumen,
      // damit der nächste Save-Versuch nicht am UNIQUE-Constraint scheitert.
      const cleanupOrphan = async () => {
        try {
          await supabase.from("leistungsberichte" as any).delete().eq("id", berichtId);
        } catch {
          // best-effort
        }
      };

      // 3. INSERT leistungsbericht_taetigkeiten — eine Zeile pro projektZeile
      const taetInserts = validZeilen.map((z, idx) => ({
        bericht_id: berichtId,
        position: idx + 1,
        projekt_id: z.projektId,
        bezeichnung: projektMap[z.projektId] || "(unbekanntes Projekt)",
      }));
      const { data: taetData, error: taetErr } = await supabase
        .from("leistungsbericht_taetigkeiten" as any)
        .insert(taetInserts as any)
        .select("id, position");
      if (taetErr) { await cleanupOrphan(); throw taetErr; }

      // Map: position → taetigkeit_id (DB)
      // Map: zeile.localId → taetigkeit_id (DB) — über Reihenfolge der validZeilen
      const localIdToTaetId: Record<string, string> = {};
      ((taetData || []) as any[]).forEach((t) => {
        const matching = validZeilen[t.position - 1];
        if (matching) localIdToTaetId[matching.localId] = t.id;
      });

      // 4. INSERT leistungsbericht_mitarbeiter — summe_stunden = NETTO (mit Pause-Abzug)
      const maInserts = activeMaRows.map((r) => {
        const grossSum = validZeilen.reduce(
          (acc, z) => acc + parseStunden(r.stunden[z.localId] || ""),
          0
        );
        const netSum = Math.max(0, grossSum - pauseHours);
        return {
          bericht_id: berichtId,
          mitarbeiter_id: r.mitarbeiterId,
          summe_stunden: Math.round(netSum * 100) / 100,
        };
      });
      const { error: maErr } = await supabase
        .from("leistungsbericht_mitarbeiter" as any)
        .insert(maInserts as any);
      if (maErr) { await cleanupOrphan(); throw maErr; }

      // 5. INSERT leistungsbericht_stunden — Matrix-Zellen wie eingegeben (für PDF-Anzeige)
      const stundenInserts: any[] = [];
      for (const r of activeMaRows) {
        for (const z of validZeilen) {
          const stunden = parseStunden(r.stunden[z.localId] || "");
          if (stunden > 0) {
            stundenInserts.push({
              bericht_id: berichtId,
              mitarbeiter_id: r.mitarbeiterId,
              taetigkeit_id: localIdToTaetId[z.localId],
              stunden,
            });
          }
        }
      }
      if (stundenInserts.length > 0) {
        const { error: sErr } = await supabase
          .from("leistungsbericht_stunden" as any)
          .insert(stundenInserts);
        if (sErr) { await cleanupOrphan(); throw sErr; }
      }

      // 6. INSERT time_entries — pro (MA × Projekt-Zelle), Stunden = NETTO (Pause pro-rata abgezogen)
      // Damit landen in der Stundenauswertung die echten Arbeitsstunden ohne Pause.
      const timeEntryInserts: any[] = [];
      for (const r of activeMaRows) {
        const grossSum = validZeilen.reduce(
          (acc, z) => acc + parseStunden(r.stunden[z.localId] || ""),
          0
        );
        const netSum = Math.max(0, grossSum - pauseHours);
        const ratio = grossSum > 0 ? netSum / grossSum : 0;
        for (const z of validZeilen) {
          const grossCell = parseStunden(r.stunden[z.localId] || "");
          if (grossCell > 0) {
            const netCell = Math.round(grossCell * ratio * 100) / 100;
            const projName = projektMap[z.projektId] || "(unbekannt)";
            timeEntryInserts.push({
              user_id: r.mitarbeiterId,
              project_id: z.projektId,
              datum,
              stunden: netCell,
              taetigkeit: `${taetigkeitPrefix}: ${projName}`,
              start_time: arbeitsbeginn || "06:30",
              end_time: computedAbfahrt || arbeitsbeginn || "06:30",
              pause_minutes: pauseMinuten,
              entry_typ: berichtTyp,
            });
          }
        }
      }
      if (timeEntryInserts.length > 0) {
        const { error: teErr } = await supabase
          .from("time_entries")
          .insert(timeEntryInserts);
        if (teErr) { await cleanupOrphan(); throw teErr; }
      }

      // 7. Geräte
      const validGeraete = geraete.filter((g) => g.geraet.trim() && parseStunden(g.stunden) > 0);
      if (validGeraete.length > 0) {
        await supabase.from("leistungsbericht_geraete" as any).insert(
          validGeraete.map((g) => ({
            bericht_id: berichtId,
            geraet: g.geraet.trim(),
            stunden: parseStunden(g.stunden),
          })) as any
        );
      }

      // 8. Materialien
      const validMat = materialien.filter((m) => m.bezeichnung.trim());
      if (validMat.length > 0) {
        await supabase.from("leistungsbericht_materialien" as any).insert(
          validMat.map((m) => ({
            bericht_id: berichtId,
            bezeichnung: m.bezeichnung.trim(),
            menge: m.menge || null,
          })) as any
        );
      }

      toast({
        title: "Gespeichert",
        description: `${pageTitle} für ${format(new Date(datum + "T00:00:00"), "dd.MM.yyyy")} mit ${tagTotalStunden}h gespeichert.`,
      });
      setSearchParams({});
      navigate("/");
    } catch (err: any) {
      console.error("Save failed:", err);
      toast({
        variant: "destructive",
        title: "Speichern fehlgeschlagen",
        description: err?.message || "Unbekannter Fehler.",
      });
    } finally {
      setSaving(false);
    }
  };

  // ----------------------------- Render -----------------------------
  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <PageHeader title={pageTitle} />
        <div className="container mx-auto p-4">
          <p>Lädt…</p>
        </div>
      </div>
    );
  }

  const datumLabel = format(new Date(datum + "T00:00:00"), "EEEE, d. MMMM yyyy", { locale: de });

  return (
    <div className="min-h-screen bg-background pb-32">
      <PageHeader title={editingBerichtId ? `${pageTitle} bearbeiten` : pageTitle} />

      <main className="container mx-auto px-3 sm:px-4 py-4 sm:py-6 max-w-3xl space-y-4">
        {/* Datum */}
        <Card>
          <CardContent className="pt-4 pb-4">
            <Label>Datum</Label>
            <Input
              type="date"
              value={datum}
              onChange={(e) => setDatum(e.target.value)}
              className="max-w-[220px]"
            />
            <div className="text-xs text-muted-foreground mt-1">{datumLabel}</div>
          </CardContent>
        </Card>

        {/* "Bereits heute gebucht" — alle Berichte (LB + Werkstatt + LKW) + PL-Aggregat */}
        {(existingTodayBerichte.length > 0 || existingTodayPLStunden > 0) && (
          <Card className="border-blue-200 bg-blue-50/30 dark:bg-blue-950/10 dark:border-blue-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="h-4 w-4 text-blue-600" />
                Bereits heute gebucht
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {existingTodayBerichte.map((b) => {
                const isLB = b.bericht_typ === "leistungsbericht";
                const isWerk = b.bericht_typ === "werk";
                const isLkw = b.bericht_typ === "lkw";
                const titleLabel = isWerk
                  ? "Leistungsbericht Werkstatt"
                  : isLkw
                    ? "Leistungsbericht LKW"
                    : (b.projekt_name || "Leistungsbericht");
                // Pause-Minuten berechnen
                let pauseMin = 0;
                if (b.pause_von && b.pause_bis) {
                  const [pvh, pvm] = b.pause_von.split(":").map(Number);
                  const [pbh, pbm] = b.pause_bis.split(":").map(Number);
                  pauseMin = Math.max(0, (pbh * 60 + pbm) - (pvh * 60 + pvm));
                }
                const startRaw = (b.arbeitsbeginn || "").substring(0, 5);
                const start = startRaw || "?";
                const abfahrt = startRaw && b.total_stunden > 0
                  ? computeAbfahrt(startRaw, b.total_stunden, pauseMin)
                  : "?";
                // Edit-Routing: aktuelle Page (gleicher Typ) → setSearchParams; sonst navigate
                const editPath = isWerk ? "/werk-bericht" : isLkw ? "/lkw-bericht" : "/time-tracking";
                const isCurrentTyp = b.bericht_typ === berichtTyp;
                return (
                  <div key={b.id} className="flex items-center justify-between gap-2 p-2 rounded border bg-card">
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
                        if (isCurrentTyp) {
                          setSearchParams({ edit: b.id }, { replace: true });
                        } else {
                          navigate(`${editPath}?edit=${b.id}`);
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
              {existingTodayBerichte.some((b) => b.bericht_typ === berichtTyp) && (
                <div className="text-xs text-muted-foreground pt-1 border-t">
                  Speichern auf diesem Tag überschreibt den existierenden {pageTitle}.
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Zeitangaben */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Zeitangaben</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Arbeitsbeginn</Label>
                <Input type="time" step={900} value={arbeitsbeginn} onChange={(e) => setArbeitsbeginn(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Pause von</Label>
                <Input
                  type="time"
                  step={900}
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
                  step={900}
                  value={pauseBis}
                  onChange={(e) => setPauseBis(e.target.value)}
                  disabled={keinePause}
                  className={keinePause ? "opacity-50" : ""}
                />
              </div>
            </div>

            <div className="flex items-center gap-3 pt-1">
              <Switch
                id="keine-pause-matrix"
                checked={keinePause}
                onCheckedChange={setKeinePause}
              />
              <Label htmlFor="keine-pause-matrix" className="cursor-pointer">
                Keine Pause (kein Abzug)
              </Label>
            </div>

            {keinePause && (
              <div className="rounded-md border border-blue-200 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-800 px-3 py-2 text-xs text-blue-900 dark:text-blue-200">
                Diese Buchung enthält keine Pause. Falls du heute schon eine andere Buchung mit Pause angelegt hast, wird die Pause nur einmal abgezogen.
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="space-y-2">
                <Label>Pause</Label>
                <div className="flex items-center h-10 px-3 rounded-md border bg-muted text-sm">
                  {pauseMinuten} Minuten
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Projekt-Zeilen */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Projekte</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {projektZeilen.map((z, idx) => (
              <div key={z.localId} className="flex items-center gap-2">
                <span className="w-7 text-center font-mono text-sm font-bold text-muted-foreground shrink-0">
                  {idx + 1}.
                </span>
                <Select value={z.projektId || "none"} onValueChange={(v) => updateProjektZeile(z.localId, v === "none" ? "" : v)}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Projekt auswählen…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— kein Projekt —</SelectItem>
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => removeProjektZeile(z.localId)}
                  disabled={projektZeilen.length <= 1}
                  className="text-destructive hover:text-destructive shrink-0"
                  type="button"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={addProjektZeile}
              disabled={projektZeilen.length >= 12}
              className="w-full mt-2"
              type="button"
            >
              <Plus className="h-4 w-4 mr-2" />
              Projekt ({projektZeilen.length}/12)
            </Button>
          </CardContent>
        </Card>

        {/* Mitarbeiter & Stunden */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-lg">Mitarbeiter & Stunden</CardTitle>
              {canBookForOthers && (
                <Button variant="outline" size="sm" onClick={addEmptyMitarbeiterRow} type="button">
                  <Plus className="h-4 w-4 mr-1" />
                  Mitarbeiter
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* "Stunden für alle übernehmen"-Toggle (nur VA/Admin/PL) */}
            {canBookForOthers && (
              <div className="flex items-center gap-2 pb-2 border-b">
                <Switch
                  id="gleiche-stunden"
                  checked={gleicheStundenFuerAlle}
                  onCheckedChange={setGleicheStundenFuerAlle}
                />
                <Label htmlFor="gleiche-stunden" className="text-sm cursor-pointer">
                  Stunden für alle Mitarbeiter übernehmen
                </Label>
              </div>
            )}

            {/* MOBILE — eine Card pro Mitarbeiter */}
            <div className="sm:hidden space-y-3">
              {mitarbeiterRows.map((r) => {
                const summeGross = projektZeilen.reduce((s, z) => s + parseStunden(r.stunden[z.localId] || ""), 0);
                const summe = Math.max(0, summeGross - pauseHours);
                // Optionen für Select: alle MAs, die NICHT in anderen Zeilen schon ausgewählt sind, plus die aktuelle Auswahl
                const usedInOtherRows = new Set(
                  mitarbeiterRows.filter((x) => x.localId !== r.localId).map((x) => x.mitarbeiterId).filter(Boolean)
                );
                const selectOptions = availableMitarbeiter.filter((m) => m.id === r.mitarbeiterId || !usedInOtherRows.has(m.id));
                return (
                  <div key={r.localId} className="border-2 rounded-xl p-4 bg-card space-y-3">
                    <div className="flex items-center gap-2">
                      {canBookForOthers ? (
                        <Select
                          value={r.mitarbeiterId || ""}
                          onValueChange={(v) => updateMitarbeiterId(r.localId, v)}
                        >
                          <SelectTrigger className="h-11 text-base font-semibold flex-1">
                            <SelectValue placeholder="Mitarbeiter wählen…" />
                          </SelectTrigger>
                          <SelectContent>
                            {selectOptions.map((m) => (
                              <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="font-semibold text-base flex-1">
                          {availableMitarbeiter.find((m) => m.id === r.mitarbeiterId)?.name || "Ich"}
                        </span>
                      )}
                      {canBookForOthers && mitarbeiterRows.length > 1 && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeMitarbeiter(r.localId)}
                          className="text-destructive hover:text-destructive h-10 w-10 shrink-0"
                          type="button"
                          aria-label="Mitarbeiter entfernen"
                        >
                          <Trash2 className="h-5 w-5" />
                        </Button>
                      )}
                    </div>
                    <div className="space-y-2">
                      {projektZeilen.map((z, idx) => {
                        const projName = z.projektId ? (projektMap[z.projektId] || "?") : `Zeile ${idx + 1}`;
                        return (
                          <div key={z.localId} className="flex items-center gap-2">
                            <span className="w-5 text-right text-xs text-muted-foreground shrink-0 font-mono">{idx + 1}.</span>
                            <span className="flex-1 truncate text-sm">{projName}</span>
                            <Input
                              type="text"
                              inputMode="decimal"
                              value={r.stunden[z.localId] || ""}
                              onChange={(e) => updateMaStunden(r.localId, z.localId, e.target.value)}
                              placeholder="0"
                              className="w-20 text-center h-10 shrink-0 text-base"
                            />
                          </div>
                        );
                      })}
                    </div>
                    <div className={`text-right text-base font-bold rounded-lg px-3 py-2 ${summe > 0 ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200" : "bg-muted text-muted-foreground"}`}>
                      {summe > 0 ? `Σ ${summe.toFixed(2).replace(".", ",")} Stunden` : "Keine Stunden"}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* DESKTOP — Tabelle mit sticky Name-Spalte */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-2 font-semibold sticky left-0 z-10 bg-card min-w-[180px]">Mitarbeiter</th>
                    {projektZeilen.map((z, idx) => {
                      const projName = z.projektId ? (projektMap[z.projektId] || "?") : `Zeile ${idx + 1}`;
                      return (
                        <th key={z.localId} className="text-center p-2 font-semibold min-w-[80px]" title={projName}>
                          <div className="text-xs truncate max-w-[100px] mx-auto">{idx + 1}. {projName}</div>
                        </th>
                      );
                    })}
                    <th className="text-center p-2 font-semibold">Summe</th>
                    {canBookForOthers && <th className="w-8"></th>}
                  </tr>
                </thead>
                <tbody>
                  {mitarbeiterRows.map((r) => {
                    const summeGross = projektZeilen.reduce((s, z) => s + parseStunden(r.stunden[z.localId] || ""), 0);
                    const summe = Math.max(0, summeGross - pauseHours);
                    const usedInOtherRows = new Set(
                      mitarbeiterRows.filter((x) => x.localId !== r.localId).map((x) => x.mitarbeiterId).filter(Boolean)
                    );
                    const selectOptions = availableMitarbeiter.filter((m) => m.id === r.mitarbeiterId || !usedInOtherRows.has(m.id));
                    return (
                      <tr key={r.localId} className="border-b">
                        <td className="p-2 sticky left-0 z-10 bg-card">
                          {canBookForOthers ? (
                            <Select
                              value={r.mitarbeiterId || ""}
                              onValueChange={(v) => updateMitarbeiterId(r.localId, v)}
                            >
                              <SelectTrigger className="h-9">
                                <SelectValue placeholder="Mitarbeiter wählen…" />
                              </SelectTrigger>
                              <SelectContent>
                                {selectOptions.map((m) => (
                                  <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <span className="truncate">
                              {availableMitarbeiter.find((m) => m.id === r.mitarbeiterId)?.name || "Ich"}
                            </span>
                          )}
                        </td>
                        {projektZeilen.map((z) => (
                          <td key={z.localId} className="p-1 text-center">
                            <Input
                              type="text"
                              inputMode="decimal"
                              value={r.stunden[z.localId] || ""}
                              onChange={(e) => updateMaStunden(r.localId, z.localId, e.target.value)}
                              placeholder="0"
                              className="text-center h-9 px-1"
                            />
                          </td>
                        ))}
                        <td className="p-2 text-center font-semibold tabular-nums">{summe > 0 ? summe.toFixed(2).replace(".", ",") : "—"}</td>
                        {canBookForOthers && (
                          <td className="p-1">
                            {mitarbeiterRows.length > 1 && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => removeMitarbeiter(r.localId)}
                                className="text-destructive hover:text-destructive h-8 w-8"
                                type="button"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Zusätzliche Angaben (Geräte, Material, Anmerkungen) */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Zusätzliche Angaben</CardTitle>
          </CardHeader>
          <CardContent>
            <Accordion type="multiple" className="w-full">
              <AccordionItem value="geraete">
                <AccordionTrigger className="text-sm font-medium py-2">
                  Geräteeinsatz {geraete.length > 0 && <Badge variant="secondary" className="ml-2 text-xs">{geraete.length}</Badge>}
                </AccordionTrigger>
                <AccordionContent className="space-y-2 pb-4">
                  {geraete.map((g) => (
                    <div key={g.id} className="flex items-center gap-2">
                      <Select value={g.geraet || "none"} onValueChange={(v) => setGeraete((prev) => prev.map((x) => x.id === g.id ? { ...x, geraet: v === "none" ? "" : v } : x))}>
                        <SelectTrigger className="flex-1">
                          <SelectValue placeholder="Gerät" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">—</SelectItem>
                          {GERAETE_OPTIONEN.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Input
                        type="text"
                        inputMode="decimal"
                        value={g.stunden}
                        onChange={(e) => setGeraete((prev) => prev.map((x) => x.id === g.id ? { ...x, stunden: e.target.value } : x))}
                        placeholder="Std."
                        className="w-24"
                      />
                      <Button variant="ghost" size="icon" onClick={() => setGeraete((prev) => prev.filter((x) => x.id !== g.id))} type="button">
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  ))}
                  <Button variant="outline" size="sm" onClick={() => setGeraete((prev) => [...prev, { id: randomId(), geraet: "", stunden: "" }])} type="button">
                    <Plus className="h-4 w-4 mr-2" /> Gerät
                  </Button>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="material">
                <AccordionTrigger className="text-sm font-medium py-2">
                  Materialien {materialien.length > 0 && <Badge variant="secondary" className="ml-2 text-xs">{materialien.length}</Badge>}
                </AccordionTrigger>
                <AccordionContent className="space-y-2 pb-4">
                  {materialien.map((m) => (
                    <div key={m.id} className="flex items-center gap-2">
                      <Input
                        value={m.bezeichnung}
                        onChange={(e) => setMaterialien((prev) => prev.map((x) => x.id === m.id ? { ...x, bezeichnung: e.target.value } : x))}
                        placeholder="Bezeichnung"
                        className="flex-1"
                      />
                      <Input
                        value={m.menge}
                        onChange={(e) => setMaterialien((prev) => prev.map((x) => x.id === m.id ? { ...x, menge: e.target.value } : x))}
                        placeholder="Menge"
                        className="w-32"
                      />
                      <Button variant="ghost" size="icon" onClick={() => setMaterialien((prev) => prev.filter((x) => x.id !== m.id))} type="button">
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  ))}
                  <Button variant="outline" size="sm" onClick={() => setMaterialien((prev) => [...prev, { id: randomId(), bezeichnung: "", menge: "" }])} type="button">
                    <Plus className="h-4 w-4 mr-2" /> Material
                  </Button>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="anmerkungen">
                <AccordionTrigger className="text-sm font-medium py-2">Anmerkungen</AccordionTrigger>
                <AccordionContent className="pb-4">
                  <Textarea
                    value={anmerkungen}
                    onChange={(e) => setAnmerkungen(e.target.value)}
                    rows={3}
                    placeholder="Bemerkungen…"
                  />
                </AccordionContent>
              </AccordionItem>
            </Accordion>
            <div className="flex items-center gap-2 mt-3 pt-3 border-t">
              <Checkbox id="fertig" checked={fertiggestellt} onCheckedChange={(c) => setFertiggestellt(!!c)} />
              <Label htmlFor="fertig" className="text-sm">Bauvorhaben fertiggestellt</Label>
            </div>
          </CardContent>
        </Card>

        {/* Tagesgesamt-Zusammenfassung */}
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="pt-4 pb-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Mitarbeiter</span>
              <span className="font-medium">{mitarbeiterRows.filter((r) => r.mitarbeiterId).length}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Projekte</span>
              <span className="font-medium">{projektZeilen.filter((z) => z.projektId).length}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Stunden eingegeben (brutto)</span>
              <span className="font-medium tabular-nums">{tagGrossStunden.toFixed(2).replace(".", ",")}h</span>
            </div>
            <div className="flex items-center justify-between text-orange-700 dark:text-orange-400">
              <span className="text-sm">Pause-Abzug ({pauseMinuten} Min × {mitarbeiterRows.filter((r) => r.mitarbeiterId).length} MA)</span>
              <span className="font-medium tabular-nums">−{(pauseHours * mitarbeiterRows.filter((r) => r.mitarbeiterId).length).toFixed(2).replace(".", ",")}h</span>
            </div>
            <div className="flex items-center justify-between pt-2 border-t">
              <span className="text-base font-semibold">Stunden gebucht (netto)</span>
              <span className="text-xl font-bold tabular-nums">{tagTotalStunden.toFixed(2).replace(".", ",")}h</span>
            </div>
            {computedAbfahrt && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  {berichtTyp === "werk" ? "Arbeitsende" : "Abfahrt Baustelle"} (berechnet)
                </span>
                <span className="font-medium tabular-nums">{computedAbfahrt}</span>
              </div>
            )}
          </CardContent>
        </Card>
      </main>

      {/* Sticky Save-Bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-card border-t shadow-lg z-40">
        <div className="container mx-auto px-3 sm:px-4 py-3 max-w-3xl flex items-center gap-3">
          <div className="flex-1 text-sm text-muted-foreground">
            {editingBerichtId ? "Bearbeitung" : "Neuer Bericht"} · {tagTotalStunden.toFixed(2).replace(".", ",")}h gesamt
          </div>
          <Button onClick={handleSave} disabled={saving} size="lg" className="min-w-[140px]">
            <Save className="h-4 w-4 mr-2" />
            {saving ? "Speichern…" : "Speichern"}
          </Button>
        </div>
      </div>
    </div>
  );
}
