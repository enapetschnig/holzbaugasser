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
  Pencil,
  Coffee,
  Building2,
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Project = { id: string; name: string };

/** Local block: server id if saved, temp id if new */
type EditableBlock = {
  localId: string;           // stable local key
  dbId: string | null;       // null = new block
  startTime: string;         // "HH:mm"
  endTime: string;           // "HH:mm"
  pauseStart: string;        // "" or "HH:mm"
  pauseEnd: string;          // "" or "HH:mm"
  projectId: string;         // "" (Büro) or UUID
  dirty: boolean;            // has local changes vs. DB
};

type AbsenceEntry = {
  datum: string;
  stunden: number;
  taetigkeit: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeToMin(t: string): number | null {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
}

/** Pause in minutes from pauseStart/pauseEnd (both "HH:mm" or empty). */
function pauseMinutes(pauseStart: string, pauseEnd: string): number {
  const s = timeToMin(pauseStart);
  const e = timeToMin(pauseEnd);
  if (s == null || e == null) return 0;
  return Math.max(0, e - s);
}

/** Computes net work hours for a block. */
function blockHours(b: EditableBlock): number {
  const s = timeToMin(b.startTime);
  const e = timeToMin(b.endTime);
  if (s == null || e == null) return 0;
  const gross = e - s;
  const pause = pauseMinutes(b.pauseStart, b.pauseEnd);
  const net = gross - pause;
  if (net <= 0) return 0;
  return Math.round((net / 60) * 100) / 100;
}

function formatH(h: number): string {
  if (h === Math.floor(h)) return `${h}h`;
  return `${h.toFixed(2).replace(/\.00$/, "").replace(".", ",")}h`;
}

/** Validate a block. Returns error message or null. */
function validateBlock(b: EditableBlock): string | null {
  const s = timeToMin(b.startTime);
  const e = timeToMin(b.endTime);
  if (s == null || e == null) return "Start- und Endzeit sind erforderlich";
  if (e <= s) return "Ende muss nach Start liegen";
  // Pause in range
  const ps = timeToMin(b.pauseStart);
  const pe = timeToMin(b.pauseEnd);
  if ((ps != null) !== (pe != null)) return "Pause: beide Zeiten oder keine";
  if (ps != null && pe != null) {
    if (pe <= ps) return "Pause-Ende muss nach Pause-Start liegen";
    if (ps < s || pe > e) return "Pause muss innerhalb des Blocks liegen";
  }
  const h = blockHours(b);
  if (h <= 0) return "Block hat 0h (Pause zu lang?)";
  return null;
}

function overlaps(a: EditableBlock, b: EditableBlock): boolean {
  const aS = timeToMin(a.startTime);
  const aE = timeToMin(a.endTime);
  const bS = timeToMin(b.startTime);
  const bE = timeToMin(b.endTime);
  if (aS == null || aE == null || bS == null || bE == null) return false;
  return aS < bE && bS < aE;
}

function randomId(): string {
  return `tmp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Default Regelarbeitszeit block: 07:00–16:00, Pause 12:00–13:00 (= 8h net, 40h/Woche) */
function defaultBlock(projectId: string = ""): Omit<EditableBlock, "localId" | "dbId" | "dirty"> {
  return {
    startTime: "07:00",
    endTime: "16:00",
    pauseStart: "12:00",
    pauseEnd: "13:00",
    projectId,
  };
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
  const [blocks, setBlocks] = useState<EditableBlock[]>([]);
  const [deletedIds, setDeletedIds] = useState<string[]>([]);
  const [absences, setAbsences] = useState<AbsenceEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

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
  // Load blocks + absences for current date
  // -----------------------------------------------------------------

  const loadBlocks = useCallback(async () => {
    if (!userId) return;

    const { data } = await supabase
      .from("time_entries")
      .select("id, start_time, end_time, pause_start, pause_end, pause_minutes, project_id, entry_typ, taetigkeit, stunden, datum")
      .eq("user_id", userId)
      .eq("datum", date)
      .order("start_time", { ascending: true });

    if (!data) {
      setBlocks([]);
      setAbsences([]);
      setDeletedIds([]);
      return;
    }

    const plBlocks: EditableBlock[] = [];
    const abs: AbsenceEntry[] = [];

    for (const e of data as any[]) {
      if (e.entry_typ === "projektleiter") {
        plBlocks.push({
          localId: e.id,
          dbId: e.id,
          startTime: e.start_time?.substring(0, 5) || "",
          endTime: e.end_time?.substring(0, 5) || "",
          pauseStart: e.pause_start?.substring(0, 5) || "",
          pauseEnd: e.pause_end?.substring(0, 5) || "",
          projectId: e.project_id || "",
          dirty: false,
        });
      } else if (e.entry_typ === "absenz" || (e.taetigkeit && ["Urlaub", "Krankenstand", "ZA", "Zeitausgleich", "Fortbildung", "Schule"].includes(e.taetigkeit))) {
        abs.push({
          datum: e.datum,
          stunden: parseFloat(e.stunden) || 0,
          taetigkeit: e.taetigkeit || "",
        });
      }
    }

    setBlocks(plBlocks);
    setAbsences(abs);
    setDeletedIds([]);
  }, [userId, date]);

  useEffect(() => {
    loadBlocks();
  }, [loadBlocks]);

  // -----------------------------------------------------------------
  // Computed values (LIVE from editing state)
  // -----------------------------------------------------------------

  const dow = new Date(date + "T00:00:00").getDay();
  const fullTimeSoll = userRole ? getTagesSoll(userRole as any, dow) : 0;
  const tagesSoll = Math.round((weeklyHours / 40) * fullTimeSoll * 100) / 100;
  const istStunden = useMemo(
    () => Math.round(blocks.reduce((s, b) => s + blockHours(b), 0) * 100) / 100,
    [blocks]
  );
  const diff = Math.round((istStunden - tagesSoll) * 100) / 100;
  const isWeekend = dow === 0 || dow === 6;

  const hasUnsavedChanges = useMemo(
    () => blocks.some((b) => b.dirty || !b.dbId) || deletedIds.length > 0,
    [blocks, deletedIds]
  );

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
  // Block mutations (local state only — commit via "Speichern")
  // -----------------------------------------------------------------

  const updateBlock = (localId: string, patch: Partial<EditableBlock>) => {
    setBlocks((prev) =>
      prev.map((b) => (b.localId === localId ? { ...b, ...patch, dirty: true } : b))
    );
  };

  const addBlock = () => {
    const last = blocks[blocks.length - 1];
    const suggested = last
      ? {
          // New block starts after last block end
          startTime: last.endTime || "13:00",
          endTime: "",
          pauseStart: "",
          pauseEnd: "",
          projectId: last.projectId,
        }
      : { ...defaultBlock(), startTime: "", endTime: "" };
    const newId = randomId();
    setBlocks((prev) => [
      ...prev,
      {
        localId: newId,
        dbId: null,
        ...suggested,
        dirty: true,
      },
    ]);
    setExpandedId(newId);
  };

  const removeBlock = (localId: string) => {
    const b = blocks.find((x) => x.localId === localId);
    if (b?.dbId) {
      setDeletedIds((prev) => [...prev, b.dbId!]);
    }
    setBlocks((prev) => prev.filter((x) => x.localId !== localId));
  };

  const applyRegelarbeitszeit = () => {
    if (blocks.length > 0) {
      setConfirmState({
        title: "Regelarbeitszeit übernehmen?",
        message: "Alle bestehenden Blöcke für diesen Tag werden ersetzt.",
        onConfirm: () => {
          setConfirmState(null);
          const preservedProject = blocks[0]?.projectId || "";
          const toDelete = blocks.filter((b) => b.dbId).map((b) => b.dbId!);
          setDeletedIds((prev) => [...prev, ...toDelete]);
          setBlocks([
            {
              localId: randomId(),
              dbId: null,
              ...defaultBlock(preservedProject),
              dirty: true,
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
        ...defaultBlock(),
        dirty: true,
      },
    ]);
  };

  // -----------------------------------------------------------------
  // Save all changes to DB
  // -----------------------------------------------------------------

  const doSave = async (force = false) => {
    if (!userId) return;

    // 1. Validate all blocks
    for (const b of blocks) {
      const err = validateBlock(b);
      if (err) {
        toast({ variant: "destructive", title: "Block ungültig", description: err });
        return;
      }
    }

    if (!force) {
      // 2. Overlap warning
      const overlapping: [EditableBlock, EditableBlock][] = [];
      for (let i = 0; i < blocks.length; i++) {
        for (let j = i + 1; j < blocks.length; j++) {
          if (overlaps(blocks[i], blocks[j])) overlapping.push([blocks[i], blocks[j]]);
        }
      }
      if (overlapping.length > 0) {
        setConfirmState({
          title: "Überlappende Blöcke",
          message: `${overlapping.length} Block-Paar(e) überlappen zeitlich. Trotzdem speichern?`,
          onConfirm: () => {
            setConfirmState(null);
            doSave(true);
          },
        });
        return;
      }

      // 3. >10h warning
      if (istStunden > 10) {
        setConfirmState({
          title: "Lange Arbeitszeit",
          message: `Gesamt: ${formatH(istStunden)}. Das überschreitet 10h (AZG). Trotzdem speichern?`,
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
      // UPSERT first (INSERTs and UPDATEs). If anything fails, nothing is deleted.
      for (const b of blocks) {
        const hours = blockHours(b);
        const pauseMin = pauseMinutes(b.pauseStart, b.pauseEnd);
        const pid = b.projectId || null;
        const projName = pid ? projects.find((p) => p.id === pid)?.name : null;
        const taetigkeit = pid ? `PL: ${projName}` : "PL: Büro";

        const row: any = {
          start_time: b.startTime,
          end_time: b.endTime,
          pause_start: b.pauseStart || null,
          pause_end: b.pauseEnd || null,
          pause_minutes: pauseMin,
          stunden: hours,
          project_id: pid,
          taetigkeit,
          entry_typ: "projektleiter",
        };

        if (b.dbId) {
          if (b.dirty) {
            const { error } = await supabase
              .from("time_entries")
              .update(row)
              .eq("id", b.dbId);
            if (error) throw error;
          }
        } else {
          const { error } = await supabase.from("time_entries").insert({
            ...row,
            user_id: userId,
            datum: date,
          });
          if (error) throw error;
        }
      }

      // DELETE last, only if everything else succeeded
      if (deletedIds.length > 0) {
        const { error } = await supabase
          .from("time_entries")
          .delete()
          .in("id", deletedIds);
        if (error) throw error;
      }

      toast({ title: "Gespeichert", description: `${formatH(istStunden)} für ${dateLabel}` });
      setExpandedId(null);
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
                Erfasse deine Arbeitszeit pro Tag in <strong>Zeitblöcken</strong>. Mit "Regelarbeitszeit ausfüllen"
                kannst du einen Standardtag in einem Klick einfügen.
              </p>
              <ul className="list-disc ml-5 space-y-1">
                <li><strong>40 Stunden/Woche</strong> (Mo–Fr je 8h). Mehr = Zeitkonto.</li>
                <li><strong>Pause von/bis</strong>: innerhalb eines Blocks, wird abgezogen.</li>
                <li><strong>Projekt</strong> für die Projektauswertung, "Büro" wenn keins.</li>
                <li><strong>Urlaub / Krankenstand / ZA</strong>: im Menü "Abwesenheit" eintragen.</li>
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
          <Button
            variant="outline"
            onClick={applyRegelarbeitszeit}
            className="w-full"
          >
            <Wand2 className="h-4 w-4 mr-2" />
            Regelarbeitszeit ausfüllen (07:00–16:00, Pause 12:00–13:00)
          </Button>
        )}

        {/* Zeitblöcke */}
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
                Noch keine Zeitblöcke für diesen Tag.
              </div>
            )}

            {blocks.map((b, idx) => {
              const hours = blockHours(b);
              const err = validateBlock(b);
              const isExpanded = expandedId === b.localId || b.dirty || !b.dbId;
              const projName = b.projectId
                ? projects.find((p) => p.id === b.projectId)?.name
                : null;

              if (!isExpanded) {
                // Gespeicherte Blöcke: kompakte View-Ansicht
                return (
                  <div
                    key={b.localId}
                    className="border rounded-lg p-3 flex items-center gap-3 bg-muted/20 hover:bg-muted/40 transition-colors"
                  >
                    <Badge variant="outline" className="font-mono shrink-0">#{idx + 1}</Badge>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="font-semibold text-base">
                          {b.startTime} – {b.endTime}
                        </span>
                        <Badge variant="secondary">{formatH(hours)}</Badge>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5 flex-wrap">
                        <span className="flex items-center gap-1">
                          <Building2 className="h-3 w-3" />
                          {projName || "Büro"}
                        </span>
                        {b.pauseStart && b.pauseEnd && (
                          <span className="flex items-center gap-1">
                            <Coffee className="h-3 w-3" />
                            Pause {b.pauseStart}–{b.pauseEnd}
                          </span>
                        )}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setExpandedId(b.localId)}
                      className="h-8 w-8"
                      aria-label="Bearbeiten"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeBlock(b.localId)}
                      className="text-destructive hover:text-destructive h-8 w-8"
                      aria-label="Löschen"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                );
              }

              // Expandierte Edit-Ansicht
              return (
                <div
                  key={b.localId}
                  className={`border rounded-lg p-3 space-y-3 ${
                    err && b.dirty ? "border-destructive/50" : "border-primary/30"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="font-mono">#{idx + 1}</Badge>
                      <span className="font-semibold">
                        {hours > 0 ? formatH(hours) : "—"}
                      </span>
                      {b.dirty && b.dbId && (
                        <Badge variant="outline" className="text-orange-600 border-orange-300 text-xs">
                          geändert
                        </Badge>
                      )}
                      {!b.dbId && (
                        <Badge variant="outline" className="text-blue-600 border-blue-300 text-xs">
                          neu
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      {b.dbId && !b.dirty && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setExpandedId(null)}
                          className="h-8 text-xs"
                        >
                          Fertig
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeBlock(b.localId)}
                        className="text-destructive hover:text-destructive h-8 w-8"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
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

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Pause von</Label>
                      <Input
                        type="time"
                        value={b.pauseStart}
                        onChange={(e) => updateBlock(b.localId, { pauseStart: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Pause bis</Label>
                      <Input
                        type="time"
                        value={b.pauseEnd}
                        onChange={(e) => updateBlock(b.localId, { pauseEnd: e.target.value })}
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
                        <SelectItem value="none">🏢 Büro / kein Projekt</SelectItem>
                        {projects.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {err && b.dirty && (
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
              Neuer Zeitblock
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
