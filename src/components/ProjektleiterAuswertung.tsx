import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { Download, Pencil, Trash2, ChevronLeft, ChevronRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import * as XLSX from "xlsx-js-style";
import { format, parseISO } from "date-fns";
import { de } from "date-fns/locale";
import { localDateString } from "@/lib/workingHours";

type Profile = {
  id: string;
  vorname: string;
  nachname: string;
};

type Project = {
  id: string;
  name: string;
};

type Block = {
  id: string;
  user_id: string;
  user_name: string;
  datum: string;
  start_time: string | null;
  end_time: string | null;
  pause_start: string | null;
  pause_end: string | null;
  pause_minutes: number;
  stunden: number;
  project_id: string | null;
  project_name: string;
};

const MONTHS = [
  "Jänner", "Feber", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

function formatTime(t: string | null): string {
  if (!t) return "";
  return t.substring(0, 5);
}

function computeHours(start: string, end: string, pauseMin: number): number {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const min = eh * 60 + em - (sh * 60 + sm) - pauseMin;
  return min > 0 ? Math.round((min / 60) * 100) / 100 : 0;
}

function pauseMinutesFromTimes(ps: string, pe: string): number {
  if (!ps || !pe) return 0;
  const [sh, sm] = ps.split(":").map(Number);
  const [eh, em] = pe.split(":").map(Number);
  return Math.max(0, eh * 60 + em - (sh * 60 + sm));
}

export default function ProjektleiterAuswertung() {
  const { toast } = useToast();
  const today = new Date();

  // Filters: Monat + Jahr
  const [year, setYear] = useState<number>(today.getFullYear());
  const [month, setMonth] = useState<number>(today.getMonth() + 1); // 1-12
  const [selectedUserId, setSelectedUserId] = useState<string>("all");

  // Derived date range for DB query
  const startDate = useMemo(
    () => localDateString(new Date(year, month - 1, 1)),
    [year, month]
  );
  const endDate = useMemo(
    () => localDateString(new Date(year, month, 0)),
    [year, month]
  );

  // Data
  const [users, setUsers] = useState<Profile[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [loading, setLoading] = useState(false);

  // Edit dialog
  const [editBlock, setEditBlock] = useState<Block | null>(null);
  const [editStart, setEditStart] = useState("");
  const [editEnd, setEditEnd] = useState("");
  const [editPauseFrom, setEditPauseFrom] = useState("");
  const [editPauseTo, setEditPauseTo] = useState("");
  const [editProjectId, setEditProjectId] = useState<string>("none");

  // -----------------------------------------------------------------
  // Load users (projektleiter + administrator, exclude hidden)
  // -----------------------------------------------------------------

  const loadUsers = useCallback(async () => {
    const { data: roles } = await supabase
      .from("user_roles")
      .select("user_id, role")
      .in("role", ["projektleiter", "administrator"]);

    if (!roles || roles.length === 0) {
      setUsers([]);
      return;
    }

    const ids = [...new Set(roles.map((r) => r.user_id))];
    const { data: profilesData } = await supabase
      .from("profiles")
      .select("id, vorname, nachname, is_active, is_hidden")
      .in("id", ids)
      .eq("is_active", true);

    const filtered = (profilesData || []).filter((p: any) => !p.is_hidden);
    filtered.sort((a, b) => a.nachname.localeCompare(b.nachname));
    setUsers(filtered);
  }, []);

  // -----------------------------------------------------------------
  // Load projects
  // -----------------------------------------------------------------

  const loadProjects = useCallback(async () => {
    const { data } = await supabase
      .from("projects")
      .select("id, name")
      .order("name");
    setProjects(data || []);
  }, []);

  // -----------------------------------------------------------------
  // Load blocks for current filters
  // -----------------------------------------------------------------

  const loadBlocks = useCallback(async () => {
    if (users.length === 0) return;

    setLoading(true);
    let userIds = users.map((u) => u.id);
    if (selectedUserId !== "all") {
      userIds = [selectedUserId];
    }

    const { data } = await supabase
      .from("time_entries")
      .select("id, user_id, datum, start_time, end_time, pause_start, pause_end, pause_minutes, stunden, project_id, entry_typ")
      .in("user_id", userIds)
      .eq("entry_typ", "projektleiter")
      .gte("datum", startDate)
      .lte("datum", endDate)
      .order("datum", { ascending: false })
      .order("start_time", { ascending: true });

    const userMap: Record<string, string> = {};
    users.forEach((u) => { userMap[u.id] = `${u.nachname} ${u.vorname}`; });

    const projMap: Record<string, string> = {};
    projects.forEach((p) => { projMap[p.id] = p.name; });

    const result: Block[] = (data || []).map((e: any) => ({
      id: e.id,
      user_id: e.user_id,
      user_name: userMap[e.user_id] || "?",
      datum: e.datum,
      start_time: e.start_time,
      end_time: e.end_time,
      pause_start: e.pause_start,
      pause_end: e.pause_end,
      pause_minutes: e.pause_minutes || 0,
      stunden: parseFloat(e.stunden) || 0,
      project_id: e.project_id || null,
      project_name: e.project_id ? (projMap[e.project_id] || "Unbekannt") : "Büro",
    }));

    setBlocks(result);
    setLoading(false);
  }, [users, projects, selectedUserId, startDate, endDate]);

  useEffect(() => { loadUsers(); loadProjects(); }, [loadUsers, loadProjects]);
  useEffect(() => { loadBlocks(); }, [loadBlocks]);

  // -----------------------------------------------------------------
  // Quick-filter buttons
  // -----------------------------------------------------------------

  const shiftMonth = (delta: number) => {
    let newMonth = month + delta;
    let newYear = year;
    if (newMonth > 12) { newMonth = 1; newYear += 1; }
    if (newMonth < 1) { newMonth = 12; newYear -= 1; }
    setMonth(newMonth);
    setYear(newYear);
  };

  const goCurrentMonth = () => {
    const now = new Date();
    setMonth(now.getMonth() + 1);
    setYear(now.getFullYear());
  };

  // -----------------------------------------------------------------
  // Total per user
  // -----------------------------------------------------------------

  const totalsByUser = useMemo(() => {
    const map: Record<string, { name: string; stunden: number; count: number }> = {};
    for (const b of blocks) {
      if (!map[b.user_id]) map[b.user_id] = { name: b.user_name, stunden: 0, count: 0 };
      map[b.user_id].stunden += b.stunden;
      map[b.user_id].count += 1;
    }
    return Object.entries(map).map(([uid, d]) => ({ uid, ...d }));
  }, [blocks]);

  const grandTotal = useMemo(() => blocks.reduce((s, b) => s + b.stunden, 0), [blocks]);

  // -----------------------------------------------------------------
  // Excel Export
  // -----------------------------------------------------------------

  const exportToExcel = () => {
    if (blocks.length === 0) {
      toast({ variant: "destructive", title: "Keine Daten", description: "Keine Blöcke im gewählten Zeitraum." });
      return;
    }

    const label = selectedUserId === "all"
      ? "Alle Projektleiter"
      : users.find((u) => u.id === selectedUserId)
        ? `${users.find((u) => u.id === selectedUserId)!.nachname} ${users.find((u) => u.id === selectedUserId)!.vorname}`
        : "";

    const rows: any[][] = [
      ["Projektleiter-Zeiterfassung"],
      ["Mitarbeiter:", label],
      ["Zeitraum:", `${format(parseISO(startDate), "dd.MM.yyyy")} – ${format(parseISO(endDate), "dd.MM.yyyy")}`],
      [],
      ["Datum", "Wochentag", "Mitarbeiter", "Start", "Ende", "Pause von", "Pause bis", "Stunden", "Projekt"],
    ];

    for (const b of blocks) {
      const d = parseISO(b.datum);
      rows.push([
        format(d, "dd.MM.yyyy"),
        format(d, "EEEE", { locale: de }),
        b.user_name,
        formatTime(b.start_time),
        formatTime(b.end_time),
        formatTime(b.pause_start),
        formatTime(b.pause_end),
        b.stunden.toFixed(2).replace(".", ","),
        b.project_name,
      ]);
    }

    rows.push([]);
    rows.push(["", "", "", "", "", "", "Gesamt", grandTotal.toFixed(2).replace(".", ","), ""]);

    // Per-user totals (nur bei "Alle")
    if (selectedUserId === "all" && totalsByUser.length > 1) {
      rows.push([]);
      rows.push(["Zusammenfassung pro Mitarbeiter:"]);
      rows.push(["Mitarbeiter", "Buchungen", "Stunden"]);
      for (const t of totalsByUser) {
        rows.push([t.name, t.count, t.stunden.toFixed(2).replace(".", ",")]);
      }
    }

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [
      { wch: 12 }, // Datum
      { wch: 12 }, // Wochentag
      { wch: 22 }, // Mitarbeiter
      { wch: 8 },  // Start
      { wch: 8 },  // Ende
      { wch: 10 }, // Pause von
      { wch: 10 }, // Pause bis
      { wch: 10 }, // Stunden
      { wch: 30 }, // Projekt
    ];

    // Header row bold
    const headerRow = 5;
    const cols = ["A", "B", "C", "D", "E", "F", "G", "H", "I"];
    for (const c of cols) {
      const cell = ws[`${c}${headerRow}`];
      if (cell) {
        cell.s = {
          font: { bold: true },
          fill: { fgColor: { rgb: "E0E0E0" } },
          border: {
            top: { style: "thin", color: { rgb: "000000" } },
            bottom: { style: "thin", color: { rgb: "000000" } },
            left: { style: "thin", color: { rgb: "000000" } },
            right: { style: "thin", color: { rgb: "000000" } },
          },
          alignment: { horizontal: "center", vertical: "center" },
        };
      }
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Projektleiter");

    const fileName = `PL_Zeiterfassung_${startDate}_${endDate}${selectedUserId !== "all" ? "_" + label.replace(/\s+/g, "_") : ""}.xlsx`;
    XLSX.writeFile(wb, fileName);

    toast({ title: "Excel erstellt", description: fileName });
  };

  // -----------------------------------------------------------------
  // Edit Block
  // -----------------------------------------------------------------

  const openEdit = (b: Block) => {
    setEditBlock(b);
    setEditStart(formatTime(b.start_time));
    setEditEnd(formatTime(b.end_time));
    setEditPauseFrom(formatTime(b.pause_start));
    setEditPauseTo(formatTime(b.pause_end));
    setEditProjectId(b.project_id || "none");
  };

  const saveEdit = async () => {
    if (!editBlock) return;
    const pauseMin = pauseMinutesFromTimes(editPauseFrom, editPauseTo);
    const hours = computeHours(editStart, editEnd, pauseMin);
    if (hours <= 0) {
      toast({ variant: "destructive", title: "Ungültig", description: "Stunden ≤ 0" });
      return;
    }
    const pid = editProjectId === "none" ? null : editProjectId;
    const projName = pid ? projects.find((p) => p.id === pid)?.name : "Büro";
    const { error } = await supabase
      .from("time_entries")
      .update({
        start_time: editStart,
        end_time: editEnd,
        pause_start: editPauseFrom || null,
        pause_end: editPauseTo || null,
        pause_minutes: pauseMin,
        stunden: hours,
        project_id: pid,
        taetigkeit: pid ? `PL: ${projName}` : "PL: Büro",
      })
      .eq("id", editBlock.id);
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
      return;
    }
    toast({ title: "Aktualisiert" });
    setEditBlock(null);
    await loadBlocks();
  };

  const deleteBlock = async (b: Block) => {
    if (!confirm(`Block vom ${format(parseISO(b.datum), "dd.MM.yyyy")} (${b.user_name}) löschen?`)) return;
    const { error } = await supabase.from("time_entries").delete().eq("id", b.id);
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
      return;
    }
    toast({ title: "Gelöscht" });
    await loadBlocks();
  };

  // -----------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------

  return (
    <div className="space-y-4">
      {/* Filter */}
      <Card>
        <CardHeader>
          <CardTitle>Projektleiter-Stunden</CardTitle>
          <CardDescription>
            Alle gebuchten Zeitblöcke der Projektleiter und Administratoren
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Monat + Jahr */}
            <div className="space-y-1">
              <Label>Monat</Label>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="icon" onClick={() => shiftMonth(-1)} aria-label="Vorheriger Monat">
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Select value={String(month)} onValueChange={(v) => setMonth(parseInt(v))}>
                  <SelectTrigger className="flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MONTHS.map((m, i) => (
                      <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={String(year)} onValueChange={(v) => setYear(parseInt(v))}>
                  <SelectTrigger className="w-[90px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 5 }, (_, i) => today.getFullYear() - 2 + i).map((y) => (
                      <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="outline" size="icon" onClick={() => shiftMonth(1)} aria-label="Nächster Monat">
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Mitarbeiter */}
            <div className="space-y-1">
              <Label>Mitarbeiter</Label>
              <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alle ({users.length})</SelectItem>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.nachname} {u.vorname}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 items-center">
            <Button variant="outline" size="sm" onClick={goCurrentMonth}>
              Aktueller Monat
            </Button>
            <div className="flex-1" />
            <Button onClick={exportToExcel} disabled={blocks.length === 0}>
              <Download className="h-4 w-4 mr-2" />
              Excel exportieren
            </Button>
          </div>

          {/* Summary */}
          {blocks.length > 0 && (
            <div className="flex flex-wrap gap-3 pt-2 border-t">
              <div className="text-sm">
                <span className="text-muted-foreground">Blöcke:</span>{" "}
                <strong>{blocks.length}</strong>
              </div>
              <div className="text-sm">
                <span className="text-muted-foreground">Gesamt:</span>{" "}
                <strong>{grandTotal.toFixed(2).replace(".", ",")}h</strong>
              </div>
              {totalsByUser.length > 1 && (
                <div className="text-sm">
                  <span className="text-muted-foreground">Mitarbeiter:</span>{" "}
                  <strong>{totalsByUser.length}</strong>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Blocks Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Alle Zeitblöcke</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center text-muted-foreground py-8">Lade...</div>
          ) : blocks.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">
              Keine Zeitblöcke im gewählten Zeitraum.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Datum</TableHead>
                    <TableHead>Mitarbeiter</TableHead>
                    <TableHead>Start</TableHead>
                    <TableHead>Ende</TableHead>
                    <TableHead>Pause</TableHead>
                    <TableHead className="text-right">Stunden</TableHead>
                    <TableHead>Projekt</TableHead>
                    <TableHead className="text-right">Aktionen</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {blocks.map((b) => {
                    const d = parseISO(b.datum);
                    const pauseText = b.pause_start && b.pause_end
                      ? `${formatTime(b.pause_start)}–${formatTime(b.pause_end)}`
                      : b.pause_minutes > 0
                        ? `${b.pause_minutes} min`
                        : "–";
                    return (
                      <TableRow key={b.id}>
                        <TableCell className="whitespace-nowrap">
                          {format(d, "dd.MM.yyyy")}
                          <div className="text-xs text-muted-foreground">
                            {format(d, "EEEE", { locale: de })}
                          </div>
                        </TableCell>
                        <TableCell>{b.user_name}</TableCell>
                        <TableCell>{formatTime(b.start_time)}</TableCell>
                        <TableCell>{formatTime(b.end_time)}</TableCell>
                        <TableCell className="whitespace-nowrap">{pauseText}</TableCell>
                        <TableCell className="text-right font-medium">
                          {b.stunden.toFixed(2).replace(".", ",")}
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate">
                          {b.project_id ? (
                            b.project_name
                          ) : (
                            <Badge variant="outline">Büro</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" size="icon" onClick={() => openEdit(b)} className="h-7 w-7">
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => deleteBlock(b)} className="h-7 w-7 text-destructive">
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={5} className="font-bold">Gesamt</TableCell>
                    <TableCell className="text-right font-bold">
                      {grandTotal.toFixed(2).replace(".", ",")}
                    </TableCell>
                    <TableCell colSpan={2}></TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={!!editBlock} onOpenChange={(o) => !o && setEditBlock(null)}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Zeitblock bearbeiten</DialogTitle>
            <DialogDescription>
              {editBlock && `${editBlock.user_name} – ${format(parseISO(editBlock.datum), "EEEE, dd.MM.yyyy", { locale: de })}`}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Start</Label>
                <Input type="time" value={editStart} onChange={(e) => setEditStart(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Ende</Label>
                <Input type="time" value={editEnd} onChange={(e) => setEditEnd(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Pause von</Label>
                <Input type="time" value={editPauseFrom} onChange={(e) => setEditPauseFrom(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Pause bis</Label>
                <Input type="time" value={editPauseTo} onChange={(e) => setEditPauseTo(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Projekt</Label>
              <Select value={editProjectId} onValueChange={setEditProjectId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">🏢 Büro / kein Projekt</SelectItem>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="bg-muted/50 rounded p-2 text-center">
              <div className="text-xs text-muted-foreground">Neue Stunden</div>
              <div className="font-bold">
                {computeHours(editStart, editEnd, pauseMinutesFromTimes(editPauseFrom, editPauseTo)).toFixed(2).replace(".", ",")}h
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditBlock(null)}>Abbrechen</Button>
            <Button onClick={saveEdit}>Speichern</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
