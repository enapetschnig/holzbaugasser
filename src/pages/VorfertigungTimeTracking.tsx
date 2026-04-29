import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Trash2,
  Clock,
  Save,
  AlertTriangle,
  Coffee,
} from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { localDateString, getTagesSoll } from "@/lib/workingHours";
import {
  computeBlock,
  validateBlock,
  findOverlaps,
  suggestNextStart,
  type Block,
} from "@/lib/vorfertigungBlocks";

type Project = { id: string; name: string };

type EditableBlock = {
  localId: string;
  dbId: string | null;
  startTime: string;
  endTime: string;
  projectId: string;
  taetigkeit: string;
};

type TaetigkeitTemplate = {
  id: string;
  bezeichnung: string;
};

type AbsenceEntry = {
  datum: string;
  stunden: number;
  taetigkeit: string;
};

type OtherEntry = {
  type: "leistungsbericht" | "projektleiter";
  stunden: number;
  taetigkeit: string;
  projectName: string | null;
};

type MitarbeiterOption = {
  id: string;
  name: string;
  role: string | null;
};

function randomId(): string {
  return `tmp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function formatHours(h: number): string {
  if (h === Math.floor(h)) return `${h}h`;
  return `${h.toString().replace(".", ",")}h`;
}

export default function VorfertigungTimeTracking() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [userId, setUserId] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [customWeeklyHours, setCustomWeeklyHours] = useState<number | null>(null);
  const [date, setDate] = useState(() => localDateString());

  const [projects, setProjects] = useState<Project[]>([]);
  const [taetigkeitTemplates, setTaetigkeitTemplates] = useState<TaetigkeitTemplate[]>([]);
  const [blocks, setBlocks] = useState<EditableBlock[]>([]);
  const [originalIds, setOriginalIds] = useState<string[]>([]);
  const [absences, setAbsences] = useState<AbsenceEntry[]>([]);
  const [otherEntries, setOtherEntries] = useState<OtherEntry[]>([]);
  const [availableMitarbeiter, setAvailableMitarbeiter] = useState<MitarbeiterOption[]>([]);
  const [selectedMitarbeiterIds, setSelectedMitarbeiterIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const canBookForOthers = userRole === "administrator" || userRole === "vorarbeiter" || userRole === "projektleiter";
  const [confirmState, setConfirmState] = useState<{
    title: string;
    description: string;
    onConfirm: () => void;
  } | null>(null);

  // -----------------------------------------------------------------
  // Init
  // -----------------------------------------------------------------

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        navigate("/auth");
        return;
      }
      setUserId(user.id);

      const { data: roleData } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .maybeSingle();
      const role = (roleData?.role as string | null) || null;
      setUserRole(role);

      // Extern darf nicht
      if (role === "extern") {
        toast({
          variant: "destructive",
          title: "Kein Zugriff",
          description: "Externe Mitarbeiter haben keinen Zugriff auf diese Seite.",
        });
        navigate("/");
        return;
      }

      // Wochenstunden laden
      const { data: emp } = await supabase
        .from("employees")
        .select("monats_soll_stunden")
        .eq("user_id", user.id)
        .maybeSingle();
      const empAny = emp as any;
      if (empAny?.monats_soll_stunden) setCustomWeeklyHours(empAny.monats_soll_stunden);

      // Projekte
      const { data: projData } = await supabase
        .from("projects")
        .select("id, name, status")
        .in("status", ["aktiv", "in_planung"])
        .order("name");
      if (projData) setProjects(projData);

      // Tätigkeit-Templates
      const { data: tplData } = await (supabase as any)
        .from("taetigkeit_templates")
        .select("id, bezeichnung")
        .eq("is_active", true)
        .order("sort_order");
      if (tplData) setTaetigkeitTemplates(tplData);

      // Mitarbeiter-Auswahl: für VA/Admin/Projektleiter, damit sie für andere buchen können.
      if (role === "administrator" || role === "vorarbeiter" || role === "projektleiter") {
        const [profilesRes, rolesRes] = await Promise.all([
          supabase
            .from("profiles")
            .select("id, vorname, nachname, is_hidden")
            .eq("is_active", true)
            .order("nachname"),
          supabase.from("user_roles").select("user_id, role"),
        ]);
        const externIds = new Set(
          (rolesRes.data || [])
            .filter((r: any) => r.role === "extern")
            .map((r: any) => r.user_id)
        );
        const roleMap: Record<string, string> = {};
        (rolesRes.data || []).forEach((r: any) => { roleMap[r.user_id] = r.role; });
        const list: MitarbeiterOption[] = ((profilesRes.data || []) as any[])
          .filter((p) => !p.is_hidden && !externIds.has(p.id))
          .map((p) => ({
            id: p.id,
            name: `${p.vorname || ""} ${p.nachname || ""}`.trim() || "(ohne Name)",
            role: roleMap[p.id] || null,
          }));
        setAvailableMitarbeiter(list);
      }

      // Default: nur eigener User vorausgewählt
      setSelectedMitarbeiterIds([user.id]);
    })();
  }, [navigate, toast]);

  // -----------------------------------------------------------------
  // Load blocks for current date
  // -----------------------------------------------------------------

  const loadBlocks = useCallback(async () => {
    if (!userId) return;

    const { data } = await supabase
      .from("time_entries")
      .select("id, start_time, end_time, project_id, entry_typ, taetigkeit, stunden, datum")
      .eq("user_id", userId)
      .eq("datum", date)
      .order("start_time", { ascending: true });

    const ABSENCE_TAETIGKEITEN = ["Urlaub", "Krankenstand", "ZA", "Zeitausgleich", "Fortbildung", "Schule"];

    const vfBlocks: EditableBlock[] = [];
    const abs: AbsenceEntry[] = [];
    const others: OtherEntry[] = [];
    const projectIdsToResolve = new Set<string>();

    for (const e of (data as any[]) || []) {
      if (e.entry_typ === "vorfertigung") {
        // Tätigkeit aus DB-String extrahieren: "Vorfertigung: <projekt> — <taetigkeit>" → taetigkeit
        const rawT = (e.taetigkeit as string) || "";
        const sepIdx = rawT.indexOf(" — ");
        const extractedTaetigkeit = sepIdx > -1 ? rawT.substring(sepIdx + 3) : "";
        vfBlocks.push({
          localId: e.id,
          dbId: e.id,
          startTime: e.start_time?.substring(0, 5) || "",
          endTime: e.end_time?.substring(0, 5) || "",
          projectId: e.project_id || "",
          taetigkeit: extractedTaetigkeit,
        });
      } else if (
        e.entry_typ === "absenz" ||
        (e.taetigkeit && ABSENCE_TAETIGKEITEN.includes(e.taetigkeit))
      ) {
        abs.push({
          datum: e.datum,
          stunden: parseFloat(e.stunden) || 0,
          taetigkeit: e.taetigkeit || "",
        });
      } else if (e.entry_typ === "projektleiter") {
        if (e.project_id) projectIdsToResolve.add(e.project_id);
        others.push({
          type: "projektleiter",
          stunden: parseFloat(e.stunden) || 0,
          taetigkeit: e.taetigkeit || "",
          projectName: null,
        });
      } else {
        // entry_typ NULL oder 'leistungsbericht' → reguläre Leistungsbericht-Stunden
        if (e.project_id) projectIdsToResolve.add(e.project_id);
        others.push({
          type: "leistungsbericht",
          stunden: parseFloat(e.stunden) || 0,
          taetigkeit: e.taetigkeit || "",
          projectName: null,
        });
      }
    }

    // Projektnamen für Other-Entries auflösen
    if (projectIdsToResolve.size > 0) {
      const { data: projData } = await supabase
        .from("projects")
        .select("id, name")
        .in("id", Array.from(projectIdsToResolve));
      const projNameMap: Record<string, string> = {};
      (projData || []).forEach((p: any) => { projNameMap[p.id] = p.name; });
      // Ergänze projectName direkt aus den ursprünglichen DB-Daten
      let i = 0;
      for (const e of (data as any[]) || []) {
        if (e.entry_typ === "vorfertigung" || e.entry_typ === "absenz") continue;
        if (e.taetigkeit && ABSENCE_TAETIGKEITEN.includes(e.taetigkeit)) continue;
        if (others[i]) {
          others[i].projectName = e.project_id ? projNameMap[e.project_id] || null : null;
          i++;
        }
      }
    }

    const dbIds = vfBlocks.map((b) => b.dbId).filter(Boolean) as string[];

    // Auto-Fill: leerer Tag ohne blockierende Absenz → einen leeren Block ab 07:00 vorschlagen
    const blockingAbs = abs.some((a) =>
      ["Urlaub", "Krankenstand", "ZA", "Zeitausgleich"].includes(a.taetigkeit)
    );
    if (vfBlocks.length === 0 && !blockingAbs) {
      vfBlocks.push({
        localId: randomId(),
        dbId: null,
        startTime: "07:00",
        endTime: "",
        projectId: "",
        taetigkeit: "",
      });
    }

    setBlocks(vfBlocks);
    setOriginalIds(dbIds);
    setAbsences(abs);
    setOtherEntries(others);
  }, [userId, date]);

  useEffect(() => {
    loadBlocks();
  }, [loadBlocks]);

  // -----------------------------------------------------------------
  // Computed values
  // -----------------------------------------------------------------

  const dow = new Date(date + "T00:00:00").getDay();
  const fullTimeSoll = userRole ? getTagesSoll(userRole as any, dow) : 0;
  const fullTimeWeekly = userRole === "projektleiter" || userRole === "administrator" ? 40 : 39;
  const effectiveWeekly = customWeeklyHours ?? fullTimeWeekly;
  const tagesSoll = Math.round((effectiveWeekly / fullTimeWeekly) * fullTimeSoll * 100) / 100;

  // Live computed blocks
  const computed = useMemo(
    () =>
      blocks.map((b) => ({
        ...computeBlock({ startTime: b.startTime, endTime: b.endTime, projectId: b.projectId || null }),
        localId: b.localId,
      })),
    [blocks]
  );

  const istVorfertigung = useMemo(
    () => Math.round(computed.reduce((s, c) => s + c.stunden, 0) * 100) / 100,
    [computed]
  );
  const istAndere = useMemo(
    () => Math.round(otherEntries.reduce((s, o) => s + o.stunden, 0) * 100) / 100,
    [otherEntries]
  );
  const istGesamt = Math.round((istVorfertigung + istAndere) * 100) / 100;
  const diff = Math.round((istGesamt - tagesSoll) * 100) / 100;
  const isWeekend = dow === 0 || dow === 6;

  const hasUnsavedChanges = useMemo(() => {
    // Neuer Block mit Inhalt (dbId=null + endTime gesetzt)?
    if (blocks.some((b) => !b.dbId && b.endTime)) return true;
    // DB-Block gelöscht? (Anzahl gespeicherter Blöcke != originale Anzahl)
    const savedCount = blocks.filter((b) => b.dbId).length;
    if (savedCount !== originalIds.length) return true;
    return false;
  }, [blocks, originalIds]);

  const dateLabel = format(new Date(date + "T00:00:00"), "EEEE, d. MMMM yyyy", { locale: de });

  // -----------------------------------------------------------------
  // Date navigation
  // -----------------------------------------------------------------

  const shiftDate = (days: number) => {
    const d = new Date(date + "T00:00:00");
    d.setDate(d.getDate() + days);
    setDate(localDateString(d));
  };
  const goToday = () => setDate(localDateString());

  // -----------------------------------------------------------------
  // Block mutations
  // -----------------------------------------------------------------

  const addBlock = () => {
    const startSuggestion = suggestNextStart(
      blocks.map((b) => ({ startTime: b.startTime, endTime: b.endTime, projectId: null }))
    );
    setBlocks((prev) => [
      ...prev,
      {
        localId: randomId(),
        dbId: null,
        startTime: startSuggestion,
        endTime: "",
        projectId: "",
        taetigkeit: "",
      },
    ]);
  };

  const updateBlock = (localId: string, patch: Partial<EditableBlock>) => {
    setBlocks((prev) => prev.map((b) => (b.localId === localId ? { ...b, ...patch } : b)));
  };

  const removeBlock = (localId: string) => {
    setBlocks((prev) => prev.filter((b) => b.localId !== localId));
  };

  // -----------------------------------------------------------------
  // Save
  // -----------------------------------------------------------------

  const doSave = async (force = false) => {
    if (!userId) return;

    // Validierung
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      const err = validateBlock({ startTime: b.startTime, endTime: b.endTime, projectId: b.projectId || null });
      if (err) {
        toast({
          variant: "destructive",
          title: `Block ${i + 1}: ${err}`,
        });
        return;
      }
    }

    // Überlappungs-Check (Warnung)
    if (!force) {
      const overlaps = findOverlaps(
        blocks.map((b) => ({ startTime: b.startTime, endTime: b.endTime, projectId: null }))
      );
      if (overlaps.length > 0) {
        setConfirmState({
          title: "Überlappende Blöcke",
          description: `${overlaps.length} Block-Paar(e) überlappen zeitlich. Trotzdem speichern?`,
          onConfirm: () => {
            setConfirmState(null);
            doSave(true);
          },
        });
        return;
      }

      // Absenz-Konflikt
      const blockingAbs = absences.find((a) =>
        ["Urlaub", "Krankenstand", "ZA", "Zeitausgleich"].includes(a.taetigkeit)
      );
      if (blockingAbs && blocks.length > 0) {
        toast({
          variant: "destructive",
          title: "Konflikt",
          description: `An diesem Tag ist "${blockingAbs.taetigkeit}" eingetragen. Bitte zuerst entfernen.`,
        });
        return;
      }
    }

    setSaving(true);
    try {
      // Welche User bekommen NEUE Blöcke? Standard: nur der eingeloggte.
      // Vorarbeiter/Admin können in der UI weitere MAs auswählen.
      const targetUserIds = canBookForOthers && selectedMitarbeiterIds.length > 0
        ? Array.from(new Set([userId, ...selectedMitarbeiterIds]))
        : [userId];

      // 1. Rows pro Block berechnen
      const buildRowFor = (b: typeof blocks[number], targetUid: string) => {
        const c = computeBlock({
          startTime: b.startTime,
          endTime: b.endTime,
          projectId: b.projectId || null,
        });
        const projName = c.projectId ? projects.find((p) => p.id === c.projectId)?.name : null;
        const baseLabel = c.projectId ? `Vorfertigung: ${projName}` : "Vorfertigung: Werk";
        const userTaetigkeit = (b.taetigkeit || "").trim();
        const fullTaetigkeit = userTaetigkeit ? `${baseLabel} — ${userTaetigkeit}` : baseLabel;
        return {
          user_id: targetUid,
          datum: date,
          start_time: c.startTime,
          end_time: c.endTime,
          pause_start: c.pauseStart,
          pause_end: c.pauseEnd,
          pause_minutes: c.pauseMinutes,
          stunden: c.stunden,
          project_id: c.projectId,
          taetigkeit: fullTaetigkeit,
          entry_typ: "vorfertigung",
        };
      };

      // 2. Existierende Blöcke (mit dbId) UPDATE — nur für eigenen User
      // Neue Blöcke (ohne dbId) INSERT für alle targetUserIds
      const newInserts: ReturnType<typeof buildRowFor>[] = [];
      for (const b of blocks) {
        if (b.dbId) {
          // Update: bleibt am eigenen User (dbId gehört zum eingeloggten User)
          const { error } = await supabase
            .from("time_entries")
            .update(buildRowFor(b, userId))
            .eq("id", b.dbId);
          if (error) throw error;
        } else {
          // Neuer Block → für jeden ausgewählten MA eine Zeile
          for (const targetUid of targetUserIds) {
            newInserts.push(buildRowFor(b, targetUid));
          }
        }
      }
      if (newInserts.length > 0) {
        const { error } = await supabase.from("time_entries").insert(newInserts);
        if (error) throw error;
      }

      // 3. DELETE: nur eigene Blöcke, die nicht mehr im UI sind.
      const currentDbIds = new Set(blocks.map((b) => b.dbId).filter(Boolean) as string[]);
      const idsToDelete = originalIds.filter((id) => !currentDbIds.has(id));
      if (idsToDelete.length > 0) {
        const { error } = await supabase
          .from("time_entries")
          .delete()
          .in("id", idsToDelete);
        if (error) throw error;
      }

      const extraCount = targetUserIds.length - 1;
      const desc = extraCount > 0
        ? `${formatHours(istVorfertigung)} für dich + ${extraCount} weitere Mitarbeiter`
        : `${formatHours(istVorfertigung)} Vorfertigung für ${dateLabel}`;
      toast({ title: "Gespeichert", description: desc });
      await loadBlocks();
    } catch (err: any) {
      console.error("Save failed:", err);
      toast({
        variant: "destructive",
        title: "Fehler",
        description: err.message || "Speichern fehlgeschlagen.",
      });
    } finally {
      setSaving(false);
    }
  };

  // -----------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------

  return (
    <div className="min-h-screen bg-background pb-24">
      <PageHeader title="Vorfertigung / LKW-Fahrer" />

      <main className="container mx-auto px-3 sm:px-4 py-4 sm:py-6 max-w-2xl space-y-4">
        {/* Datum-Navigation */}
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center justify-between gap-2">
              <Button variant="outline" size="icon" onClick={() => shiftDate(-1)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div className="flex-1 text-center">
                <Input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="mx-auto max-w-[200px] text-center"
                />
                <div className="text-xs text-muted-foreground mt-1">{dateLabel}</div>
              </div>
              <Button variant="outline" size="icon" onClick={() => shiftDate(1)}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            {date !== localDateString() && (
              <Button variant="ghost" size="sm" onClick={goToday} className="w-full mt-2">
                Zurück zu heute
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Mitarbeiter-Auswahl (nur Vorarbeiter/Admin) */}
        {canBookForOthers && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Mitarbeiter</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="text-xs text-muted-foreground">
                Diese Blöcke werden für alle ausgewählten Mitarbeiter gespeichert.
              </div>
              <div className="flex flex-wrap gap-2">
                {availableMitarbeiter.map((m) => {
                  const isSelected = selectedMitarbeiterIds.includes(m.id);
                  const isSelf = m.id === userId;
                  return (
                    <Badge
                      key={m.id}
                      variant={isSelected ? "default" : "outline"}
                      className={`cursor-pointer text-xs py-1.5 px-3 ${isSelf ? "ring-1 ring-primary/40" : ""}`}
                      onClick={() => {
                        if (isSelf) return; // eigener Eintrag bleibt fix
                        setSelectedMitarbeiterIds((prev) =>
                          prev.includes(m.id)
                            ? prev.filter((id) => id !== m.id)
                            : [...prev, m.id]
                        );
                      }}
                    >
                      {isSelected && <span className="mr-1">✓</span>}
                      {m.name}
                      {isSelf && <span className="ml-1 opacity-60">(ich)</span>}
                    </Badge>
                  );
                })}
              </div>
              <div className="text-xs text-muted-foreground border-t pt-2">
                {selectedMitarbeiterIds.length === 1
                  ? "Buchung nur für dich."
                  : `Buchung für ${selectedMitarbeiterIds.length} Mitarbeiter.`}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Soll/Ist */}
        <Card>
          <CardContent className="pt-4 pb-4">
            {isWeekend ? (
              <div className="text-center text-muted-foreground text-sm">
                <Clock className="h-5 w-5 mx-auto mb-1 opacity-50" />
                Wochenende — kein Soll. Stunden zählen als Überstunden.
              </div>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <div className="text-xs text-muted-foreground">Soll</div>
                    <div className="text-xl font-semibold">{formatHours(tagesSoll)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Tag-Total</div>
                    <div className="text-xl font-semibold">{formatHours(istGesamt)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Differenz</div>
                    <div
                      className={`text-xl font-semibold ${
                        diff > 0 ? "text-green-600" : diff < 0 ? "text-orange-500" : ""
                      }`}
                    >
                      {diff > 0 ? "+" : ""}
                      {formatHours(diff)}
                    </div>
                  </div>
                </div>
                {istAndere > 0 && (
                  <div className="mt-3 pt-3 border-t text-xs text-muted-foreground flex justify-between">
                    <span>davon Vorfertigung:</span>
                    <span className="font-medium text-foreground">{formatHours(istVorfertigung)}</span>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Cross-Type-Warnung: Stunden aus LB/PL bereits gebucht */}
        {otherEntries.length > 0 && (
          <Card className="border-blue-200 bg-blue-50 dark:bg-blue-950/30">
            <CardContent className="pt-4 pb-4 space-y-2">
              <div className="flex gap-2 items-start">
                <AlertTriangle className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
                <div className="text-sm font-medium">
                  Bereits an diesem Tag gebucht (außerhalb Vorfertigung):
                </div>
              </div>
              <ul className="text-sm space-y-1 ml-6">
                {otherEntries.map((o, idx) => (
                  <li key={idx} className="flex justify-between gap-3">
                    <span>
                      {o.type === "leistungsbericht" ? "Leistungsbericht" : "Projektleiter"}
                      {o.projectName ? ` — ${o.projectName}` : ""}
                    </span>
                    <span className="font-medium tabular-nums">{formatHours(o.stunden)}</span>
                  </li>
                ))}
              </ul>
              <div className="text-xs text-muted-foreground ml-6 pt-1 border-t">
                Vorfertigung-Blöcke kommen <strong>zusätzlich</strong> zu diesen Stunden — bitte prüfen, dass keine Doppelbuchung entsteht.
              </div>
            </CardContent>
          </Card>
        )}

        {/* Absenz-Warnung */}
        {absences.length > 0 && (
          <Card className="border-orange-200 bg-orange-50 dark:bg-orange-950/30">
            <CardContent className="pt-4 pb-4 flex gap-2 items-start">
              <AlertTriangle className="h-4 w-4 text-orange-600 shrink-0 mt-0.5" />
              <div className="text-sm">
                Für diesen Tag ist <strong>{absences.map((a) => a.taetigkeit).join(", ")}</strong> eingetragen.
              </div>
            </CardContent>
          </Card>
        )}

        {/* Blöcke */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center justify-between">
              <span>Zeitblöcke</span>
              <Badge variant="secondary">{blocks.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {blocks.length === 0 && (
              <div className="text-center text-sm text-muted-foreground py-4">
                Noch keine Blöcke für diesen Tag. Klick auf "Neuer Block" zum Hinzufügen.
              </div>
            )}

            {blocks.map((b, idx) => {
              const c = computed[idx];
              const err = validateBlock({ startTime: b.startTime, endTime: b.endTime, projectId: b.projectId || null });
              return (
                <div
                  key={b.localId}
                  className={`border rounded-lg p-3 space-y-3 ${err ? "border-destructive/40" : "border-primary/20"}`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="font-mono">#{idx + 1}</Badge>
                      <span className="font-semibold">
                        {c?.stunden > 0 ? formatHours(c.stunden) : "—"}
                      </span>
                      {c?.pauseMinutes ? (
                        <Badge variant="outline" className="text-xs">
                          <Coffee className="h-3 w-3 mr-1" />
                          Pause 12:00–12:30 abgezogen
                        </Badge>
                      ) : null}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeBlock(b.localId)}
                      className="text-destructive hover:text-destructive h-8 w-8"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Start</Label>
                      <Input
                        type="time"
                        step={900}
                        value={b.startTime}
                        onChange={(e) => updateBlock(b.localId, { startTime: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Ende</Label>
                      <Input
                        type="time"
                        step={900}
                        value={b.endTime}
                        onChange={(e) => updateBlock(b.localId, { endTime: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs">Projekt</Label>
                    <Select
                      value={b.projectId || "none"}
                      onValueChange={(v) => updateBlock(b.localId, { projectId: v === "none" ? "" : v })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">🏢 Werk / kein Projekt</SelectItem>
                        {projects.map((p) => (
                          <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs">Tätigkeit (optional)</Label>
                    <Input
                      list={`taetigkeit-templates-${b.localId}`}
                      placeholder="z.B. Lieferung, Abbund..."
                      value={b.taetigkeit}
                      onChange={(e) => updateBlock(b.localId, { taetigkeit: e.target.value })}
                    />
                    <datalist id={`taetigkeit-templates-${b.localId}`}>
                      {taetigkeitTemplates.map((t) => (
                        <option key={t.id} value={t.bezeichnung} />
                      ))}
                    </datalist>
                  </div>

                  {err && (
                    <div className="text-xs text-destructive flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      {err}
                    </div>
                  )}
                </div>
              );
            })}

            <Button variant="outline" onClick={addBlock} className="w-full">
              <Plus className="h-4 w-4 mr-2" />
              Neuer Block
            </Button>
          </CardContent>
        </Card>
      </main>

      {/* Sticky Save-Bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-card border-t shadow-lg z-40">
        <div className="container mx-auto px-3 sm:px-4 py-3 max-w-2xl flex items-center gap-3">
          <div className="flex-1 text-sm">
            {hasUnsavedChanges ? (
              <span className="text-orange-600 font-medium">Ungespeicherte Änderungen</span>
            ) : (
              <span className="text-muted-foreground">Alles gespeichert</span>
            )}
          </div>
          <Button
            onClick={() => doSave(false)}
            disabled={saving || (blocks.length === 0 && originalIds.length === 0)}
            size="lg"
            className="min-w-[140px]"
          >
            <Save className="h-4 w-4 mr-2" />
            {saving ? "Speichern..." : "Speichern"}
          </Button>
        </div>
      </div>

      <AlertDialog open={!!confirmState} onOpenChange={(o) => !o && setConfirmState(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmState?.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirmState?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={confirmState?.onConfirm}>Bestätigen</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
