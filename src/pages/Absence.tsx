import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Calendar, Upload, Trash2, Sun, Thermometer, BookOpen, Clock, GraduationCap, PartyPopper, PenLine } from "lucide-react";
import { getTargetHoursForDate } from "@/lib/workingHours";

const ABSENCE_TYPES = [
  { value: "urlaub", label: "Urlaub", icon: Sun, color: "text-green-600" },
  { value: "krankenstand", label: "Krankenstand", icon: Thermometer, color: "text-red-600" },
  { value: "zeitausgleich", label: "Zeitausgleich", icon: Clock, color: "text-purple-600" },
  { value: "fortbildung", label: "Fortbildung", icon: BookOpen, color: "text-blue-600" },
  { value: "feiertag", label: "Feiertag", icon: PartyPopper, color: "text-orange-600" },
  { value: "schule", label: "Berufsschule", icon: GraduationCap, color: "text-cyan-600" },
  { value: "sonstiges", label: "Eigener Grund", icon: PenLine, color: "text-gray-600" },
] as const;

type AbsenceType = (typeof ABSENCE_TYPES)[number]["value"];

type ExistingAbsence = {
  id: string;
  datum: string;
  taetigkeit: string;
  stunden: number;
};

function countWorkingDays(start: string, end: string): number {
  let count = 0;
  const d = new Date(start + "T00:00:00");
  const endD = new Date(end + "T00:00:00");
  while (d <= endD) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

function capitalizeType(type: AbsenceType, customReason?: string): string {
  switch (type) {
    case "urlaub": return "Urlaub";
    case "krankenstand": return "Krankenstand";
    case "zeitausgleich": return "ZA";
    case "fortbildung": return "Fortbildung";
    case "feiertag": return "Feiertag";
    case "schule": return "Schule";
    case "sonstiges": return customReason || "Sonstiges";
    default: return type;
  }
}

export default function Absence() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [absenceType, setAbsenceType] = useState<AbsenceType>("urlaub");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [notizen, setNotizen] = useState("");
  const [saving, setSaving] = useState(false);
  const [krankmeldungFile, setKrankmeldungFile] = useState<File | null>(null);
  const [leaveBalance, setLeaveBalance] = useState<{ total_days: number; used_days: number } | null>(null);
  const [existingAbsences, setExistingAbsences] = useState<ExistingAbsence[]>([]);
  const [currentUserId, setCurrentUserId] = useState("");
  const [weeklyHours, setWeeklyHours] = useState<number | null>(null); // null = standard 39h
  const [zaMode, setZaMode] = useState<"ganztag" | "teilzeit">("ganztag");
  const [zaStunden, setZaStunden] = useState("");
  const [zeitkontoBalance, setZeitkontoBalance] = useState(0);
  const [customAbsenceReason, setCustomAbsenceReason] = useState("");

  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        navigate("/auth");
        return;
      }
      setCurrentUserId(user.id);
      // Load employee weekly hours
      const { data: empData } = await supabase
        .from("employees")
        .select("monats_soll_stunden")
        .eq("user_id", user.id)
        .maybeSingle();
      if (empData?.monats_soll_stunden) {
        setWeeklyHours(empData.monats_soll_stunden);
      }
      // Load Zeitkonto balance
      const { data: zaData } = await supabase
        .from("time_accounts")
        .select("balance_hours")
        .eq("user_id", user.id)
        .maybeSingle();
      if (zaData) setZeitkontoBalance(zaData.balance_hours || 0);

      await Promise.all([
        loadLeaveBalance(user.id),
        loadExistingAbsences(user.id),
      ]);
    };
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate]);

  const loadLeaveBalance = async (userId: string) => {
    const currentYear = new Date().getFullYear();
    const { data } = await supabase
      .from("leave_balances")
      .select("total_days, used_days")
      .eq("user_id", userId)
      .eq("year", currentYear)
      .maybeSingle();
    if (data) {
      setLeaveBalance(data);
    }
  };

  const loadExistingAbsences = async (userId: string) => {
    const now = new Date();
    const startOfMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const endStr = `${endOfMonth.getFullYear()}-${String(endOfMonth.getMonth() + 1).padStart(2, "0")}-${String(endOfMonth.getDate()).padStart(2, "0")}`;

    const { data } = await supabase
      .from("time_entries")
      .select("id, datum, taetigkeit, stunden")
      .eq("user_id", userId)
      .gte("datum", startOfMonth)
      .lte("datum", endStr)
      .not("taetigkeit", "like", "Rüstzeit%")
      .not("taetigkeit", "eq", "Arbeit")
      .order("datum", { ascending: false });

    if (data) {
      setExistingAbsences(data);
    }
  };

  const workingDays = startDate && endDate ? countWorkingDays(startDate, endDate) : 0;

  const handleSubmit = async () => {
    if (!startDate || !endDate) {
      toast({ title: "Bitte Von- und Bis-Datum angeben", variant: "destructive" });
      return;
    }
    if (startDate > endDate) {
      toast({ title: "Das Von-Datum muss vor dem Bis-Datum liegen", variant: "destructive" });
      return;
    }
    if (absenceType === "sonstiges" && !customAbsenceReason.trim()) {
      toast({ title: "Bitte einen Grund eingeben", variant: "destructive" });
      return;
    }
    if (workingDays === 0) {
      toast({ title: "Keine Arbeitstage im gewaehlten Zeitraum", variant: "destructive" });
      return;
    }

    if (absenceType === "urlaub" && leaveBalance) {
      const remaining = leaveBalance.total_days - leaveBalance.used_days;
      if (workingDays > remaining) {
        toast({
          title: "Nicht genügend Urlaubstage",
          description: `Verfügbar: ${remaining} Tage, angefragt: ${workingDays} Tage`,
          variant: "destructive",
        });
        return;
      }
    }

    // Check for existing entries in the date range
    const { data: existingEntries } = await supabase
      .from("time_entries")
      .select("id, datum, taetigkeit, entry_typ")
      .eq("user_id", currentUserId)
      .gte("datum", startDate)
      .lte("datum", endDate);

    // Separate PL-Arbeitszeit (entry_typ='projektleiter') von anderen Einträgen:
    // PL-Einträge werden automatisch überschrieben (Absenz hat Vorrang vor PL-Arbeitszeit).
    // Andere Einträge (Mitarbeiter-Leistungsbericht, bestehende Absenzen) blockieren.
    const blockingEntries = (existingEntries || []).filter(
      (e: any) => e.entry_typ !== "projektleiter"
    );
    const plEntriesToReplace = (existingEntries || []).filter(
      (e: any) => e.entry_typ === "projektleiter"
    );

    if (blockingEntries.length > 0) {
      const conflictDates = blockingEntries.map((e: any) => {
        const d = new Date(e.datum + "T00:00:00");
        return `${d.toLocaleDateString("de-AT")} (${e.taetigkeit})`;
      });
      toast({
        title: "Es sind bereits Einträge vorhanden",
        description: `Folgende Tage haben schon Einträge:\n${conflictDates.join(", ")}`,
        variant: "destructive",
      });
      return;
    }

    // Auto-delete PL work entries that will be replaced by absence
    if (plEntriesToReplace.length > 0) {
      const ids = plEntriesToReplace.map((e: any) => e.id);
      const { error: delErr } = await supabase
        .from("time_entries")
        .delete()
        .in("id", ids);
      if (delErr) {
        toast({ variant: "destructive", title: "Fehler", description: delErr.message });
        return;
      }
      toast({
        title: "PL-Arbeitszeit überschrieben",
        description: `${plEntriesToReplace.length} Projektleiter-Eintrag/Einträge wurden durch Absenz ersetzt.`,
      });
    }

    setSaving(true);
    try {
      // Build entries for each working day
      const entries: any[] = [];
      let totalZaHours = 0;
      const d = new Date(startDate + "T00:00:00");
      const endD = new Date(endDate + "T00:00:00");
      while (d <= endD) {
        const day = d.getDay();
        if (day !== 0 && day !== 6) {
          const standardTarget = getTargetHoursForDate(d); // 8h Mo-Do, 7h Fr
          const targetHours = weeklyHours != null
            ? Math.round((weeklyHours / 39) * standardTarget * 10) / 10
            : standardTarget;
          const isFriday = day === 5;
          const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

          // ZA Teilzeit: Manuelle Stunden, nur 1 Tag
          let hoursForDay = targetHours;
          if (absenceType === "zeitausgleich" && zaMode === "teilzeit" && zaStunden) {
            hoursForDay = parseFloat(zaStunden.replace(",", ".")) || targetHours;
          }

          if (absenceType === "zeitausgleich") {
            totalZaHours += hoursForDay;
          }

          entries.push({
            user_id: currentUserId,
            datum: dateStr,
            taetigkeit: capitalizeType(absenceType, customAbsenceReason),
            stunden: hoursForDay,
            start_time: "07:00",
            end_time: isFriday ? "14:00" : "15:00",
            pause_minutes: 0,
            project_id: null,
            location_type: null,
          });
        }
        d.setDate(d.getDate() + 1);
      }

      const { error: insertError } = await supabase.from("time_entries").insert(entries);
      if (insertError) throw insertError;

      // ZA: Stunden vom Zeitkonto abziehen + Transaktion loggen
      if (absenceType === "zeitausgleich" && totalZaHours > 0) {
        const { data: account } = await supabase
          .from("time_accounts")
          .select("id, balance_hours")
          .eq("user_id", currentUserId)
          .maybeSingle();
        if (account) {
          const newBalance = (account.balance_hours || 0) - totalZaHours;
          await supabase.from("time_accounts")
            .update({ balance_hours: newBalance })
            .eq("id", account.id);
          await supabase.from("time_account_transactions").insert({
            user_id: currentUserId,
            changed_by: currentUserId,
            change_type: "ZA genommen",
            hours: -totalZaHours,
            balance_before: account.balance_hours || 0,
            balance_after: newBalance,
            reason: `Zeitausgleich: ${totalZaHours}h (${startDate}${startDate !== endDate ? ` bis ${endDate}` : ""})`,
          });
          setZeitkontoBalance(newBalance);
        }
      }

      // Update leave balance for urlaub
      if (absenceType === "urlaub") {
        const currentYear = new Date().getFullYear();
        if (leaveBalance) {
          await supabase
            .from("leave_balances")
            .update({ used_days: leaveBalance.used_days + workingDays })
            .eq("user_id", currentUserId)
            .eq("year", currentYear);
        } else {
          await supabase
            .from("leave_balances")
            .upsert({
              user_id: currentUserId,
              year: currentYear,
              total_days: 25,
              used_days: workingDays,
            });
        }
      }

      // Upload Krankmeldung if applicable
      if (absenceType === "krankenstand" && krankmeldungFile) {
        const safeName = krankmeldungFile.name
          .replace(/[äÄ]/g, "ae").replace(/[öÖ]/g, "oe").replace(/[üÜ]/g, "ue").replace(/ß/g, "ss")
          .replace(/[^a-zA-Z0-9._-]/g, "_");
        const timestamp = Date.now();
        const filePath = `${currentUserId}/krankmeldung/${timestamp}_${safeName}`;
        await supabase.storage
          .from("employee-documents")
          .upload(filePath, krankmeldungFile);

        // Link file to time_entries so Admin "Neue Krankmeldungen" can find it
        await supabase
          .from("time_entries")
          .update({ notizen: `Krankmeldung: ${filePath}` })
          .eq("user_id", currentUserId)
          .eq("taetigkeit", "Krankenstand")
          .gte("datum", startDate)
          .lte("datum", endDate);

        // Get user name for notification
        const { data: profile } = await supabase
          .from("profiles")
          .select("vorname, nachname")
          .eq("id", currentUserId)
          .maybeSingle();

        const userName = profile ? `${profile.vorname} ${profile.nachname}`.trim() : "Ein Mitarbeiter";

        // Notify all admins
        const { data: adminRoles } = await supabase
          .from("user_roles")
          .select("user_id")
          .eq("role", "administrator");

        if (adminRoles && adminRoles.length > 0) {
          const notifications = adminRoles.map((ar) => ({
            user_id: ar.user_id,
            type: "krankmeldung_upload",
            title: "Krankmeldung hochgeladen",
            message: `${userName} hat eine Krankmeldung hochgeladen`,
          }));
          await supabase.from("notifications").insert(notifications);
        }
      }

      toast({ title: "Abwesenheit eingetragen" });
      setStartDate("");
      setEndDate("");
      setNotizen("");
      setKrankmeldungFile(null);
      await Promise.all([
        loadLeaveBalance(currentUserId),
        loadExistingAbsences(currentUserId),
      ]);
    } catch (err: any) {
      toast({ title: "Fehler beim Speichern", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (absence: ExistingAbsence) => {
    try {
      const { error } = await supabase
        .from("time_entries")
        .delete()
        .eq("id", absence.id)
        .eq("user_id", currentUserId);
      if (error) throw error;

      if (absence.taetigkeit === "Urlaub" && leaveBalance) {
        const currentYear = new Date().getFullYear();
        await supabase
          .from("leave_balances")
          .update({ used_days: Math.max(0, leaveBalance.used_days - 1) })
          .eq("user_id", currentUserId)
          .eq("year", currentYear);
      }

      toast({ title: "Eintrag geloescht" });
      await Promise.all([
        loadLeaveBalance(currentUserId),
        loadExistingAbsences(currentUserId),
      ]);
    } catch (err: any) {
      toast({ title: "Fehler beim Loeschen", description: err.message, variant: "destructive" });
    }
  };

  const today = new Date().toISOString().split("T")[0];

  return (
    <div className="min-h-screen bg-background">
      <PageHeader title="Abwesenheit melden" />

      <main className="container mx-auto px-3 sm:px-4 lg:px-6 py-4 sm:py-6 lg:py-8 space-y-6">
        {/* Absence Form */}
        <Card>
          <CardHeader>
            <CardTitle>Neue Abwesenheit</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Absence Type Selection */}
            <div className="space-y-2">
              <Label>Art der Abwesenheit</Label>
              <RadioGroup
                value={absenceType}
                onValueChange={(v) => setAbsenceType(v as AbsenceType)}
                className="grid grid-cols-2 sm:grid-cols-3 gap-2"
              >
                {ABSENCE_TYPES.map((type) => {
                  const Icon = type.icon;
                  return (
                    <Label
                      key={type.value}
                      htmlFor={`type-${type.value}`}
                      className={`flex items-center gap-2 rounded-lg border p-3 cursor-pointer transition-all ${
                        absenceType === type.value
                          ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                          : "border-border hover:border-primary/30"
                      }`}
                    >
                      <RadioGroupItem value={type.value} id={`type-${type.value}`} className="sr-only" />
                      <Icon className={`h-5 w-5 ${type.color} shrink-0`} />
                      <span className="text-sm font-medium">{type.label}</span>
                    </Label>
                  );
                })}
              </RadioGroup>
            </div>

            {/* Date Range */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="startDate">Von</Label>
                <Input
                  id="startDate"
                  type="date"
                  value={startDate}
                  onChange={(e) => {
                    setStartDate(e.target.value);
                    if (!endDate || e.target.value > endDate) {
                      setEndDate(e.target.value);
                    }
                  }}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="endDate">Bis</Label>
                <Input
                  id="endDate"
                  type="date"
                  value={endDate}
                  min={startDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
            </div>

            {/* Working Days Badge */}
            {startDate && endDate && (
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <Badge variant="secondary" className="text-sm">
                  = {workingDays} Arbeitstage
                </Badge>
              </div>
            )}

            {/* Leave Balance Info (urlaub only) */}
            {absenceType === "urlaub" && (
              <Card className="bg-green-50 border-green-200">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Sun className="h-5 w-5 text-green-600" />
                    <span className="font-semibold text-green-800">Urlaubskonto</span>
                  </div>
                  {leaveBalance ? (
                    <div className="grid grid-cols-3 gap-2 text-sm">
                      <div>
                        <p className="text-muted-foreground">Gesamt</p>
                        <p className="font-bold">{leaveBalance.total_days} Tage</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Verbraucht</p>
                        <p className="font-bold">{leaveBalance.used_days} Tage</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Verfuegbar</p>
                        <p className="font-bold text-green-700">
                          {leaveBalance.total_days - leaveBalance.used_days - (workingDays || 0)} Tage
                        </p>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Noch kein Urlaubskonto vorhanden (Standard: 25 Tage)
                    </p>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Zeitausgleich Options */}
            {absenceType === "zeitausgleich" && (
              <Card className="bg-purple-50 border-purple-200">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Clock className="h-5 w-5 text-purple-600" />
                    <span className="font-semibold text-purple-800">Zeitkonto</span>
                    <Badge variant="outline" className="ml-auto text-purple-700 border-purple-300">
                      {zeitkontoBalance >= 0 ? "+" : ""}{zeitkontoBalance.toFixed(1)}h
                    </Badge>
                  </div>
                  <RadioGroup value={zaMode} onValueChange={(v) => setZaMode(v as "ganztag" | "teilzeit")} className="space-y-2">
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="ganztag" id="za-ganztag" />
                      <Label htmlFor="za-ganztag" className="text-sm">
                        Ganzer Tag ({startDate ? (() => {
                          const dow = new Date(startDate + "T00:00:00").getDay();
                          const std = getTargetHoursForDate(new Date(startDate + "T00:00:00"));
                          const target = weeklyHours != null ? Math.round((weeklyHours / 39) * std * 10) / 10 : std;
                          return `${target}h`;
                        })() : "8h"} werden abgezogen)
                      </Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="teilzeit" id="za-teilzeit" />
                      <Label htmlFor="za-teilzeit" className="text-sm">Bestimmte Stunden</Label>
                    </div>
                  </RadioGroup>
                  {zaMode === "teilzeit" && (
                    <div className="flex items-center gap-2">
                      <Input
                        type="text"
                        inputMode="decimal"
                        placeholder="z.B. 4"
                        value={zaStunden}
                        onChange={(e) => setZaStunden(e.target.value)}
                        className="w-24"
                      />
                      <span className="text-sm text-muted-foreground">Stunden ZA</span>
                    </div>
                  )}
                  {startDate && (
                    <p className="text-xs text-purple-600">
                      {zaMode === "ganztag"
                        ? `Es werden ${workingDays > 1 ? `${workingDays} Tage` : "1 Tag"} ZA vom Zeitkonto abgezogen`
                        : zaStunden
                          ? `${parseFloat(zaStunden.replace(",", ".")) || 0}h werden vom Zeitkonto abgezogen`
                          : "Bitte Stunden eingeben"}
                    </p>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Eigener Grund (sonstiges only) */}
            {absenceType === "sonstiges" && (
              <div className="space-y-2">
                <Label htmlFor="custom-reason">Grund eingeben</Label>
                <Input
                  id="custom-reason"
                  value={customAbsenceReason}
                  onChange={(e) => setCustomAbsenceReason(e.target.value)}
                  placeholder="z.B. Behördengang, Umzug, ..."
                />
              </div>
            )}

            {/* Krankmeldung Upload (krankenstand only) */}
            {absenceType === "krankenstand" && (
              <div className="space-y-2">
                <Label>Krankmeldung hochladen (optional, gilt für den gesamten Zeitraum)</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="file"
                    accept="image/*,.pdf"
                    capture="environment"
                    onChange={(e) => setKrankmeldungFile(e.target.files?.[0] || null)}
                    className="flex-1"
                  />
                  <Upload className="h-5 w-5 text-muted-foreground shrink-0" />
                </div>
                {krankmeldungFile && (
                  <p className="text-sm text-muted-foreground">{krankmeldungFile.name}</p>
                )}
              </div>
            )}

            {/* Notes */}
            <div className="space-y-2">
              <Label htmlFor="notizen">Notizen (optional)</Label>
              <Textarea
                id="notizen"
                placeholder="Zusaetzliche Informationen..."
                value={notizen}
                onChange={(e) => setNotizen(e.target.value)}
                rows={3}
              />
            </div>

            {/* Submit */}
            <Button
              className="w-full"
              onClick={handleSubmit}
              disabled={saving || !startDate || !endDate}
            >
              {saving ? "Wird gespeichert..." : "Abwesenheit eintragen"}
            </Button>
          </CardContent>
        </Card>

        {/* Existing Absences */}
        <Card>
          <CardHeader>
            <CardTitle>Meine Abwesenheiten</CardTitle>
          </CardHeader>
          <CardContent>
            {existingAbsences.length === 0 ? (
              <p className="text-sm text-muted-foreground">Keine Abwesenheiten in diesem Monat</p>
            ) : (
              <div className="space-y-2">
                {existingAbsences.map((absence) => {
                  const isFuture = absence.datum >= today;
                  const typeInfo = ABSENCE_TYPES.find(
                    (t) => capitalizeType(t.value) === absence.taetigkeit
                  );
                  return (
                    <div
                      key={absence.id}
                      className="flex items-center justify-between gap-3 rounded-lg border p-3"
                    >
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        {typeInfo && <typeInfo.icon className={`h-4 w-4 ${typeInfo.color} shrink-0`} />}
                        <div className="min-w-0">
                          <p className="font-medium text-sm">
                            {new Date(absence.datum + "T00:00:00").toLocaleDateString("de-DE", {
                              weekday: "short",
                              day: "2-digit",
                              month: "2-digit",
                              year: "numeric",
                            })}
                          </p>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-xs">
                              {absence.taetigkeit}
                            </Badge>
                            <span className="text-xs text-muted-foreground">{absence.stunden} h</span>
                          </div>
                        </div>
                      </div>
                      {isFuture && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="shrink-0 h-8 w-8 p-0 text-destructive hover:text-destructive"
                          onClick={() => handleDelete(absence)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
