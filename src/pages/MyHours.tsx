import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Clock, Building2, Warehouse, Pencil, Trash2, Palmtree } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

type ProjectOption = { id: string; name: string; plz: string | null };

type TimeEntry = {
  id: string;
  datum: string;
  taetigkeit: string;
  stunden: number;
  start_time: string | null;
  end_time: string | null;
  pause_minutes: number | null;
  location_type: string;
  notizen: string | null;
  projects: { name: string; plz: string } | null;
  project_id: string | null;
};

const MyHours = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [roleChecked, setRoleChecked] = useState(false);

  // Role check: redirect mitarbeiter
  useEffect(() => {
    const checkRole = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .single();
      if (data?.role === "mitarbeiter") {
        toast({ variant: "destructive", title: "Kein Zugriff", description: "Diese Seite ist nur für Administratoren und Vorarbeiter zugänglich." });
        navigate("/");
        return;
      }
      setRoleChecked(true);
    };
    checkRole();
  }, []);
  const [totalHours, setTotalHours] = useState(0);
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [editingEntry, setEditingEntry] = useState<TimeEntry | null>(null);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [projectOptions, setProjectOptions] = useState<ProjectOption[]>([]);
  const [vacationBalance, setVacationBalance] = useState<{ total: number; used: number } | null>(null);
  const [vacationHistory, setVacationHistory] = useState<{ datum: string; stunden: number }[]>([]);

  useEffect(() => {
    fetchEntries();
    fetchProjects();
    fetchVacationData();
  }, [selectedMonth]);

  const fetchProjects = async () => {
    const { data } = await supabase
      .from("projects")
      .select("id, name, plz")
      .eq("status", "aktiv")
      .order("name");
    if (data) setProjectOptions(data);
  };

  const fetchVacationData = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const currentYear = new Date().getFullYear();

    // Fetch leave balance from admin settings
    const { data: balanceData } = await supabase
      .from("leave_balances")
      .select("total_days, used_days")
      .eq("user_id", user.id)
      .eq("year", currentYear)
      .maybeSingle();

    // Count actual vacation days from time_entries
    const yearStart = `${currentYear}-01-01`;
    const yearEnd = `${currentYear}-12-31`;
    const { data: vacEntries } = await supabase
      .from("time_entries")
      .select("datum, stunden")
      .eq("user_id", user.id)
      .eq("taetigkeit", "Urlaub")
      .gte("datum", yearStart)
      .lte("datum", yearEnd)
      .order("datum", { ascending: false });

    const usedDays = vacEntries?.length || 0;
    const totalDays = balanceData?.total_days || 25;

    setVacationBalance({ total: totalDays, used: usedDays });
    setVacationHistory(vacEntries || []);
  };

  const fetchEntries = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const [year, month] = selectedMonth.split('-').map(Number);
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    const { data } = await supabase
      .from("time_entries")
      .select("*, projects(name, plz)")
      .eq("user_id", user.id)
      .gte("datum", startDate)
      .lte("datum", endDate)
      .order("datum", { ascending: false });

    if (data) {
      setEntries(data as any);
      const sum = data.reduce((acc, entry) => acc + entry.stunden, 0);
      setTotalHours(sum);
    }
    setLoading(false);
  };

  const hasPause = (entry: TimeEntry) =>
    !!(entry.pause_minutes && entry.pause_minutes > 0);

  const calculateMorningEnd = (entry: TimeEntry) => {
    if (!entry.start_time || !entry.end_time) return "Alte Buchung";
    return hasPause(entry) ? "12:00" : entry.end_time?.substring(0, 5) || '-';
  };

  const calculateAfternoonStart = (entry: TimeEntry) => {
    if (!entry.start_time || !entry.end_time) return '-';
    return hasPause(entry) ? "13:00" : '-';
  };

  const formatPauseTime = (entry: TimeEntry) => {
    if (!entry.start_time || !entry.end_time) return '-';
    return hasPause(entry) ? "12:00 - 13:00" : '-';
  };

  const isEditable = (datum: string) => {
    const entryDate = new Date(datum);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diffMs = today.getTime() - entryDate.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    return diffDays <= 7;
  };

  const handleUpdateEntry = async () => {
    if (!editingEntry || savingEdit) return;

    setSavingEdit(true);

    // Pause ist immer fix 12:00–13:00 (60 Min.)
    const pauseMinutes = editingEntry.pause_minutes || 0;

    let calculatedHours = 0;
    if (editingEntry.start_time && editingEntry.end_time) {
      const toMin = (t: string) => {
        const [h, m] = t.substring(0, 5).split(":").map(Number);
        return h * 60 + m;
      };
      const totalMinutes = toMin(editingEntry.end_time) - toMin(editingEntry.start_time) - pauseMinutes;
      calculatedHours = Math.max(0, totalMinutes / 60);
    }

    const { error } = await supabase
      .from("time_entries")
      .update({
        taetigkeit: editingEntry.taetigkeit,
        start_time: editingEntry.start_time,
        end_time: editingEntry.end_time,
        pause_minutes: editingEntry.pause_minutes || 0,
        notizen: editingEntry.notizen,
        stunden: Math.max(0, calculatedHours),
        project_id: editingEntry.location_type === "werkstatt" ? null : editingEntry.project_id,
        location_type: editingEntry.location_type,
      })
      .eq("id", editingEntry.id);

    if (error) {
      toast({
        variant: "destructive",
        title: "Fehler",
        description: "Eintrag konnte nicht aktualisiert werden",
      });
    } else {
      toast({
        title: "Erfolg",
        description: "Eintrag wurde aktualisiert",
      });
      setShowEditDialog(false);
      setEditingEntry(null);
      fetchEntries();
    }
    setSavingEdit(false);
  };

  const handleDeleteEntry = async (id: string) => {
    if (!confirm("Möchtest du diesen Eintrag wirklich löschen?")) return;

    const { error } = await supabase
      .from("time_entries")
      .delete()
      .eq("id", id);

    if (error) {
      toast({
        variant: "destructive",
        title: "Fehler",
        description: "Eintrag konnte nicht gelöscht werden",
      });
    } else {
      toast({
        title: "Erfolg",
        description: "Eintrag wurde gelöscht",
      });
      setShowEditDialog(false);
      setEditingEntry(null);
      fetchEntries();
    }
  };

  if (loading || !roleChecked) {
    return <div className="min-h-screen flex items-center justify-center"><p>Lädt...</p></div>;
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card sticky top-0 z-50 shadow-sm">
        <div className="container mx-auto px-3 sm:px-4 py-3 sm:py-4">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => navigate("/")}>
              <ArrowLeft className="h-4 w-4 mr-2" />Zurück
            </Button>
            <img 
              src="/gasser-logo.png"
              alt="Holzbau Gasser"
              className="h-10 w-10 sm:h-14 sm:w-14 cursor-pointer hover:opacity-80 transition-opacity object-contain"
              onClick={() => navigate("/")}
            />
          </div>
        </div>
      </header>

      <main className="container mx-auto px-3 sm:px-4 py-4 sm:py-6 max-w-7xl">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Meine Stunden
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 pb-4 border-b">
              <div className="flex items-center gap-2">
                <Label htmlFor="month-select" className="text-sm font-medium">Monat:</Label>
                <Input
                  id="month-select"
                  type="month"
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="w-44"
                />
              </div>
              <div className="text-sm sm:text-base">
                <span className="text-muted-foreground">Gesamt: </span>
                <span className="font-bold text-lg text-primary">{totalHours.toFixed(2)} Std.</span>
              </div>
            </div>

            {entries.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                Keine Einträge für {new Date(selectedMonth + '-01').toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}
              </p>
            ) : (
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Datum</TableHead>
                      <TableHead>Ort</TableHead>
                      <TableHead>Projekt</TableHead>
                      <TableHead>Tätigkeit</TableHead>
                      <TableHead colSpan={2} className="text-center">Vormittag</TableHead>
                      <TableHead className="text-center">Pause</TableHead>
                      <TableHead colSpan={2} className="text-center">Nachmittag</TableHead>
                      <TableHead className="text-right">Stunden</TableHead>
                      <TableHead className="text-right">Aktionen</TableHead>
                    </TableRow>
                    <TableRow>
                      <TableHead></TableHead>
                      <TableHead></TableHead>
                      <TableHead></TableHead>
                      <TableHead></TableHead>
                      <TableHead className="text-center">Beginn</TableHead>
                      <TableHead className="text-center">Ende</TableHead>
                      <TableHead className="text-center">von - bis</TableHead>
                      <TableHead className="text-center">Beginn</TableHead>
                      <TableHead className="text-center">Ende</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entries.map((entry) => (
                      <TableRow key={entry.id}>
                        <TableCell className="font-medium whitespace-nowrap">
                          {new Date(entry.datum).toLocaleDateString("de-DE")}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2 whitespace-nowrap">
                            {entry.location_type === 'werkstatt' ? (
                              <>
                                <Warehouse className="w-4 h-4 text-muted-foreground" />
                                <span>Lager</span>
                              </>
                            ) : (
                              <>
                                <Building2 className="w-4 h-4 text-muted-foreground" />
                                <span>Baustelle</span>
                              </>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>{entry.projects?.name || '-'}</TableCell>
                        <TableCell>{entry.taetigkeit}</TableCell>
                        <TableCell className="text-center">
                          {entry.start_time?.substring(0, 5) || '-'}
                        </TableCell>
                        <TableCell className="text-center">
                          {calculateMorningEnd(entry)}
                        </TableCell>
                        <TableCell className="text-center">
                          {formatPauseTime(entry)}
                        </TableCell>
                        <TableCell className="text-center">
                          {calculateAfternoonStart(entry)}
                        </TableCell>
                        <TableCell className="text-center">
                          {entry.pause_minutes && entry.pause_minutes > 0 
                            ? entry.end_time?.substring(0, 5) || '-'
                            : '-'}
                        </TableCell>
                        <TableCell className="text-right font-semibold">
                          {entry.stunden.toFixed(2)} h
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => navigate(`/time-tracking?date=${entry.datum}`)}
                            disabled={!isEditable(entry.datum)}
                            className="h-8"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  <TableFooter>
                    <TableRow>
                      <TableCell colSpan={10} className="text-right font-semibold">
                        Gesamtstunden:
                      </TableCell>
                      <TableCell className="text-right font-bold text-lg">
                        {totalHours.toFixed(2)} h
                      </TableCell>
                    </TableRow>
                  </TableFooter>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Urlaubskonto */}
        {vacationBalance && (
          <Card className="mt-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Palmtree className="h-5 w-5" />
                Urlaubskonto {new Date().getFullYear()}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-4 mb-4">
                <div className="bg-muted/50 rounded-lg p-3 flex-1 min-w-[120px]">
                  <p className="text-sm text-muted-foreground">Gesamt</p>
                  <p className="text-2xl font-bold">{vacationBalance.total}</p>
                  <p className="text-xs text-muted-foreground">Tage</p>
                </div>
                <div className="bg-muted/50 rounded-lg p-3 flex-1 min-w-[120px]">
                  <p className="text-sm text-muted-foreground">Verbraucht</p>
                  <p className="text-2xl font-bold">{vacationBalance.used}</p>
                  <p className="text-xs text-muted-foreground">Tage</p>
                </div>
                <div className="bg-primary/10 rounded-lg p-3 flex-1 min-w-[120px]">
                  <p className="text-sm text-muted-foreground">Verbleibend</p>
                  <p className="text-2xl font-bold text-primary">{vacationBalance.total - vacationBalance.used}</p>
                  <p className="text-xs text-muted-foreground">Tage</p>
                </div>
              </div>

              {vacationHistory.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium mb-2">Urlaubsverlauf</h4>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                    {vacationHistory.map((v, i) => (
                      <div key={i} className="flex items-center justify-between py-1.5 px-3 rounded bg-muted/30 text-sm">
                        <span>{new Date(v.datum).toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "long", year: "numeric" })}</span>
                        <Badge variant="secondary">-1 Tag</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {vacationHistory.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-2">Noch kein Urlaub genommen in {new Date().getFullYear()}</p>
              )}
            </CardContent>
          </Card>
        )}
      </main>

      {/* Edit Dialog */}
      <Dialog open={showEditDialog} onOpenChange={(open) => {
        setShowEditDialog(open);
        if (!open) setEditingEntry(null);
      }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Stundeneintrag bearbeiten</DialogTitle>
            <DialogDescription>
              {editingEntry && (
                <>
                  Datum: {new Date(editingEntry.datum).toLocaleDateString('de-DE', { 
                    weekday: 'long', 
                    day: '2-digit', 
                    month: 'long', 
                    year: 'numeric' 
                  })}
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          {editingEntry && (
            <div className="space-y-4">
              {/* Ort */}
              <div>
                <Label className="mb-2 block">Ort</Label>
                <RadioGroup
                  value={editingEntry.location_type || "baustelle"}
                  onValueChange={(value) => setEditingEntry({...editingEntry, location_type: value, project_id: value === "werkstatt" ? null : editingEntry.project_id})}
                  className="grid grid-cols-2 gap-2"
                >
                  <div>
                    <RadioGroupItem value="baustelle" id="edit-baustelle" className="peer sr-only" />
                    <Label
                      htmlFor="edit-baustelle"
                      className="flex h-10 cursor-pointer items-center justify-center rounded-md border-2 border-muted bg-popover hover:bg-accent peer-data-[state=checked]:border-primary text-sm"
                    >
                      🏗️ Baustelle
                    </Label>
                  </div>
                  <div>
                    <RadioGroupItem value="werkstatt" id="edit-werkstatt" className="peer sr-only" />
                    <Label
                      htmlFor="edit-werkstatt"
                      className="flex h-10 cursor-pointer items-center justify-center rounded-md border-2 border-muted bg-popover hover:bg-accent peer-data-[state=checked]:border-primary text-sm"
                    >
                      🏭 Lager
                    </Label>
                  </div>
                </RadioGroup>
              </div>

              {/* Projekt - nur bei Baustelle */}
              {editingEntry.location_type !== "werkstatt" && (
                <div>
                  <Label>Projekt</Label>
                  <Select
                    value={editingEntry.project_id || "none"}
                    onValueChange={(v) => setEditingEntry({...editingEntry, project_id: v === "none" ? null : v})}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Projekt auswählen" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Kein Projekt</SelectItem>
                      {projectOptions.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}{p.plz ? ` (${p.plz})` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div>
                <Label htmlFor="edit-taetigkeit">Tätigkeit</Label>
                <Input
                  id="edit-taetigkeit"
                  value={editingEntry.taetigkeit}
                  onChange={(e) => setEditingEntry({...editingEntry, taetigkeit: e.target.value})}
                  placeholder="z.B. Dachstuhl montieren"
                />
              </div>

              {/* Vormittag */}
              <div className="space-y-3 p-4 rounded-lg border bg-muted/30">
                <h3 className="font-semibold text-sm">Vormittag</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="edit-morning-start">Beginn</Label>
                    <Input
                      id="edit-morning-start"
                      type="time"
                      value={editingEntry.start_time || '07:30'}
                      onChange={(e) => setEditingEntry({...editingEntry, start_time: e.target.value})}
                    />
                  </div>
                  <div>
                    <Label htmlFor="edit-morning-end">Ende</Label>
                    <Input
                      id="edit-morning-end"
                      type="time"
                      value="12:00"
                      disabled
                      className="bg-muted"
                    />
                  </div>
                </div>
              </div>

              {/* Unterbrechung */}
              <div className="space-y-3 p-4 rounded-lg border bg-muted/30">
                <h3 className="font-semibold text-sm">Unterbrechung</h3>
                <div>
                  <Label htmlFor="edit-pause">Dauer (Minuten)</Label>
                  <Input
                    id="edit-pause"
                    type="number"
                    min="0"
                    value={editingEntry.pause_minutes || 0}
                    onChange={(e) => setEditingEntry({...editingEntry, pause_minutes: parseInt(e.target.value) || 0})}
                  />
                </div>
              </div>

              {/* Nachmittag */}
              <div className="space-y-3 p-4 rounded-lg border bg-muted/30">
                <h3 className="font-semibold text-sm">Nachmittag</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="edit-afternoon-start">Beginn</Label>
                    <Input
                      id="edit-afternoon-start"
                      type="time"
                      value="13:00"
                      disabled
                      className="bg-muted"
                    />
                  </div>
                  <div>
                    <Label htmlFor="edit-afternoon-end">Ende</Label>
                    <Input
                      id="edit-afternoon-end"
                      type="time"
                      value={editingEntry.end_time || ''}
                      onChange={(e) => setEditingEntry({...editingEntry, end_time: e.target.value})}
                    />
                  </div>
                </div>
              </div>

              <div className="flex gap-2 pt-4">
                <Button onClick={handleUpdateEntry} className="flex-1" disabled={savingEdit}>
                  {savingEdit ? 'Wird gespeichert...' : 'Speichern'}
                </Button>
                <Button 
                  variant="destructive"
                  onClick={() => editingEntry && handleDeleteEntry(editingEntry.id)}
                  className="flex-1"
                  disabled={savingEdit}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Löschen
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default MyHours;
