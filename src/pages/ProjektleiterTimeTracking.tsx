import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, Plus, Trash2, Pencil, Clock, Building2, AlertTriangle, Info } from "lucide-react";
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
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { getTagesSoll } from "@/lib/workingHours";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Project = {
  id: string;
  name: string;
  status: string | null;
};

type Block = {
  id: string;
  datum: string;
  start_time: string | null;
  end_time: string | null;
  pause_minutes: number;
  stunden: number;
  project_id: string | null;
  projekt_name?: string;
  entry_typ: string;
};

type AbsenceEntry = {
  datum: string;
  typ: string | null;
  stunden: number;
  taetigkeit: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Computes work hours from start, end, pause_minuten. Returns 0 if invalid. */
function computeHours(start: string, end: string, pauseMin: number): number {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const totalMin = eh * 60 + em - (sh * 60 + sm) - pauseMin;
  if (totalMin <= 0) return 0;
  return Math.round((totalMin / 60) * 100) / 100;
}

/** Format hours as "8h" or "5.5h" */
function formatHours(h: number): string {
  if (h === Math.floor(h)) return `${h}h`;
  return `${h.toString().replace(".", ",")}h`;
}

/** Validate times; returns error message or null. */
function validateBlock(start: string, end: string, pauseMin: number): string | null {
  if (!start || !end) return "Start- und Endzeit sind erforderlich";
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  if (isNaN(sh) || isNaN(sm) || isNaN(eh) || isNaN(em)) return "Ungültige Zeit";
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;
  if (endMin <= startMin) return "Ende muss nach Start liegen (bitte in 2 Blöcke teilen, falls über Mitternacht)";
  if (pauseMin < 0) return "Pause darf nicht negativ sein";
  if (pauseMin >= endMin - startMin) return "Pause ist größer oder gleich der Blockdauer";
  return null;
}

/** Check if two time ranges overlap */
function blocksOverlap(a: { start: string; end: string }, b: { start: string; end: string }): boolean {
  const [aSh, aSm] = a.start.split(":").map(Number);
  const [aEh, aEm] = a.end.split(":").map(Number);
  const [bSh, bSm] = b.start.split(":").map(Number);
  const [bEh, bEm] = b.end.split(":").map(Number);
  const aStart = aSh * 60 + aSm;
  const aEnd = aEh * 60 + aEm;
  const bStart = bSh * 60 + bSm;
  const bEnd = bEh * 60 + bEm;
  return aStart < bEnd && bStart < aEnd;
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function ProjektleiterTimeTracking() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [userId, setUserId] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [weeklyHours, setWeeklyHours] = useState<number>(40);
  const [date, setDate] = useState<string>(() => new Date().toISOString().split("T")[0]);

  const [projects, setProjects] = useState<Project[]>([]);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [absences, setAbsences] = useState<AbsenceEntry[]>([]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingBlock, setEditingBlock] = useState<Block | null>(null);

  // Form state
  const [startZeit, setStartZeit] = useState("07:00");
  const [endZeit, setEndZeit] = useState("16:30");
  const [pauseMin, setPauseMin] = useState(30);
  const [projektId, setProjektId] = useState<string>("none");
  const [saving, setSaving] = useState(false);

  // Confirm dialogs
  const [confirmState, setConfirmState] = useState<{
    open: boolean;
    title: string;
    message: string;
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

      // Weekly hours
      const { data: emp } = await supabase
        .from("employees")
        .select("monats_soll_stunden")
        .eq("user_id", user.id)
        .maybeSingle();
      if (emp?.monats_soll_stunden) setWeeklyHours(emp.monats_soll_stunden);

      // Projects
      const { data: projData } = await supabase
        .from("projects")
        .select("id, name, status")
        .eq("status", "aktiv")
        .order("name");
      if (projData) setProjects(projData);
    })();
  }, [navigate, toast]);

  // -----------------------------------------------------------------
  // Load blocks for current date
  // -----------------------------------------------------------------

  const loadBlocks = useCallback(async () => {
    if (!userId) return;

    const { data: entries } = await supabase
      .from("time_entries")
      .select("id, datum, start_time, end_time, pause_minutes, stunden, project_id, entry_typ, taetigkeit")
      .eq("user_id", userId)
      .eq("datum", date)
      .order("start_time", { ascending: true });

    if (!entries) {
      setBlocks([]);
      setAbsences([]);
      return;
    }

    // Separate absences and pl blocks
    const plBlocks: Block[] = [];
    const abs: AbsenceEntry[] = [];
    const projMap: Record<string, string> = {};
    projects.forEach((p) => {
      projMap[p.id] = p.name;
    });

    for (const e of entries) {
      if ((e as any).entry_typ === "absenz") {
        abs.push({
          datum: e.datum,
          typ: (e as any).typ || null,
          stunden: parseFloat(e.stunden as any) || 0,
          taetigkeit: (e as any).taetigkeit || "",
        });
      } else if ((e as any).entry_typ === "projektleiter") {
        const pid = (e as any).project_id;
        plBlocks.push({
          id: e.id,
          datum: e.datum,
          start_time: (e as any).start_time,
          end_time: (e as any).end_time,
          pause_minutes: (e as any).pause_minutes || 0,
          stunden: parseFloat(e.stunden as any) || 0,
          project_id: pid || null,
          projekt_name: pid ? projMap[pid] : undefined,
          entry_typ: (e as any).entry_typ,
        });
      }
    }

    setBlocks(plBlocks);
    setAbsences(abs);
  }, [userId, date, projects]);

  useEffect(() => {
    loadBlocks();
  }, [loadBlocks]);

  // -----------------------------------------------------------------
  // Computed values
  // -----------------------------------------------------------------

  const dow = new Date(date + "T00:00:00").getDay();
  const fullTimeSoll = userRole
    ? getTagesSoll(userRole as any, dow)
    : 0;
  // Adjust for part-time (weeklyHours != 40)
  const tagesSoll = Math.round((weeklyHours / 40) * fullTimeSoll * 100) / 100;
  const istStunden = blocks.reduce((s, b) => s + b.stunden, 0);
  const diff = Math.round((istStunden - tagesSoll) * 100) / 100;

  const parsedDate = new Date(date + "T00:00:00");
  const dateLabel = format(parsedDate, "EEEE, d. MMMM yyyy", { locale: de });

  // -----------------------------------------------------------------
  // Date navigation
  // -----------------------------------------------------------------

  const shiftDate = (days: number) => {
    const d = new Date(date + "T00:00:00");
    d.setDate(d.getDate() + days);
    setDate(d.toISOString().split("T")[0]);
  };

  const goToday = () => setDate(new Date().toISOString().split("T")[0]);

  // -----------------------------------------------------------------
  // Block CRUD
  // -----------------------------------------------------------------

  const openNewBlock = () => {
    setEditingBlock(null);
    setStartZeit("07:00");
    setEndZeit("16:30");
    setPauseMin(30);
    setProjektId("none");
    setDialogOpen(true);
  };

  const openEditBlock = (b: Block) => {
    setEditingBlock(b);
    setStartZeit(b.start_time?.substring(0, 5) || "07:00");
    setEndZeit(b.end_time?.substring(0, 5) || "16:30");
    setPauseMin(b.pause_minutes);
    setProjektId(b.project_id || "none");
    setDialogOpen(true);
  };

  const doSaveBlock = async (force = false) => {
    if (!userId) return;

    // Validate
    const err = validateBlock(startZeit, endZeit, pauseMin);
    if (err) {
      toast({ variant: "destructive", title: "Ungültige Eingabe", description: err });
      return;
    }

    const hours = computeHours(startZeit, endZeit, pauseMin);

    // Pre-save checks (unless forced)
    if (!force) {
      // Absence on same day blocks
      if (absences.length > 0) {
        const hasBlocking = absences.some((a) => ["Urlaub", "Krankenstand", "ZA", "Zeitausgleich"].includes(a.taetigkeit));
        if (hasBlocking) {
          toast({
            variant: "destructive",
            title: "Nicht möglich",
            description: `Für diesen Tag gibt es bereits "${absences[0].taetigkeit}". Bitte erst entfernen.`,
          });
          return;
        }
      }

      // Overlap check
      const otherBlocks = editingBlock
        ? blocks.filter((b) => b.id !== editingBlock.id)
        : blocks;
      const overlapping = otherBlocks.filter((b) => {
        if (!b.start_time || !b.end_time) return false;
        return blocksOverlap(
          { start: startZeit, end: endZeit },
          { start: b.start_time.substring(0, 5), end: b.end_time.substring(0, 5) }
        );
      });
      if (overlapping.length > 0) {
        setConfirmState({
          open: true,
          title: "Überlappung erkannt",
          message: `Dieser Block überlappt mit ${overlapping.length} bestehenden Block(en). Trotzdem speichern?`,
          onConfirm: () => {
            setConfirmState(null);
            doSaveBlock(true);
          },
        });
        return;
      }

      // >10h warning
      if (hours > 10) {
        setConfirmState({
          open: true,
          title: "Lange Arbeitszeit",
          message: `Dieser Block ist ${formatHours(hours)}. Das überschreitet 10h (AZG-Warnung). Trotzdem speichern?`,
          onConfirm: () => {
            setConfirmState(null);
            doSaveBlock(true);
          },
        });
        return;
      }
    }

    setSaving(true);

    const projId = projektId === "none" ? null : projektId;
    const taetigkeitText = projId
      ? `PL: ${projects.find((p) => p.id === projId)?.name || ""}`
      : "PL: Büro";

    try {
      if (editingBlock) {
        const { error } = await supabase
          .from("time_entries")
          .update({
            start_time: startZeit,
            end_time: endZeit,
            pause_minutes: pauseMin,
            stunden: hours,
            project_id: projId,
            taetigkeit: taetigkeitText,
          })
          .eq("id", editingBlock.id);
        if (error) throw error;
        toast({ title: "Aktualisiert", description: `Block gespeichert (${formatHours(hours)})` });
      } else {
        const { error } = await supabase.from("time_entries").insert({
          user_id: userId,
          datum: date,
          start_time: startZeit,
          end_time: endZeit,
          pause_minutes: pauseMin,
          stunden: hours,
          project_id: projId,
          taetigkeit: taetigkeitText,
          entry_typ: "projektleiter",
        });
        if (error) throw error;
        toast({ title: "Gespeichert", description: `Block erstellt (${formatHours(hours)})` });
      }

      setDialogOpen(false);
      setEditingBlock(null);
      loadBlocks();
    } catch (err: any) {
      console.error("Block save failed:", err);
      toast({
        variant: "destructive",
        title: "Fehler",
        description: err.message || "Block konnte nicht gespeichert werden.",
      });
    } finally {
      setSaving(false);
    }
  };

  const doDeleteBlock = async (block: Block) => {
    setConfirmState({
      open: true,
      title: "Block löschen?",
      message: `${block.start_time?.substring(0, 5)} – ${block.end_time?.substring(0, 5)} (${formatHours(block.stunden)}) wird gelöscht.`,
      onConfirm: async () => {
        setConfirmState(null);
        const { error } = await supabase.from("time_entries").delete().eq("id", block.id);
        if (error) {
          toast({ variant: "destructive", title: "Fehler", description: error.message });
        } else {
          toast({ title: "Gelöscht" });
          loadBlocks();
        }
      },
    });
  };

  // -----------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------

  const currentHours = useMemo(() => computeHours(startZeit, endZeit, pauseMin), [startZeit, endZeit, pauseMin]);
  const isWeekend = dow === 0 || dow === 6;

  return (
    <div className="min-h-screen bg-background">
      <PageHeader title="Meine Zeiterfassung" />

      <main className="container mx-auto px-3 sm:px-4 py-4 sm:py-6 max-w-3xl space-y-4">
        {/* Info-Box: Kurze Erklärung */}
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
                Erfasse deine Arbeitszeit in <strong>Blöcken</strong>: je Block Start- und Endzeit, Pause und optional ein Projekt.
                Du kannst pro Tag beliebig viele Blöcke anlegen (z.B. Baustelle vormittags + Büro nachmittags).
              </p>
              <ul className="list-disc ml-5 space-y-1">
                <li><strong>40 Stunden/Woche</strong>: Mo–Fr je 8h. Alles darüber geht auf dein Zeitkonto.</li>
                <li><strong>Pause</strong>: 30 min Standard, zählt nicht als Arbeitszeit.</li>
                <li><strong>Projekt auswählen</strong>: damit die Stunden in der Projektauswertung erscheinen. "Büro" wenn kein Projekt.</li>
                <li><strong>Urlaub / Krankenstand / ZA</strong>: über Menü "Abwesenheit" eintragen, nicht hier.</li>
              </ul>
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        {/* Datum-Navigation */}
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center justify-between gap-2">
              <Button variant="outline" size="icon" onClick={() => shiftDate(-1)} aria-label="Vorheriger Tag">
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
              <Button variant="outline" size="icon" onClick={() => shiftDate(1)} aria-label="Nächster Tag">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            {date !== new Date().toISOString().split("T")[0] && (
              <Button variant="ghost" size="sm" onClick={goToday} className="w-full mt-2">
                Zurück zu heute
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Soll/Ist-Anzeige */}
        <Card>
          <CardContent className="pt-4 pb-4">
            {isWeekend ? (
              <div className="text-center text-muted-foreground">
                <Clock className="h-5 w-5 mx-auto mb-1 opacity-50" />
                Wochenende — kein Soll
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <div className="text-xs text-muted-foreground">Soll</div>
                  <div className="text-lg sm:text-xl font-semibold">{formatHours(tagesSoll)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Ist</div>
                  <div className="text-lg sm:text-xl font-semibold">{formatHours(istStunden)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Differenz</div>
                  <div
                    className={`text-lg sm:text-xl font-semibold ${
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

        {/* Absenzen-Hinweis */}
        {absences.length > 0 && (
          <Card className="border-orange-200 bg-orange-50 dark:bg-orange-950/30">
            <CardContent className="pt-4 pb-4 flex gap-2 items-start">
              <AlertTriangle className="h-4 w-4 text-orange-600 shrink-0 mt-0.5" />
              <div className="text-sm">
                Für diesen Tag ist bereits <strong>{absences.map((a) => a.taetigkeit).join(", ")}</strong> eingetragen.
              </div>
            </CardContent>
          </Card>
        )}

        {/* Buchungen-Liste */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base sm:text-lg">Buchungen</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {blocks.length === 0 && (
              <div className="text-center text-sm text-muted-foreground py-6">
                Keine Buchungen für diesen Tag.
              </div>
            )}
            {blocks.map((b) => (
              <div
                key={b.id}
                className="border rounded-lg p-3 flex items-center gap-2 hover:bg-muted/40 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="font-semibold text-base">
                      {b.start_time?.substring(0, 5)} – {b.end_time?.substring(0, 5)}
                    </span>
                    <Badge variant="secondary">{formatHours(b.stunden)}</Badge>
                    {b.pause_minutes > 0 && (
                      <span className="text-xs text-muted-foreground">
                        Pause {b.pause_minutes} min
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 text-sm text-muted-foreground mt-0.5">
                    <Building2 className="h-3.5 w-3.5" />
                    <span className="truncate">{b.projekt_name || "Büro / kein Projekt"}</span>
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" onClick={() => openEditBlock(b)} aria-label="Bearbeiten">
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => doDeleteBlock(b)}
                    aria-label="Löschen"
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Add-Button (Sticky unten) */}
        <div className="sticky bottom-4 sm:bottom-6">
          <Button
            className="w-full h-14 text-base shadow-lg"
            onClick={openNewBlock}
          >
            <Plus className="h-5 w-5 mr-2" />
            Neue Buchung
          </Button>
        </div>
      </main>

      {/* Block-Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>{editingBlock ? "Buchung bearbeiten" : "Neue Buchung"}</DialogTitle>
            <DialogDescription>
              {dateLabel}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Start */}
            <div className="space-y-2">
              <Label htmlFor="start">Start</Label>
              <div className="flex gap-2">
                <Input
                  id="start"
                  type="time"
                  value={startZeit}
                  onChange={(e) => setStartZeit(e.target.value)}
                  className="flex-1"
                />
                {["07:00", "08:00"].map((t) => (
                  <Button
                    key={t}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setStartZeit(t)}
                  >
                    {t}
                  </Button>
                ))}
              </div>
            </div>

            {/* Ende */}
            <div className="space-y-2">
              <Label htmlFor="end">Ende</Label>
              <div className="flex gap-2">
                <Input
                  id="end"
                  type="time"
                  value={endZeit}
                  onChange={(e) => setEndZeit(e.target.value)}
                  className="flex-1"
                />
                {["16:00", "16:30", "17:00"].map((t) => (
                  <Button
                    key={t}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setEndZeit(t)}
                  >
                    {t}
                  </Button>
                ))}
              </div>
            </div>

            {/* Pause */}
            <div className="space-y-2">
              <Label htmlFor="pause">Pause (Minuten)</Label>
              <div className="flex gap-2">
                <Input
                  id="pause"
                  type="number"
                  min={0}
                  max={480}
                  value={pauseMin}
                  onChange={(e) => setPauseMin(parseInt(e.target.value) || 0)}
                  className="flex-1"
                />
                {[0, 30, 60].map((p) => (
                  <Button
                    key={p}
                    type="button"
                    variant={pauseMin === p ? "default" : "outline"}
                    size="sm"
                    onClick={() => setPauseMin(p)}
                  >
                    {p}
                  </Button>
                ))}
              </div>
            </div>

            {/* Projekt */}
            <div className="space-y-2">
              <Label htmlFor="projekt">Projekt</Label>
              <Select value={projektId} onValueChange={setProjektId}>
                <SelectTrigger id="projekt">
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

            {/* Berechnete Stunden */}
            <div className="bg-muted/50 rounded-lg p-3 text-center">
              <div className="text-xs text-muted-foreground">Berechnete Stunden</div>
              <div className="text-2xl font-bold">{formatHours(currentHours)}</div>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              Abbrechen
            </Button>
            <Button onClick={() => doSaveBlock(false)} disabled={saving || currentHours <= 0}>
              {saving ? "Speichern..." : editingBlock ? "Aktualisieren" : "Speichern"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm-Dialog */}
      <Dialog
        open={!!confirmState?.open}
        onOpenChange={(o) => !o && setConfirmState(null)}
      >
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>{confirmState?.title}</DialogTitle>
            <DialogDescription>{confirmState?.message}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirmState(null)}>
              Abbrechen
            </Button>
            <Button onClick={confirmState?.onConfirm}>Bestätigen</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
