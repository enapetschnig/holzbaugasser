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
import { Download, Pencil, Trash2, ChevronLeft, ChevronRight, Building2, User as UserIcon } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { useToast } from "@/hooks/use-toast";
import * as XLSX from "xlsx-js-style";
import { format, parseISO } from "date-fns";
import { de } from "date-fns/locale";
import { localDateString } from "@/lib/workingHours";
import { computeBlock } from "@/lib/vorfertigungBlocks";

type Profile = { id: string; vorname: string; nachname: string };
type Project = { id: string; name: string };

type Block = {
  id: string;
  user_id: string;
  user_name: string;
  datum: string;
  start_time: string | null;
  end_time: string | null;
  pause_minutes: number;
  stunden: number;
  project_id: string | null;
  project_name: string;
};

const MONTHS = ["Jänner", "Feber", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

function formatTime(t: string | null): string {
  if (!t) return "";
  return t.substring(0, 5);
}

export default function VorfertigungAuswertung() {
  const { toast } = useToast();
  const today = new Date();

  const [year, setYear] = useState<number>(today.getFullYear());
  const [month, setMonth] = useState<number>(today.getMonth() + 1);
  const [selectedUserId, setSelectedUserId] = useState<string>("all");

  const [users, setUsers] = useState<Profile[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [loading, setLoading] = useState(false);

  // Edit dialog
  const [editBlock, setEditBlock] = useState<Block | null>(null);
  const [editStart, setEditStart] = useState("");
  const [editEnd, setEditEnd] = useState("");
  const [editProjectId, setEditProjectId] = useState<string>("none");

  const startDate = useMemo(
    () => localDateString(new Date(year, month - 1, 1)),
    [year, month]
  );
  const endDate = useMemo(
    () => localDateString(new Date(year, month, 0)),
    [year, month]
  );

  // -----------------------------------------------------------------
  // Load data
  // -----------------------------------------------------------------

  const loadUsers = useCallback(async () => {
    // Alle non-extern Profile laden (Mitarbeiter, Vorarbeiter, Projektleiter, Admin)
    const { data: roles } = await supabase
      .from("user_roles")
      .select("user_id, role")
      .in("role", ["mitarbeiter", "vorarbeiter", "projektleiter", "administrator"]);

    const ids = [...new Set((roles || []).map((r) => r.user_id))];
    if (ids.length === 0) {
      setUsers([]);
      return;
    }

    const { data: profilesData } = await supabase
      .from("profiles")
      .select("id, vorname, nachname, is_active, is_hidden")
      .in("id", ids)
      .eq("is_active", true);

    const filtered = (profilesData || []).filter((p: any) => !p.is_hidden);
    filtered.sort((a, b) => a.nachname.localeCompare(b.nachname));
    setUsers(filtered);
  }, []);

  const loadProjects = useCallback(async () => {
    const { data } = await supabase.from("projects").select("id, name").order("name");
    setProjects(data || []);
  }, []);

  const loadBlocks = useCallback(async () => {
    if (users.length === 0) return;
    setLoading(true);

    let userIds = users.map((u) => u.id);
    if (selectedUserId !== "all") userIds = [selectedUserId];

    const { data } = await supabase
      .from("time_entries")
      .select("id, user_id, datum, start_time, end_time, pause_minutes, stunden, project_id, entry_typ")
      .in("user_id", userIds)
      .eq("entry_typ", "vorfertigung")
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
      pause_minutes: e.pause_minutes || 0,
      stunden: parseFloat(e.stunden) || 0,
      project_id: e.project_id || null,
      project_name: e.project_id ? (projMap[e.project_id] || "Unbekannt") : "Werk",
    }));

    setBlocks(result);
    setLoading(false);
  }, [users, projects, selectedUserId, startDate, endDate]);

  useEffect(() => { loadUsers(); loadProjects(); }, [loadUsers, loadProjects]);
  useEffect(() => { loadBlocks(); }, [loadBlocks]);

  // -----------------------------------------------------------------
  // Computed
  // -----------------------------------------------------------------

  const totalsByProject = useMemo(() => {
    const map: Record<string, { name: string; stunden: number }> = {};
    for (const b of blocks) {
      const key = b.project_id || "__WERK__";
      const name = b.project_id ? b.project_name : "Werk";
      if (!map[key]) map[key] = { name, stunden: 0 };
      map[key].stunden += b.stunden;
    }
    return Object.entries(map).map(([id, d]) => ({ id, ...d })).sort((a, b) => b.stunden - a.stunden);
  }, [blocks]);

  const totalsByUser = useMemo(() => {
    const map: Record<string, { name: string; stunden: number; count: number }> = {};
    for (const b of blocks) {
      if (!map[b.user_id]) map[b.user_id] = { name: b.user_name, stunden: 0, count: 0 };
      map[b.user_id].stunden += b.stunden;
      map[b.user_id].count += 1;
    }
    return Object.entries(map).map(([uid, d]) => ({ uid, ...d })).sort((a, b) => b.stunden - a.stunden);
  }, [blocks]);

  const grandTotal = useMemo(() => blocks.reduce((s, b) => s + b.stunden, 0), [blocks]);

  // Pro User: Projekte mit Blöcken
  const projectsByUser = useMemo(() => {
    const map: Record<string, Record<string, { name: string; stunden: number; blocks: Block[] }>> = {};
    for (const b of blocks) {
      const pkey = b.project_id || "__WERK__";
      const pname = b.project_id ? b.project_name : "Werk";
      if (!map[b.user_id]) map[b.user_id] = {};
      if (!map[b.user_id][pkey]) map[b.user_id][pkey] = { name: pname, stunden: 0, blocks: [] };
      map[b.user_id][pkey].stunden += b.stunden;
      map[b.user_id][pkey].blocks.push(b);
    }
    return map;
  }, [blocks]);

  const shiftMonth = (delta: number) => {
    let m = month + delta;
    let y = year;
    if (m > 12) { m = 1; y += 1; }
    if (m < 1) { m = 12; y -= 1; }
    setMonth(m);
    setYear(y);
  };

  // -----------------------------------------------------------------
  // Excel Export
  // -----------------------------------------------------------------

  const exportToExcel = () => {
    if (blocks.length === 0) {
      toast({ variant: "destructive", title: "Keine Daten", description: "Keine Blöcke im gewählten Zeitraum." });
      return;
    }

    const label = selectedUserId === "all"
      ? "Alle Mitarbeiter"
      : users.find((u) => u.id === selectedUserId)
        ? `${users.find((u) => u.id === selectedUserId)!.nachname} ${users.find((u) => u.id === selectedUserId)!.vorname}`
        : "";

    const rows: any[][] = [
      ["Vorfertigung / LKW-Zeiterfassung"],
      ["Mitarbeiter:", label],
      ["Zeitraum:", `${MONTHS[month - 1]} ${year}`],
      [],
      ["Datum", "Wochentag", "Mitarbeiter", "Start", "Ende", "Pause (min)", "Stunden", "Projekt"],
    ];

    for (const b of blocks) {
      const d = parseISO(b.datum);
      rows.push([
        format(d, "dd.MM.yyyy"),
        format(d, "EEEE", { locale: de }),
        b.user_name,
        formatTime(b.start_time),
        formatTime(b.end_time),
        b.pause_minutes || 0,
        b.stunden.toFixed(2).replace(".", ","),
        b.project_name,
      ]);
    }
    rows.push([]);
    rows.push(["", "", "", "", "", "Gesamt", grandTotal.toFixed(2).replace(".", ","), ""]);

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
      { wch: 12 }, { wch: 12 }, { wch: 22 }, { wch: 8 }, { wch: 8 }, { wch: 12 }, { wch: 10 }, { wch: 30 },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Vorfertigung");

    const fileName = `Vorfertigung_${MONTHS[month - 1]}_${year}${selectedUserId !== "all" ? "_" + label.replace(/\s+/g, "_") : ""}.xlsx`;
    XLSX.writeFile(wb, fileName);
    toast({ title: "Excel erstellt", description: fileName });
  };

  // -----------------------------------------------------------------
  // Edit
  // -----------------------------------------------------------------

  const openEdit = (b: Block) => {
    setEditBlock(b);
    setEditStart(formatTime(b.start_time));
    setEditEnd(formatTime(b.end_time));
    setEditProjectId(b.project_id || "none");
  };

  const saveEdit = async () => {
    if (!editBlock) return;
    const pid = editProjectId === "none" ? null : editProjectId;
    const projName = pid ? projects.find((p) => p.id === pid)?.name : "Werk";
    const c = computeBlock({ startTime: editStart, endTime: editEnd, projectId: pid });
    if (c.stunden <= 0) {
      toast({ variant: "destructive", title: "Ungültig", description: "Endzeit muss nach Startzeit liegen." });
      return;
    }
    const { error } = await supabase
      .from("time_entries")
      .update({
        start_time: c.startTime,
        end_time: c.endTime,
        pause_start: c.pauseStart,
        pause_end: c.pauseEnd,
        pause_minutes: c.pauseMinutes,
        stunden: c.stunden,
        project_id: pid,
        taetigkeit: pid ? `Vorfertigung: ${projName}` : "Vorfertigung: Werk",
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
      <Card>
        <CardHeader>
          <CardTitle>Vorfertigung / LKW-Stunden</CardTitle>
          <CardDescription>
            Alle blockweise erfassten Zeiten der Vorfertigung-Mitarbeiter und Fahrer
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Monat</Label>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="icon" onClick={() => shiftMonth(-1)}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Select value={String(month)} onValueChange={(v) => setMonth(parseInt(v))}>
                  <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MONTHS.map((m, i) => <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={String(year)} onValueChange={(v) => setYear(parseInt(v))}>
                  <SelectTrigger className="w-[90px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 5 }, (_, i) => today.getFullYear() - 2 + i).map((y) => (
                      <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="outline" size="icon" onClick={() => shiftMonth(1)}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="space-y-1">
              <Label>Mitarbeiter</Label>
              <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alle ({users.length})</SelectItem>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.nachname} {u.vorname}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 items-center">
            <div className="flex-1" />
            <Button onClick={exportToExcel} disabled={blocks.length === 0}>
              <Download className="h-4 w-4 mr-2" />
              Excel exportieren
            </Button>
          </div>

          {blocks.length > 0 && (
            <div className="flex flex-wrap gap-3 pt-2 border-t">
              <div className="text-sm">
                <span className="text-muted-foreground">Blöcke:</span> <strong>{blocks.length}</strong>
              </div>
              <div className="text-sm">
                <span className="text-muted-foreground">Gesamt:</span> <strong>{grandTotal.toFixed(2).replace(".", ",")}h</strong>
              </div>
              {totalsByUser.length > 1 && (
                <div className="text-sm">
                  <span className="text-muted-foreground">Mitarbeiter:</span> <strong>{totalsByUser.length}</strong>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {loading ? (
        <Card><CardContent className="py-8 text-center text-muted-foreground">Lade...</CardContent></Card>
      ) : blocks.length === 0 ? (
        <Card><CardContent className="py-8 text-center text-muted-foreground">Keine Einträge im gewählten Zeitraum.</CardContent></Card>
      ) : (
        <>
          {/* Summary pro Projekt */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Building2 className="h-4 w-4" />
                Stunden pro Projekt
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {totalsByProject.map((p) => (
                  <div key={p.id} className="border rounded-lg px-3 py-2 flex items-center justify-between bg-muted/30">
                    <span className="truncate flex-1 min-w-0 text-sm font-medium">{p.name}</span>
                    <Badge variant="secondary" className="ml-2 shrink-0">
                      {p.stunden.toFixed(2).replace(".", ",")}h
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Pro Mitarbeiter */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <UserIcon className="h-4 w-4" />
                Pro Mitarbeiter
              </CardTitle>
            </CardHeader>
            <CardContent className="px-2 sm:px-4">
              <Accordion type="multiple" className="space-y-2">
                {totalsByUser.map((u) => {
                  const userProjects = projectsByUser[u.uid] || {};
                  const projectEntries = Object.entries(userProjects)
                    .map(([pid, d]) => ({ pid, ...d }))
                    .sort((a, b) => b.stunden - a.stunden);
                  return (
                    <AccordionItem key={u.uid} value={u.uid} className="border rounded-lg px-3">
                      <AccordionTrigger className="hover:no-underline py-2">
                        <div className="flex items-center justify-between w-full pr-2">
                          <span className="font-medium">{u.name}</span>
                          <Badge variant="secondary">{u.stunden.toFixed(2).replace(".", ",")}h</Badge>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent className="pb-2">
                        <div className="space-y-1">
                          {projectEntries.map((pe) => (
                            <Accordion key={pe.pid} type="single" collapsible>
                              <AccordionItem value={pe.pid} className="border-b last:border-0">
                                <AccordionTrigger className="hover:no-underline py-1.5 text-sm">
                                  <div className="flex items-center justify-between w-full pr-2">
                                    <span className="flex items-center gap-2 truncate">
                                      <Building2 className="h-3 w-3 shrink-0 text-muted-foreground" />
                                      {pe.name}
                                      <span className="text-xs text-muted-foreground">
                                        ({pe.blocks.length} {pe.blocks.length === 1 ? "Block" : "Blöcke"})
                                      </span>
                                    </span>
                                    <Badge variant="outline" className="ml-2 shrink-0">
                                      {pe.stunden.toFixed(2).replace(".", ",")}h
                                    </Badge>
                                  </div>
                                </AccordionTrigger>
                                <AccordionContent className="pb-2">
                                  <div className="space-y-1">
                                    {pe.blocks
                                      .sort((a, b) => a.datum.localeCompare(b.datum) || (a.start_time || "").localeCompare(b.start_time || ""))
                                      .map((b) => {
                                        const d = parseISO(b.datum);
                                        return (
                                          <div key={b.id} className="flex items-center gap-2 text-sm py-1 px-2 hover:bg-muted/40 rounded">
                                            <span className="w-20 shrink-0">{format(d, "dd.MM.")}</span>
                                            <span className="w-8 shrink-0 text-xs text-muted-foreground">{format(d, "EE", { locale: de })}</span>
                                            <span className="w-24 shrink-0 font-mono text-xs text-muted-foreground">
                                              {formatTime(b.start_time)}–{formatTime(b.end_time)}
                                            </span>
                                            {b.pause_minutes ? (
                                              <span className="text-xs text-muted-foreground">P{b.pause_minutes}</span>
                                            ) : null}
                                            <span className="flex-1 text-right font-medium">
                                              {b.stunden.toFixed(2).replace(".", ",")}h
                                            </span>
                                            <Button variant="ghost" size="icon" onClick={() => openEdit(b)} className="h-7 w-7">
                                              <Pencil className="h-3.5 w-3.5" />
                                            </Button>
                                            <Button variant="ghost" size="icon" onClick={() => deleteBlock(b)} className="h-7 w-7 text-destructive">
                                              <Trash2 className="h-3.5 w-3.5" />
                                            </Button>
                                          </div>
                                        );
                                      })}
                                  </div>
                                </AccordionContent>
                              </AccordionItem>
                            </Accordion>
                          ))}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  );
                })}
              </Accordion>
              <div className="mt-3 pt-3 border-t flex items-center justify-between text-sm">
                <span className="font-medium">Gesamt</span>
                <Badge variant="default">{grandTotal.toFixed(2).replace(".", ",")}h</Badge>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* Edit Dialog */}
      <Dialog open={!!editBlock} onOpenChange={(o) => !o && setEditBlock(null)}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Block bearbeiten</DialogTitle>
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
            <div className="space-y-1">
              <Label>Projekt</Label>
              <Select value={editProjectId} onValueChange={setEditProjectId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">🏢 Werk / kein Projekt</SelectItem>
                  {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="text-xs text-muted-foreground">
              Pause (12:00–12:30) wird automatisch abgezogen wenn der Block diese Zeit überspannt.
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
