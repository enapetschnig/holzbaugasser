import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar, Loader2, Plus, Settings, ChevronDown, ChevronUp } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { ensureLeaveAccount, createWorkerAccount } from "@/lib/leaveAccount";

type Profile = {
  id: string;
  vorname: string;
  nachname: string;
};

type LeaveBalance = {
  id: string;
  user_id: string;
  year: number;
  total_days: number;
  used_days: number;
  days_per_month: number | null;
  next_credit_date: string | null;
  last_credit_date: string | null;
  modus: string | null;             // 'monatlich' (Arbeiter) | 'jaehrlich' (Angestellter)
  jahres_kontingent: number | null; // nur bei modus='jaehrlich'
};

type LeaveLogEntry = {
  id: string;
  user_id: string;
  year: number;
  action: string;
  days: number | null;
  description: string;
  created_at: string;
};

interface LeaveManagementProps {
  profiles: Profile[];
}

export default function LeaveManagement({ profiles }: LeaveManagementProps) {
  const { toast } = useToast();
  const [balances, setBalances] = useState<LeaveBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [editingBalance, setEditingBalance] = useState<string | null>(null);
  const [editDays, setEditDays] = useState("");
  const [vacationEntries, setVacationEntries] = useState<{ user_id: string; datum: string; created_at: string }[]>([]);
  const [leaveLog, setLeaveLog] = useState<LeaveLogEntry[]>([]);
  const [expandedProfiles, setExpandedProfiles] = useState<Set<string>>(new Set());
  const [editingSettings, setEditingSettings] = useState<string | null>(null);
  const [editDaysPerMonth, setEditDaysPerMonth] = useState("");
  const [editNextCreditDate, setEditNextCreditDate] = useState("");
  const [editModus, setEditModus] = useState<"monatlich" | "jaehrlich">("monatlich");
  const [editJahresKontingent, setEditJahresKontingent] = useState("");

  const fetchData = async () => {
    setLoading(true);
    const yearStart = `${selectedYear}-01-01`;
    const yearEnd = `${selectedYear}-12-31`;
    const currentYear = new Date().getFullYear();

    // Fällige Gutschriften/Jahreswechsel NUR fürs aktuelle Jahr nachholen —
    // das Ansehen alter Jahre darf Alt-Konten nicht weiter befüllen, und
    // Zukunfts-Jahre werden nicht vorab angelegt. Ohne bestehende Zeile wird
    // hier NICHTS angelegt (autoCreate false) — dafür gibt es den Button.
    if (selectedYear === currentYear) {
      for (const profile of profiles) {
        await ensureLeaveAccount(profile.id, currentYear, { autoCreate: false });
      }
    }

    const [{ data: balData }, { data: vacData }, { data: logData }] = await Promise.all([
      supabase.from("leave_balances").select("*").eq("year", selectedYear),
      supabase.from("time_entries").select("user_id, datum, created_at")
        .eq("taetigkeit", "Urlaub").gte("datum", yearStart).lte("datum", yearEnd)
        .order("datum", { ascending: false }),
      supabase.from("leave_log" as any).select("*").eq("year", selectedYear)
        .order("created_at", { ascending: false }),
    ]);

    if (balData) setBalances(balData as LeaveBalance[]);
    if (vacData) setVacationEntries(vacData);
    if (logData) setLeaveLog(logData as LeaveLogEntry[]);

    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, [selectedYear]);

  const ensureBalance = async (userId: string) => {
    const existing = balances.find((b) => b.user_id === userId && b.year === selectedYear);
    if (existing) return;
    // Grundstufe: Arbeiter-Konto (0 Tage, 2,08/Monat ab jetzt) — Modus danach
    // über das Zahnrad umstellbar.
    await createWorkerAccount(userId, selectedYear);
    toast({ title: "Kontingent angelegt" });
    fetchData();
  };

  const updateTotalDays = async (balanceId: string, userId: string, totalDays: number, oldDays: number) => {
    await supabase.from("leave_balances").update({ total_days: totalDays }).eq("id", balanceId);

    await supabase.from("leave_log" as any).insert({
      user_id: userId,
      year: selectedYear,
      action: "kontingent_geaendert",
      days: totalDays - oldDays,
      description: `Kontingent geändert: ${oldDays} → ${totalDays} Tage`,
    });

    toast({ title: "Gespeichert" });
    setEditingBalance(null);
    fetchData();
  };

  // Einstellungen (Modus/Kontingent/Termin) speichern — fasst total_days/used_days
  // NIE an: eine Umstellung Arbeiter↔Angestellter lässt den Saldo exakt stehen,
  // nur künftige Gutschriften folgen dem neuen Modus.
  const saveSettings = async (balanceId: string, userId: string) => {
    if (editModus === "jaehrlich") {
      const kontingent = parseFloat(editJahresKontingent.replace(",", "."));
      if (isNaN(kontingent) || kontingent <= 0) {
        toast({ title: "Bitte ein Jahres-Kontingent > 0 angeben", variant: "destructive" });
        return;
      }
      if (!editNextCreditDate) {
        toast({ title: "Bitte einen Stichtag angeben", variant: "destructive" });
        return;
      }
      await supabase.from("leave_balances").update({
        modus: "jaehrlich",
        jahres_kontingent: kontingent,
        next_credit_date: editNextCreditDate,
      } as any).eq("id", balanceId);

      await supabase.from("leave_log" as any).insert({
        user_id: userId,
        year: selectedYear,
        action: "einstellung_geaendert",
        days: null,
        description: `Einstellung geändert: Angestellter, ${kontingent} Tage/Jahr, Stichtag ${format(new Date(editNextCreditDate), "dd.MM.yyyy")}`,
      });
    } else {
      const dpm = parseFloat(editDaysPerMonth) || 2.08;
      await supabase.from("leave_balances").update({
        modus: "monatlich",
        days_per_month: dpm,
        next_credit_date: editNextCreditDate || null,
      } as any).eq("id", balanceId);

      await supabase.from("leave_log" as any).insert({
        user_id: userId,
        year: selectedYear,
        action: "einstellung_geaendert",
        days: null,
        description: `Einstellung geändert: Arbeiter, ${dpm} Tage/Monat, nächste Gutschrift: ${editNextCreditDate || "nicht gesetzt"}`,
      });
    }

    toast({ title: "Einstellungen gespeichert" });
    setEditingSettings(null);
    fetchData();
  };

  // Beim Umschalten auf "Angestellter": Stichtag mit dem nächsten künftigen
  // Jahrestag des heutigen Datums vorbelegen.
  const defaultStichtag = (): string => {
    const now = new Date();
    return `${now.getFullYear() + 1}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  };

  const toggleExpanded = (id: string) => {
    setExpandedProfiles(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  if (loading) {
    return <div className="flex items-center justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                Urlaubsverwaltung {selectedYear}
              </CardTitle>
              <CardDescription>Urlaubstage, Gutschriften und Verlauf</CardDescription>
            </div>
            <Select value={String(selectedYear)} onValueChange={(v) => setSelectedYear(Number(v))}>
              <SelectTrigger className="w-[120px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[selectedYear - 1, selectedYear, selectedYear + 1].map((y) => (
                  <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {profiles.filter((p) => p.vorname && p.nachname).map((profile) => {
              const balance = balances.find((b) => b.user_id === profile.id && b.year === selectedYear);
              // Anzeige: immer ganze Tage. DB-Wert bleibt präzise.
              const totalDaysRaw = balance?.total_days || 0;
              const totalDays = Math.round(totalDaysRaw);
              const userVacEntries = vacationEntries.filter((v) => v.user_id === profile.id);
              const usedDays = userVacEntries.length;
              const remaining = Math.round(totalDaysRaw - usedDays);
              const userLog = leaveLog.filter(l => l.user_id === profile.id);
              const isExpanded = expandedProfiles.has(profile.id);
              const daysPerMonth = balance?.days_per_month ?? 2.08;
              const nextCredit = balance?.next_credit_date;
              const isJaehrlich = balance?.modus === "jaehrlich";

              return (
                <div key={profile.id} className="rounded-lg border">
                  {/* Header */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3">
                    <div className="flex-1">
                      <p className="font-medium flex items-center gap-2">
                        {profile.vorname} {profile.nachname}
                        {balance && (
                          <Badge variant={isJaehrlich ? "default" : "secondary"} className="text-[10px]">
                            {isJaehrlich ? "Angestellter" : "Arbeiter"}
                          </Badge>
                        )}
                      </p>
                      {balance ? (
                        <div className="text-sm text-muted-foreground">
                          <span className="font-medium">{usedDays}</span> von {totalDays} Tagen verbraucht · <span className={remaining <= 3 ? "text-red-600 font-medium" : "font-medium"}>{remaining} übrig</span>
                          <span className="ml-2 text-xs">
                            {isJaehrlich
                              ? `(${Math.round((balance.jahres_kontingent ?? 0) * 10) / 10} Tage/Jahr${nextCredit ? `, Stichtag: ${format(new Date(nextCredit), "dd.MM.yyyy")}` : ""})`
                              : `(${daysPerMonth.toFixed(1).replace(".", ",")} Tage/Monat${nextCredit ? `, nächste Gutschrift: ${format(new Date(nextCredit), "dd.MM.yyyy")}` : ""})`}
                          </span>
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">Noch kein Kontingent angelegt</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {balance && editingBalance === balance.id ? (
                        <div className="flex gap-1">
                          <Input type="number" value={editDays} onChange={(e) => setEditDays(e.target.value)} className="w-20" />
                          <Button size="sm" onClick={() => updateTotalDays(balance.id, profile.id, Number(editDays), balance.total_days)}>OK</Button>
                        </div>
                      ) : balance ? (
                        <>
                          <Button variant="outline" size="sm" onClick={() => { setEditingBalance(balance.id); setEditDays(String(Math.round(balance.total_days))); }}>
                            Tage ändern
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => {
                            if (editingSettings === balance.id) { setEditingSettings(null); } else {
                              setEditingSettings(balance.id);
                              setEditModus(balance.modus === "jaehrlich" ? "jaehrlich" : "monatlich");
                              setEditJahresKontingent(balance.jahres_kontingent != null ? String(balance.jahres_kontingent) : "25");
                              setEditDaysPerMonth(String(balance.days_per_month ?? 2.08));
                              setEditNextCreditDate(balance.next_credit_date || "");
                            }
                          }}>
                            <Settings className="h-4 w-4" />
                          </Button>
                        </>
                      ) : (
                        <Button variant="outline" size="sm" onClick={() => ensureBalance(profile.id)}>
                          Kontingent anlegen
                        </Button>
                      )}
                      {balance && (
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => toggleExpanded(profile.id)}>
                          {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Settings */}
                  {balance && editingSettings === balance.id && (
                    <div className="border-t px-3 py-3 bg-muted/30 space-y-3">
                      <p className="text-xs font-medium text-muted-foreground">Einstellungen</p>
                      <div className="space-y-1">
                        <Label className="text-xs">Modus</Label>
                        <Select
                          value={editModus}
                          onValueChange={(v) => {
                            const m = v as "monatlich" | "jaehrlich";
                            setEditModus(m);
                            if (m === "jaehrlich") {
                              if (!editJahresKontingent) setEditJahresKontingent("25");
                              // Stichtag vorbelegen: nächster künftiger Jahrestag von heute
                              if (balance.modus !== "jaehrlich" || !balance.next_credit_date) {
                                setEditNextCreditDate(defaultStichtag());
                              }
                            } else {
                              setEditNextCreditDate(balance.modus === "monatlich" ? (balance.next_credit_date || "") : "");
                            }
                          }}
                        >
                          <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="monatlich">Arbeiter — monatliche Gutschrift</SelectItem>
                            <SelectItem value="jaehrlich">Angestellter — Jahres-Kontingent am Stichtag</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      {editModus === "jaehrlich" ? (
                        <>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div className="space-y-1">
                              <Label className="text-xs">Jahres-Kontingent (Tage)</Label>
                              <Input type="number" step="0.5" min="1" value={editJahresKontingent} onChange={(e) => setEditJahresKontingent(e.target.value)} className="h-9" />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">Stichtag (jährliche Gutschrift)</Label>
                              <Input type="date" value={editNextCreditDate} onChange={(e) => setEditNextCreditDate(e.target.value)} className="h-9" />
                            </div>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Am Stichtag wird das Kontingent gutgeschrieben, danach automatisch jedes Jahr
                            wieder. Liegt der Stichtag in der Vergangenheit, wird beim nächsten Öffnen sofort
                            gutgeschrieben. Der aktuelle Tage-Stand bleibt bei der Umstellung unverändert
                            („Tage ändern" für Korrekturen).
                          </p>
                        </>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <Label className="text-xs">Tage pro Monat</Label>
                            <Input type="number" step="0.01" value={editDaysPerMonth} onChange={(e) => setEditDaysPerMonth(e.target.value)} className="h-9" />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Nächste Gutschrift am</Label>
                            <Input type="date" value={editNextCreditDate} onChange={(e) => setEditNextCreditDate(e.target.value)} className="h-9" />
                          </div>
                        </div>
                      )}
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => saveSettings(balance.id, profile.id)}>Speichern</Button>
                        <Button variant="outline" size="sm" onClick={() => setEditingSettings(null)}>Abbrechen</Button>
                      </div>
                    </div>
                  )}

                  {/* Expanded: Verlauf */}
                  {isExpanded && balance && (
                    <div className="border-t px-3 pb-3 pt-2">
                      <p className="text-xs font-medium text-muted-foreground mb-2">Urlaubsverlauf</p>
                      <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
                        {/* Log entries */}
                        {userLog.map((log) => (
                          <div key={log.id} className="flex items-start gap-2 text-xs">
                            <span className="text-muted-foreground shrink-0">{format(new Date(log.created_at), "dd.MM.yyyy HH:mm")}</span>
                            <span className={["gutschrift", "jahres_gutschrift", "uebertrag"].includes(log.action) ? "text-green-600" : ""}>
                              {log.description}
                              {log.days != null && ["gutschrift", "jahres_gutschrift", "uebertrag"].includes(log.action) && <Badge variant="secondary" className="ml-1 text-[10px]">+{Math.round(log.days)}</Badge>}
                            </span>
                          </div>
                        ))}
                        {/* Vacation entries */}
                        {(() => {
                          const groups: Record<string, { dates: string[]; createdAt: string }> = {};
                          for (const v of userVacEntries) {
                            const key = v.created_at ? v.created_at.slice(0, 16) : v.datum;
                            if (!groups[key]) groups[key] = { dates: [], createdAt: v.created_at || v.datum };
                            groups[key].dates.push(v.datum);
                          }
                          return Object.values(groups)
                            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                            .map((group, i) => {
                              const sortedDates = group.dates.sort();
                              const firstDate = sortedDates[0];
                              const lastDate = sortedDates[sortedDates.length - 1];
                              const days = sortedDates.length;
                              const dateRange = days === 1
                                ? format(new Date(firstDate), "dd.MM.yyyy", { locale: de })
                                : `${format(new Date(firstDate), "dd.MM.", { locale: de })} - ${format(new Date(lastDate), "dd.MM.yyyy", { locale: de })}`;
                              return (
                                <div key={`vac-${i}`} className="flex items-start gap-2 text-xs">
                                  <span className="text-muted-foreground shrink-0">{format(new Date(group.createdAt), "dd.MM.yyyy HH:mm")}</span>
                                  <span className="text-orange-600">Urlaub: <strong>-{days} {days === 1 ? "Tag" : "Tage"}</strong> ({dateRange})</span>
                                </div>
                              );
                            });
                        })()}
                        {userLog.length === 0 && userVacEntries.length === 0 && (
                          <p className="text-xs text-muted-foreground">Noch keine Einträge</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
