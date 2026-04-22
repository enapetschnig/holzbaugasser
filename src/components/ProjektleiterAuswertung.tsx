import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, ChevronRight, Plus, Pencil, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getTagesSoll } from "@/lib/workingHours";

type Profile = {
  id: string;
  vorname: string;
  nachname: string;
  monats_soll_stunden?: number | null;
};

type Project = {
  id: string;
  name: string;
};

type Block = {
  id: string;
  user_id: string;
  datum: string;
  start_zeit: string | null;
  end_zeit: string | null;
  pause_minuten: number;
  stunden: number;
  projekt_id: string | null;
};

function formatHours(h: number): string {
  if (h === 0) return "";
  if (h === Math.floor(h)) return `${h}`;
  return h.toString().replace(".", ",");
}

function computeHours(start: string, end: string, pauseMin: number): number {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const total = eh * 60 + em - (sh * 60 + sm) - pauseMin;
  return total > 0 ? Math.round((total / 60) * 100) / 100 : 0;
}

const MONTHS = ["Jänner", "Feber", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const WEEKDAYS_SHORT = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

export default function ProjektleiterAuswertung() {
  const { toast } = useToast();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);

  const [projektleiter, setProjektleiter] = useState<Profile[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [blocks, setBlocks] = useState<Block[]>([]);

  // Day detail dialog
  const [detailDialog, setDetailDialog] = useState<{
    open: boolean;
    userId: string;
    userName: string;
    date: string;
  } | null>(null);

  // Block edit dialog
  const [blockDialog, setBlockDialog] = useState<{
    open: boolean;
    block: Block | null;
    userId: string;
    date: string;
  } | null>(null);

  const [startZeit, setStartZeit] = useState("07:00");
  const [endZeit, setEndZeit] = useState("16:30");
  const [pauseMin, setPauseMin] = useState(30);
  const [projektId, setProjektId] = useState<string>("none");

  const daysInMonth = useMemo(() => new Date(year, month, 0).getDate(), [year, month]);
  const days = useMemo(() => Array.from({ length: daysInMonth }, (_, i) => i + 1), [daysInMonth]);

  // -----------------------------------------------------------------
  // Load projektleiter users + their hours
  // -----------------------------------------------------------------

  const loadData = useCallback(async () => {
    // 1. Get all projektleiter user IDs
    const { data: roles } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("role", "projektleiter");

    if (!roles || roles.length === 0) {
      setProjektleiter([]);
      setBlocks([]);
      return;
    }

    const plIds = roles.map((r) => r.user_id);

    // 2. Load their profiles (skip hidden)
    const { data: profilesData } = await supabase
      .from("profiles")
      .select("id, vorname, nachname, is_hidden")
      .in("id", plIds)
      .eq("is_active", true);

    const filteredProfiles = (profilesData || []).filter((p: any) => !p.is_hidden);

    // 3. Load their weekly hours from employees
    const { data: empData } = await supabase
      .from("employees")
      .select("user_id, monats_soll_stunden")
      .in("user_id", filteredProfiles.map((p) => p.id));
    const weeklyMap: Record<string, number> = {};
    (empData || []).forEach((e: any) => {
      if (e.user_id) weeklyMap[e.user_id] = e.monats_soll_stunden || 40;
    });

    const withWeekly = filteredProfiles.map((p: any) => ({
      ...p,
      monats_soll_stunden: weeklyMap[p.id] || 40,
    }));
    withWeekly.sort((a, b) => a.nachname.localeCompare(b.nachname));
    setProjektleiter(withWeekly);

    // 4. Load projects
    const { data: projData } = await supabase
      .from("projects")
      .select("id, name")
      .order("name");
    setProjects(projData || []);

    // 5. Load blocks for month
    const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
    const monthEnd = `${year}-${String(month).padStart(2, "0")}-${String(daysInMonth).padStart(2, "0")}`;
    const { data: blocksData } = await supabase
      .from("time_entries")
      .select("id, user_id, datum, start_zeit, end_zeit, pause_minuten, stunden, projekt_id, entry_typ")
      .in("user_id", plIds)
      .eq("entry_typ", "projektleiter")
      .gte("datum", monthStart)
      .lte("datum", monthEnd);

    setBlocks((blocksData || []).map((b: any) => ({
      id: b.id,
      user_id: b.user_id,
      datum: b.datum,
      start_zeit: b.start_zeit,
      end_zeit: b.end_zeit,
      pause_minuten: b.pause_minuten || 0,
      stunden: parseFloat(b.stunden) || 0,
      projekt_id: b.projekt_id || null,
    })));
  }, [year, month, daysInMonth]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // -----------------------------------------------------------------
  // Computed: blocks per user per day
  // -----------------------------------------------------------------

  const blocksByUserDay = useMemo(() => {
    const map: Record<string, Record<number, Block[]>> = {};
    for (const b of blocks) {
      const day = parseInt(b.datum.substring(8, 10));
      if (!map[b.user_id]) map[b.user_id] = {};
      if (!map[b.user_id][day]) map[b.user_id][day] = [];
      map[b.user_id][day].push(b);
    }
    return map;
  }, [blocks]);

  const totalsByUser = useMemo(() => {
    const map: Record<string, { ist: number; soll: number; diff: number }> = {};
    for (const pl of projektleiter) {
      let ist = 0;
      let soll = 0;
      const weekly = pl.monats_soll_stunden || 40;
      const factor = weekly / 40;
      for (let d = 1; d <= daysInMonth; d++) {
        const dow = new Date(year, month - 1, d).getDay();
        const fullSoll = getTagesSoll("projektleiter", dow);
        soll += fullSoll * factor;
        const dayBlocks = blocksByUserDay[pl.id]?.[d] || [];
        ist += dayBlocks.reduce((s, b) => s + b.stunden, 0);
      }
      soll = Math.round(soll * 100) / 100;
      ist = Math.round(ist * 100) / 100;
      map[pl.id] = { ist, soll, diff: Math.round((ist - soll) * 100) / 100 };
    }
    return map;
  }, [projektleiter, blocksByUserDay, year, month, daysInMonth]);

  // -----------------------------------------------------------------
  // Day detail dialog
  // -----------------------------------------------------------------

  const openDayDetail = (userId: string, userName: string, day: number) => {
    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    setDetailDialog({ open: true, userId, userName, date: dateStr });
  };

  const openNewBlock = (userId: string, date: string) => {
    setBlockDialog({ open: true, block: null, userId, date });
    setStartZeit("07:00");
    setEndZeit("16:30");
    setPauseMin(30);
    setProjektId("none");
  };

  const openEditBlock = (block: Block) => {
    setBlockDialog({ open: true, block, userId: block.user_id, date: block.datum });
    setStartZeit(block.start_zeit?.substring(0, 5) || "07:00");
    setEndZeit(block.end_zeit?.substring(0, 5) || "16:30");
    setPauseMin(block.pause_minuten);
    setProjektId(block.projekt_id || "none");
  };

  const saveBlock = async () => {
    if (!blockDialog) return;
    const hours = computeHours(startZeit, endZeit, pauseMin);
    if (hours <= 0) {
      toast({ variant: "destructive", title: "Ungültig", description: "Stunden ≤ 0" });
      return;
    }
    const projId = projektId === "none" ? null : projektId;
    const projName = projId ? projects.find((p) => p.id === projId)?.name : "Büro";
    const taetigkeit = projId ? `PL: ${projName}` : "PL: Büro";

    if (blockDialog.block) {
      const { error } = await supabase
        .from("time_entries")
        .update({
          start_zeit: startZeit,
          end_zeit: endZeit,
          pause_minuten: pauseMin,
          stunden: hours,
          projekt_id: projId,
          taetigkeit,
        })
        .eq("id", blockDialog.block.id);
      if (error) {
        toast({ variant: "destructive", title: "Fehler", description: error.message });
        return;
      }
    } else {
      const { error } = await supabase.from("time_entries").insert({
        user_id: blockDialog.userId,
        datum: blockDialog.date,
        start_zeit: startZeit,
        end_zeit: endZeit,
        pause_minuten: pauseMin,
        stunden: hours,
        projekt_id: projId,
        taetigkeit,
        entry_typ: "projektleiter",
      });
      if (error) {
        toast({ variant: "destructive", title: "Fehler", description: error.message });
        return;
      }
    }

    toast({ title: "Gespeichert" });
    setBlockDialog(null);
    await loadData();
  };

  const deleteBlock = async (blockId: string) => {
    const { error } = await supabase.from("time_entries").delete().eq("id", blockId);
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
      return;
    }
    toast({ title: "Gelöscht" });
    await loadData();
  };

  // -----------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------

  const shiftMonth = (delta: number) => {
    let newMonth = month + delta;
    let newYear = year;
    if (newMonth > 12) {
      newMonth = 1;
      newYear += 1;
    }
    if (newMonth < 1) {
      newMonth = 12;
      newYear -= 1;
    }
    setMonth(newMonth);
    setYear(newYear);
  };

  const detailBlocks: Block[] = detailDialog
    ? blocks.filter((b) => b.user_id === detailDialog.userId && b.datum === detailDialog.date)
    : [];

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <CardTitle>Projektleiter-Monatsübersicht</CardTitle>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={() => shiftMonth(-1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="text-sm font-medium min-w-[120px] text-center">
              {MONTHS[month - 1]} {year}
            </div>
            <Button variant="outline" size="icon" onClick={() => shiftMonth(1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {projektleiter.length === 0 ? (
          <div className="text-center text-muted-foreground py-8">
            Keine Projektleiter aktiv
          </div>
        ) : (
          <div className="overflow-x-auto border rounded-lg">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className="sticky left-0 bg-muted/40 text-left px-3 py-2 min-w-[180px] border-r z-10">
                    Mitarbeiter
                  </th>
                  {days.map((d) => {
                    const dow = new Date(year, month - 1, d).getDay();
                    const isWeekend = dow === 0 || dow === 6;
                    return (
                      <th
                        key={d}
                        className={`text-center px-1 py-2 min-w-[40px] border-r ${
                          isWeekend ? "bg-muted/60" : ""
                        }`}
                      >
                        <div className="text-xs">{WEEKDAYS_SHORT[dow]}</div>
                        <div className="font-semibold">{d}</div>
                      </th>
                    );
                  })}
                  <th className="text-center px-2 py-2 min-w-[60px] border-r">Soll</th>
                  <th className="text-center px-2 py-2 min-w-[60px] border-r">Ist</th>
                  <th className="text-center px-2 py-2 min-w-[60px]">±</th>
                </tr>
              </thead>
              <tbody>
                {projektleiter.map((pl) => {
                  const totals = totalsByUser[pl.id] || { ist: 0, soll: 0, diff: 0 };
                  return (
                    <tr key={pl.id} className="border-t">
                      <td className="sticky left-0 bg-background text-left px-3 py-2 font-medium border-r z-10">
                        {pl.nachname} {pl.vorname}
                        {pl.monats_soll_stunden !== 40 && (
                          <Badge variant="outline" className="ml-1 text-xs">
                            {pl.monats_soll_stunden}h
                          </Badge>
                        )}
                      </td>
                      {days.map((d) => {
                        const dow = new Date(year, month - 1, d).getDay();
                        const isWeekend = dow === 0 || dow === 6;
                        const dayBlocks = blocksByUserDay[pl.id]?.[d] || [];
                        const sum = dayBlocks.reduce((s, b) => s + b.stunden, 0);
                        return (
                          <td
                            key={d}
                            className={`text-center px-1 py-2 border-r cursor-pointer hover:bg-primary/10 ${
                              isWeekend ? "bg-muted/30" : ""
                            }`}
                            onClick={() => openDayDetail(pl.id, `${pl.nachname} ${pl.vorname}`, d)}
                          >
                            {sum > 0 ? (
                              <span className="font-semibold">{formatHours(sum)}</span>
                            ) : (
                              <span className="text-muted-foreground">·</span>
                            )}
                          </td>
                        );
                      })}
                      <td className="text-center px-2 py-2 border-r">{formatHours(totals.soll)}</td>
                      <td className="text-center px-2 py-2 border-r font-semibold">{formatHours(totals.ist)}</td>
                      <td
                        className={`text-center px-2 py-2 font-semibold ${
                          totals.diff > 0 ? "text-green-600" : totals.diff < 0 ? "text-orange-500" : ""
                        }`}
                      >
                        {totals.diff > 0 ? "+" : ""}
                        {formatHours(totals.diff)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>

      {/* Day Detail Dialog */}
      <Dialog open={!!detailDialog?.open} onOpenChange={(o) => !o && setDetailDialog(null)}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>
              {detailDialog?.userName} · {detailDialog?.date}
            </DialogTitle>
            <DialogDescription>Buchungen dieses Tages</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {detailBlocks.length === 0 ? (
              <div className="text-center text-muted-foreground py-4">Keine Buchungen</div>
            ) : (
              detailBlocks.map((b) => {
                const proj = projects.find((p) => p.id === b.projekt_id);
                return (
                  <div key={b.id} className="border rounded p-3 flex items-center gap-2">
                    <div className="flex-1">
                      <div className="font-semibold">
                        {b.start_zeit?.substring(0, 5)} – {b.end_zeit?.substring(0, 5)}{" "}
                        <Badge variant="secondary" className="ml-1">
                          {formatHours(b.stunden)}h
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {proj?.name || "Büro"}
                        {b.pause_minuten > 0 && ` · Pause ${b.pause_minuten}min`}
                      </div>
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => { setDetailDialog(null); openEditBlock(b); }}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="text-destructive" onClick={() => deleteBlock(b.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                );
              })
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                if (detailDialog) {
                  setDetailDialog(null);
                  openNewBlock(detailDialog.userId, detailDialog.date);
                }
              }}
            >
              <Plus className="h-4 w-4 mr-2" />
              Block hinzufügen
            </Button>
            <Button onClick={() => setDetailDialog(null)}>Schließen</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Block edit dialog */}
      <Dialog open={!!blockDialog?.open} onOpenChange={(o) => !o && setBlockDialog(null)}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>{blockDialog?.block ? "Block bearbeiten" : "Neuer Block"}</DialogTitle>
            <DialogDescription>{blockDialog?.date}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Start</Label>
              <Input type="time" value={startZeit} onChange={(e) => setStartZeit(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Ende</Label>
              <Input type="time" value={endZeit} onChange={(e) => setEndZeit(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Pause (min)</Label>
              <Input type="number" min={0} value={pauseMin} onChange={(e) => setPauseMin(parseInt(e.target.value) || 0)} />
            </div>
            <div className="space-y-2">
              <Label>Projekt</Label>
              <Select value={projektId} onValueChange={setProjektId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Büro / kein Projekt</SelectItem>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="bg-muted/50 rounded p-2 text-center">
              <div className="text-xs text-muted-foreground">Berechnet</div>
              <div className="font-bold">{computeHours(startZeit, endZeit, pauseMin)}h</div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBlockDialog(null)}>Abbrechen</Button>
            <Button onClick={saveBlock}>Speichern</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
