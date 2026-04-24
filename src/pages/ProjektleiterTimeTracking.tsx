import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Trash2,
  Clock,
  AlertTriangle,
  Info,
  Save,
  Wand2,
  Building2,
} from "lucide-react";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { getTagesSoll, localDateString } from "@/lib/workingHours";
import {
  assembleDayTimes,
  aggregateByProject,
  type ProjectLine,
} from "@/lib/projektleiterDayTimes";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Project = { id: string; name: string };

type EditableLine = {
  localId: string;
  projectId: string;  // "" = Büro / kein Projekt
  hours: string;      // string during typing, "0.25"-step on save
};

type AbsenceEntry = {
  datum: string;
  stunden: number;
  taetigkeit: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatH(h: number): string {
  if (h === Math.floor(h)) return `${h}h`;
  return `${h.toFixed(2).replace(/\.00$/, "").replace(".", ",")}h`;
}

function parseHours(s: string): number {
  if (!s) return 0;
  const n = parseFloat(s.replace(",", "."));
  return isNaN(n) ? 0 : n;
}

function randomId(): string {
  return `tmp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ProjektleiterTimeTracking() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [userId, setUserId] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [weeklyHours, setWeeklyHours] = useState<number>(40);
  const [date, setDate] = useState(() => localDateString());

  const [projects, setProjects] = useState<Project[]>([]);
  const [lines, setLines] = useState<EditableLine[]>([]);
  const [originalLines, setOriginalLines] = useState<EditableLine[]>([]);
  const [absences, setAbsences] = useState<AbsenceEntry[]>([]);
  const [saving, setSaving] = useState(false);

  const [confirmState, setConfirmState] = useState<{
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);

  // -----------------------------------------------------------------
  // Init user + projects
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
      const role = roleData?.role || null;
      setUserRole(role);

      if (role !== "projektleiter" && role !== "administrator") {
        toast({
          variant: "destructive",
          title: "Kein Zugriff",
          description: "Diese Seite ist nur für Projektleiter.",
        });
        navigate("/");
        return;
      }

      const { data: emp } = await supabase
        .from("employees")
        .select("monats_soll_stunden")
        .eq("user_id", user.id)
        .maybeSingle();
      if (emp?.monats_soll_stunden) setWeeklyHours(emp.monats_soll_stunden);

      const { data: projData } = await supabase
        .from("projects")
        .select("id, name, status")
        .eq("status", "aktiv")
        .order("name");
      if (projData) setProjects(projData);
    })();
  }, [navigate, toast]);

  // -----------------------------------------------------------------
  // Load lines + absences for current date
  // -----------------------------------------------------------------

  const loadLines = useCallback(async () => {
    if (!userId) return;

    const { data } = await supabase
      .from("time_entries")
      .select("id, stunden, project_id, entry_typ, taetigkeit, datum")
      .eq("user_id", userId)
      .eq("datum", date);

    if (!data) {
      setLines([]);
      setOriginalLines([]);
      setAbsences([]);
      return;
    }

    // Aggregate PL rows by project (one row per unique project per day)
    const agg: Record<string, number> = {};
    const abs: AbsenceEntry[] = [];

    for (const e of data as any[]) {
      if (e.entry_typ === "projektleiter") {
        const key = e.project_id || "";
        agg[key] = (agg[key] || 0) + (parseFloat(e.stunden) || 0);
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

    const loaded: EditableLine[] = Object.entries(agg).map(([projectId, hours]) => ({
      localId: randomId(),
      projectId,
      hours: String(Math.round(hours * 100) / 100).replace(".", ","),
    }));

    setLines(loaded);
    setOriginalLines(loaded.map((l) => ({ ...l })));
    setAbsences(abs);
  }, [userId, date]);

  useEffect(() => {
    loadLines();
  }, [loadLines]);

  // -----------------------------------------------------------------
  // Computed values (LIVE from editing state)
  // -----------------------------------------------------------------

  const dow = new Date(date + "T00:00:00").getDay();
  const fullTimeSoll = userRole ? getTagesSoll(userRole as any, dow) : 0;
  const tagesSoll = Math.round((weeklyHours / 40) * fullTimeSoll * 100) / 100;
  const istStunden = useMemo(
    () => Math.round(lines.reduce((s, l) => s + parseHours(l.hours), 0) * 100) / 100,
    [lines]
  );
  const diff = Math.round((istStunden - tagesSoll) * 100) / 100;
  const isWeekend = dow === 0 || dow === 6;

  const hasUnsavedChanges = useMemo(() => {
    if (lines.length !== originalLines.length) return true;
    const a = lines.map((l) => `${l.projectId}|${l.hours}`).sort();
    const b = originalLines.map((l) => `${l.projectId}|${l.hours}`).sort();
    return a.some((v, i) => v !== b[i]);
  }, [lines, originalLines]);

  const parsedDate = new Date(date + "T00:00:00");
  const dateLabel = format(parsedDate, "EEEE, d. MMMM yyyy", { locale: de });

  // -----------------------------------------------------------------
  // Date navigation
  // -----------------------------------------------------------------

  const tryChangeDate = (newDate: string) => {
    if (hasUnsavedChanges) {
      setConfirmState({
        title: "Ungespeicherte Änderungen",
        message: "Du hast ungespeicherte Änderungen. Wirklich verwerfen?",
        onConfirm: () => {
          setConfirmState(null);
          setDate(newDate);
        },
      });
      return;
    }
    setDate(newDate);
  };

  const shiftDate = (days: number) => {
    const d = new Date(date + "T00:00:00");
    d.setDate(d.getDate() + days);
    tryChangeDate(localDateString(d));
  };

  const goToday = () => tryChangeDate(localDateString());

  // -----------------------------------------------------------------
  // Line mutations
  // -----------------------------------------------------------------

  const updateLine = (localId: string, patch: Partial<EditableLine>) => {
    setLines((prev) =>
      prev.map((l) => (l.localId === localId ? { ...l, ...patch } : l))
    );
  };

  const addLine = () => {
    setLines((prev) => [
      ...prev,
      { localId: randomId(), projectId: "", hours: "" },
    ]);
  };

  const removeLine = (localId: string) => {
    setLines((prev) => prev.filter((l) => l.localId !== localId));
  };

  const applyRegelarbeitszeit = () => {
    const preservedProject = lines[0]?.projectId || "";
    if (lines.length > 0 && istStunden > 0) {
      setConfirmState({
        title: "Standardtag eintragen?",
        message: "Alle aktuellen Einträge für diesen Tag werden ersetzt durch einen 8h-Standardtag.",
        onConfirm: () => {
          setConfirmState(null);
          setLines([{ localId: randomId(), projectId: preservedProject, hours: "8" }]);
        },
      });
      return;
    }
    setLines([{ localId: randomId(), projectId: "", hours: "8" }]);
  };

  // -----------------------------------------------------------------
  // Save
  // -----------------------------------------------------------------

  const doSave = async (force = false) => {
    if (!userId) return;

    // 1. Parse and validate lines
    const parsed: ProjectLine[] = [];
    for (const l of lines) {
      const h = parseHours(l.hours);
      if (h < 0) {
        toast({ variant: "destructive", title: "Ungültig", description: "Stunden dürfen nicht negativ sein." });
        return;
      }
      if (h > 16) {
        toast({ variant: "destructive", title: "Ungültig", description: "Pro Zeile maximal 16h." });
        return;
      }
      if (h > 0) {
        parsed.push({ projectId: l.projectId || null, hours: h });
      }
    }

    // 2. Aggregate same project
    const aggregated = aggregateByProject(parsed);
    const totalHours = aggregated.reduce((s, l) => s + l.hours, 0);

    if (totalHours > 16) {
      toast({
        variant: "destructive",
        title: "Zu viele Stunden",
        description: `Tagessumme ${totalHours.toFixed(2)}h überschreitet 16h-Tagesmaximum.`,
      });
      return;
    }

    if (!force) {
      // 3. >10h warning
      if (totalHours > 10) {
        setConfirmState({
          title: "Lange Arbeitszeit",
          message: `Tagessumme ${formatH(totalHours)} überschreitet 10h (AZG). Trotzdem speichern?`,
          onConfirm: () => {
            setConfirmState(null);
            doSave(true);
          },
        });
        return;
      }

      // 4. Absence conflict
      const blockingAbs = absences.find((a) =>
        ["Urlaub", "Krankenstand", "ZA", "Zeitausgleich"].includes(a.taetigkeit)
      );
      if (blockingAbs && totalHours > 0) {
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
      // 5. DELETE all existing PL entries for (user, date)
      const { error: delErr } = await supabase
        .from("time_entries")
        .delete()
        .eq("user_id", userId)
        .eq("datum", date)
        .eq("entry_typ", "projektleiter");
      if (delErr) throw delErr;

      // 6. If nothing to save, we're done
      if (aggregated.length === 0) {
        toast({ title: "Gespeichert", description: "Alle Einträge für diesen Tag entfernt." });
        await loadLines();
        return;
      }

      // 7. Assemble synthetic times and INSERT
      const assembled = assembleDayTimes(aggregated);
      const rows = assembled.map((r) => {
        const projName = r.projectId ? projects.find((p) => p.id === r.projectId)?.name : null;
        return {
          user_id: userId,
          datum: date,
          start_time: r.startTime,
          end_time: r.endTime,
          pause_start: r.pauseStart,
          pause_end: r.pauseEnd,
          pause_minutes: r.pauseMinutes,
          stunden: r.hours,
          project_id: r.projectId,
          taetigkeit: r.projectId ? `PL: ${projName}` : "PL: Büro",
          entry_typ: "projektleiter",
        };
      });

      const { error: insErr } = await supabase.from("time_entries").insert(rows);
      if (insErr) throw insErr;

      toast({ title: "Gespeichert", description: `${formatH(totalHours)} für ${dateLabel}` });
      await loadLines();
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

  // Preview: assembled rows for current input (to show expected times)
  const preview = useMemo(() => {
    const parsed: ProjectLine[] = lines
      .map((l) => ({ projectId: l.projectId || null, hours: parseHours(l.hours) }))
      .filter((l) => l.hours > 0);
    const agg = aggregateByProject(parsed);
    return assembleDayTimes(agg);
  }, [lines]);

  return (
    <div className="min-h-screen bg-background pb-24">
      <PageHeader title="Meine Zeiterfassung" />

      <main className="container mx-auto px-3 sm:px-4 py-4 sm:py-6 max-w-2xl space-y-4">
        {/* Info-Box */}
        <Accordion type="single" collapsible>
          <AccordionItem value="info" className="border rounded-lg bg-muted/30 px-3">
            <AccordionTrigger className="text-sm hover:no-underline">
              <div className="flex items-center gap-2">
                <Info className="h-4 w-4 text-primary" />
                <span>Wie funktioniert die Zeiterfassung?</span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="text-sm text-muted-foreground space-y-2 pb-3">
              <p>
                Trage nur die <strong>Stunden pro Projekt</strong> ein. Die Uhrzeiten
                (Start 07:00, Pause 12:00–13:00, Ende automatisch) werden beim Speichern
                berechnet.
              </p>
              <ul className="list-disc ml-5 space-y-1">
                <li><strong>40 Stunden/Woche</strong> (Mo–Fr je 8h). Mehr = Zeitkonto.</li>
                <li><strong>Pause 12:00–13:00</strong> automatisch ab 6h Arbeitszeit.</li>
                <li>Mehrere Projekte am Tag: werden in Eingabereihenfolge zeitlich aufgeteilt.</li>
                <li><strong>Urlaub / Krankenstand / ZA</strong>: über Menü "Abwesenheit" eintragen.</li>
                <li>Änderungen werden erst mit <strong>Speichern</strong> übernommen.</li>
              </ul>
            </AccordionContent>
          </AccordionItem>
        </Accordion>

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
                  onChange={(e) => tryChangeDate(e.target.value)}
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

        {/* Soll/Ist — LIVE */}
        <Card>
          <CardContent className="pt-4 pb-4">
            {isWeekend ? (
              <div className="text-center text-muted-foreground text-sm">
                <Clock className="h-5 w-5 mx-auto mb-1 opacity-50" />
                Wochenende — kein Soll. Arbeitszeit wird komplett als Überstunden gezählt.
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <div className="text-xs text-muted-foreground">Soll</div>
                  <div className="text-xl font-semibold">{formatH(tagesSoll)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Ist</div>
                  <div className="text-xl font-semibold">{formatH(istStunden)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Differenz</div>
                  <div
                    className={`text-xl font-semibold ${
                      diff > 0 ? "text-green-600" : diff < 0 ? "text-orange-500" : ""
                    }`}
                  >
                    {diff > 0 ? "+" : ""}
                    {formatH(diff)}
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

        {/* Regelarbeitszeit */}
        {!isWeekend && (
          <Button variant="outline" onClick={applyRegelarbeitszeit} className="w-full">
            <Wand2 className="h-4 w-4 mr-2" />
            Standardtag eintragen (8h)
          </Button>
        )}

        {/* Projekt-Zeilen */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center justify-between">
              <span>Stunden pro Projekt</span>
              <Badge variant="secondary">{lines.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {lines.length === 0 && (
              <div className="text-center text-sm text-muted-foreground py-4">
                Keine Einträge für diesen Tag.
              </div>
            )}

            {lines.map((l, idx) => (
              <div key={l.localId} className="flex gap-2 items-start">
                <div className="flex-1 space-y-2">
                  <Select
                    value={l.projectId || "none"}
                    onValueChange={(v) => updateLine(l.localId, { projectId: v === "none" ? "" : v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">🏢 Büro / kein Projekt</SelectItem>
                      {projects.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="w-24">
                  <Input
                    type="number"
                    inputMode="decimal"
                    step="0.25"
                    min="0"
                    max="16"
                    placeholder="0"
                    value={l.hours}
                    onChange={(e) => updateLine(l.localId, { hours: e.target.value })}
                    className="text-right"
                  />
                </div>
                <div className="w-12 text-sm text-muted-foreground pt-2 text-center">
                  h
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => removeLine(l.localId)}
                  className="text-destructive hover:text-destructive shrink-0"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}

            <Button variant="outline" onClick={addLine} className="w-full">
              <Plus className="h-4 w-4 mr-2" />
              Projekt hinzufügen
            </Button>
          </CardContent>
        </Card>

        {/* Vorschau der berechneten Zeiten */}
        {preview.length > 0 && (
          <Card className="border-primary/20 bg-primary/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Clock className="h-4 w-4" />
                Vorschau berechneter Zeiten
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 text-sm">
              {preview.map((r, i) => {
                const projName = r.projectId
                  ? projects.find((p) => p.id === r.projectId)?.name
                  : "Büro";
                return (
                  <div key={i} className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className="font-mono">
                      {r.startTime}–{r.endTime}
                    </Badge>
                    {r.pauseStart && (
                      <Badge variant="outline" className="text-xs">
                        Pause {r.pauseStart}–{r.pauseEnd}
                      </Badge>
                    )}
                    <Badge variant="secondary">{formatH(r.hours)}</Badge>
                    <span className="text-muted-foreground flex items-center gap-1 min-w-0 truncate">
                      <Building2 className="h-3 w-3 shrink-0" />
                      {projName}
                    </span>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}
      </main>

      {/* Sticky Save-Bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-card border-t shadow-lg z-40">
        <div className="container mx-auto px-3 sm:px-4 py-3 max-w-2xl flex items-center gap-3">
          <div className="flex-1 text-sm">
            {hasUnsavedChanges ? (
              <span className="text-orange-600 font-medium">Ungespeicherte Änderungen</span>
            ) : (
              <span className="text-muted-foreground">Alle Änderungen gespeichert</span>
            )}
          </div>
          <Button
            onClick={() => doSave(false)}
            disabled={saving || !hasUnsavedChanges}
            size="lg"
            className="min-w-[140px]"
          >
            <Save className="h-4 w-4 mr-2" />
            {saving ? "Speichern..." : "Speichern"}
          </Button>
        </div>
      </div>

      {/* Confirm-Dialog */}
      <Dialog open={!!confirmState} onOpenChange={(o) => !o && setConfirmState(null)}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>{confirmState?.title}</DialogTitle>
            <DialogDescription>{confirmState?.message}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirmState(null)}>Abbrechen</Button>
            <Button onClick={confirmState?.onConfirm}>Bestätigen</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
