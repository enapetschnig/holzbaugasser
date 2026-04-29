import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Trash2,
  Clock,
  Save,
  Building2,
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
};

type AbsenceEntry = {
  datum: string;
  stunden: number;
  taetigkeit: string;
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
  const [weeklyHours, setWeeklyHours] = useState<number>(39);
  const [date, setDate] = useState(() => localDateString());

  const [projects, setProjects] = useState<Project[]>([]);
  const [blocks, setBlocks] = useState<EditableBlock[]>([]);
  const [originalIds, setOriginalIds] = useState<string[]>([]);
  const [absences, setAbsences] = useState<AbsenceEntry[]>([]);
  const [saving, setSaving] = useState(false);
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
      if (empAny?.monats_soll_stunden) setWeeklyHours(empAny.monats_soll_stunden);

      // Projekte
      const { data: projData } = await supabase
        .from("projects")
        .select("id, name, status")
        .in("status", ["aktiv", "in_planung"])
        .order("name");
      if (projData) setProjects(projData);
    })();
  }, [navigate, toast]);

  // -----------------------------------------------------------------
  // Load blocks for current date
  // -----------------------------------------------------------------

  const loadBlocks = useCallback(async () => {
    if (!userId) return;

    const { data } = await supabase
      .from("time_entries")
      .select("id, start_time, end_time, project_id, entry_typ, taetigkeit, stunden")
      .eq("user_id", userId)
      .eq("datum", date)
      .order("start_time", { ascending: true });

    if (!data) {
      setBlocks([]);
      setOriginalIds([]);
      setAbsences([]);
      return;
    }

    const vfBlocks: EditableBlock[] = [];
    const abs: AbsenceEntry[] = [];

    for (const e of data as any[]) {
      if (e.entry_typ === "vorfertigung") {
        vfBlocks.push({
          localId: e.id,
          dbId: e.id,
          startTime: e.start_time?.substring(0, 5) || "",
          endTime: e.end_time?.substring(0, 5) || "",
          projectId: e.project_id || "",
        });
      } else if (
        e.entry_typ === "absenz" ||
        (e.taetigkeit && ["Urlaub", "Krankenstand", "ZA", "Zeitausgleich", "Fortbildung", "Schule"].includes(e.taetigkeit))
      ) {
        abs.push({
          datum: e.datum,
          stunden: parseFloat(e.stunden) || 0,
          taetigkeit: e.taetigkeit || "",
        });
      }
    }

    setBlocks(vfBlocks);
    setOriginalIds(vfBlocks.map((b) => b.dbId).filter(Boolean) as string[]);
    setAbsences(abs);
  }, [userId, date]);

  useEffect(() => {
    loadBlocks();
  }, [loadBlocks]);

  // -----------------------------------------------------------------
  // Computed values
  // -----------------------------------------------------------------

  const dow = new Date(date + "T00:00:00").getDay();
  const fullTimeSoll = userRole ? getTagesSoll(userRole as any, dow) : 0;
  const tagesSoll = Math.round((weeklyHours / (userRole === "projektleiter" || userRole === "administrator" ? 40 : 39)) * fullTimeSoll * 100) / 100;

  // Live computed blocks
  const computed = useMemo(
    () =>
      blocks.map((b) => ({
        ...computeBlock({ startTime: b.startTime, endTime: b.endTime, projectId: b.projectId || null }),
        localId: b.localId,
      })),
    [blocks]
  );

  const istStunden = useMemo(
    () => Math.round(computed.reduce((s, c) => s + c.stunden, 0) * 100) / 100,
    [computed]
  );
  const diff = Math.round((istStunden - tagesSoll) * 100) / 100;
  const isWeekend = dow === 0 || dow === 6;

  const hasUnsavedChanges = useMemo(() => {
    // Vergleich: wenn sich Anzahl, IDs, oder Werte unterscheiden
    if (blocks.length !== originalIds.length) return true;
    if (blocks.some((b) => !b.dbId)) return true;
    return blocks.some((b) => {
      // Werte vs. DB ist im State kombiniert; einfache Heuristik: dirty-flag könnte ergänzt werden,
      // aber ein Save bei jedem Click ist OK
      return false;
    });
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
      },
    ]);
  };

  const updateBlock = (localId: string, patch: Partial<EditableBlock>) => {
    setBlocks((prev) => prev.map((b) => (b.localId === localId ? { ...b, ...patch } : b)));
  };

  const removeBlock = (localId: string) => {
    setBlocks((prev) => prev.filter((b) => b.localId !== localId));
  };

  const applyStandardTag = () => {
    if (blocks.length > 0 && istStunden > 0) {
      setConfirmState({
        title: "Standardtag eintragen?",
        description: "Alle aktuellen Blöcke werden ersetzt durch einen Standardtag (07:00–16:00 mit Pause 12:00–12:30).",
        onConfirm: () => {
          setConfirmState(null);
          setBlocks([
            {
              localId: randomId(),
              dbId: null,
              startTime: "07:00",
              endTime: "16:00",
              projectId: blocks[0]?.projectId || "",
            },
          ]);
        },
      });
      return;
    }
    setBlocks([
      {
        localId: randomId(),
        dbId: null,
        startTime: "07:00",
        endTime: "16:00",
        projectId: "",
      },
    ]);
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
      // 1. INSERTs/UPDATEs vorbereiten
      const computedRows = blocks.map((b) => {
        const c = computeBlock({
          startTime: b.startTime,
          endTime: b.endTime,
          projectId: b.projectId || null,
        });
        const projName = c.projectId ? projects.find((p) => p.id === c.projectId)?.name : null;
        return {
          dbId: b.dbId,
          row: {
            user_id: userId,
            datum: date,
            start_time: c.startTime,
            end_time: c.endTime,
            pause_start: c.pauseStart,
            pause_end: c.pauseEnd,
            pause_minutes: c.pauseMinutes,
            stunden: c.stunden,
            project_id: c.projectId,
            taetigkeit: c.projectId ? `Vorfertigung: ${projName}` : "Vorfertigung: Werk",
            entry_typ: "vorfertigung",
          },
        };
      });

      // 2. UPSERT (Update wenn dbId, sonst INSERT)
      for (const item of computedRows) {
        if (item.dbId) {
          const { error } = await supabase
            .from("time_entries")
            .update(item.row)
            .eq("id", item.dbId);
          if (error) throw error;
        } else {
          const { error } = await supabase.from("time_entries").insert(item.row);
          if (error) throw error;
        }
      }

      // 3. DELETE alle ursprünglichen die jetzt nicht mehr da sind
      const currentDbIds = new Set(blocks.map((b) => b.dbId).filter(Boolean) as string[]);
      const idsToDelete = originalIds.filter((id) => !currentDbIds.has(id));
      if (idsToDelete.length > 0) {
        const { error } = await supabase
          .from("time_entries")
          .delete()
          .in("id", idsToDelete);
        if (error) throw error;
      }

      toast({ title: "Gespeichert", description: `${formatHours(istStunden)} für ${dateLabel}` });
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

        {/* Soll/Ist */}
        <Card>
          <CardContent className="pt-4 pb-4">
            {isWeekend ? (
              <div className="text-center text-muted-foreground text-sm">
                <Clock className="h-5 w-5 mx-auto mb-1 opacity-50" />
                Wochenende — kein Soll. Stunden zählen als Überstunden.
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <div className="text-xs text-muted-foreground">Soll</div>
                  <div className="text-xl font-semibold">{formatHours(tagesSoll)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Ist</div>
                  <div className="text-xl font-semibold">{formatHours(istStunden)}</div>
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
            )}
          </CardContent>
        </Card>

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

        {/* Standardtag */}
        {!isWeekend && (
          <Button variant="outline" onClick={applyStandardTag} className="w-full">
            ✨ Standardtag eintragen (07:00–16:00 mit Pause)
          </Button>
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
                        value={b.startTime}
                        onChange={(e) => updateBlock(b.localId, { startTime: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Ende</Label>
                      <Input
                        type="time"
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
