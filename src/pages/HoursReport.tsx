import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import ProjectHoursReport from "@/components/ProjectHoursReport";
import { FileSpreadsheet, Building2, ClipboardList, Loader2 } from "lucide-react";
import { format, parseISO } from "date-fns";
import { de } from "date-fns/locale";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Profile {
  id: string;
  vorname: string;
  nachname: string;
}

interface TimeEntry {
  user_id: string;
  datum: string;
  stunden: number;
  taetigkeit: string;
  location_type: string;
}

interface BerichtMitarbeiterRow {
  mitarbeiter_id: string;
  ist_fahrer: boolean;
  ist_werkstatt: boolean;
  schmutzzulage: boolean;
  regen_schicht: boolean;
  fahrer_stunden: number | null;
  werkstatt_stunden: number | null;
  schmutzzulage_stunden: number | null;
  regen_stunden: number | null;
  summe_stunden: number;
  bericht_id: string;
  bericht_datum: string;
}

interface DayData {
  stunden: number;
  istFahrer: boolean;
  istWerkstatt: boolean;
  schmutzzulage: boolean;
  regenSchicht: boolean;
  fahrerStunden: number | null;
  werkstattStunden: number | null;
  schmutzzulageStunden: number | null;
  regenStunden: number | null;
  isAbsence: boolean;
  absenceType: string;
}

interface ExistingBericht {
  id: string;
  datum: string;
  objekt: string | null;
  projekt_name: string;
  ersteller_name: string;
  mitarbeiter_count: number;
  total_stunden: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const monthNames = [
  "Jaenner",
  "Feber",
  "Maerz",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
];

const weekdayAbbr = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

const ABSENCE_TYPES = [
  "Urlaub",
  "Krankenstand",
  "Zeitausgleich",
  "Berufsschule",
  "Feiertag",
  "Weiterbildung",
];

const ABSENCE_SHORT: Record<string, string> = {
  Urlaub: "U",
  Krankenstand: "K",
  Zeitausgleich: "ZA",
  Berufsschule: "Schule",
  Feiertag: "Feiertag",
  Weiterbildung: "WB",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function isWeekend(year: number, month: number, day: number): boolean {
  const dow = new Date(year, month - 1, day).getDay();
  return dow === 0 || dow === 6;
}

function getWeekday(year: number, month: number, day: number): string {
  return weekdayAbbr[new Date(year, month - 1, day).getDay()];
}

/** Count working days (Mo-Fr) in a given month */
function countWorkingDays(year: number, month: number): number {
  const days = getDaysInMonth(year, month);
  let count = 0;
  for (let d = 1; d <= days; d++) {
    if (!isWeekend(year, month, d)) count++;
  }
  return count;
}

function formatNumber(n: number): string {
  if (n === Math.floor(n)) return n.toString();
  // Show one decimal, remove trailing zero
  const s = n.toFixed(1);
  return s.endsWith("0") ? n.toString() : s;
}

function formatCell(dayData: DayData | null): { text: string; className: string } {
  if (!dayData) return { text: "", className: "" };

  if (dayData.isAbsence) {
    const short = ABSENCE_SHORT[dayData.absenceType] || dayData.absenceType;
    if (dayData.absenceType === "Urlaub") return { text: short, className: "text-green-600 font-semibold" };
    if (dayData.absenceType === "Krankenstand") return { text: short, className: "text-red-600 font-semibold" };
    if (dayData.absenceType === "Zeitausgleich") return { text: short, className: "text-blue-600 font-semibold" };
    return { text: short, className: "text-gray-600" };
  }

  const h = dayData.stunden;
  if (h === 0) return { text: "", className: "" };

  const parts: string[] = [];

  // Split hours logic: if specific hour amounts are given, show them
  if (dayData.fahrerStunden !== null && dayData.fahrerStunden > 0) {
    parts.push(`${formatNumber(dayData.fahrerStunden)}F`);
  } else if (dayData.istFahrer) {
    parts.push(`${formatNumber(h)}F`);
  }

  if (dayData.werkstattStunden !== null && dayData.werkstattStunden > 0) {
    parts.push(`${formatNumber(dayData.werkstattStunden)}W`);
  } else if (dayData.istWerkstatt && !dayData.istFahrer) {
    parts.push(`${formatNumber(h)}W`);
  }

  if (dayData.schmutzzulageStunden !== null && dayData.schmutzzulageStunden > 0) {
    parts.push(`${formatNumber(dayData.schmutzzulageStunden)}SCH`);
  } else if (dayData.schmutzzulage && parts.length === 0) {
    parts.push(`${formatNumber(h)}SCH`);
  }

  if (dayData.regenStunden !== null && dayData.regenStunden > 0) {
    parts.push(`${formatNumber(dayData.regenStunden)}R`);
  } else if (dayData.regenSchicht && parts.length === 0) {
    parts.push(`${formatNumber(h)}R`);
  }

  if (parts.length === 0) {
    parts.push(formatNumber(h));
  }

  return { text: parts.join(""), className: "" };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function HoursReport() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();

  // Admin check
  const [isAdmin, setIsAdmin] = useState(false);
  const [checkingAdmin, setCheckingAdmin] = useState(true);

  // Shared data
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profileMap, setProfileMap] = useState<Record<string, Profile>>({});

  // Tab 1: Arbeitszeiterfassung state
  const [gridMonth, setGridMonth] = useState(() => {
    const p = searchParams.get("month");
    return p ? parseInt(p) : new Date().getMonth() + 1;
  });
  const [gridYear, setGridYear] = useState(() => {
    const p = searchParams.get("year");
    return p ? parseInt(p) : new Date().getFullYear();
  });
  const [gridEmployee, setGridEmployee] = useState<string>("all");
  const [gridEntries, setGridEntries] = useState<TimeEntry[]>([]);
  const [gridBerichtData, setGridBerichtData] = useState<BerichtMitarbeiterRow[]>([]);
  const [gridLoading, setGridLoading] = useState(false);

  // Tab 2: Leistungsberichte state
  const [berichte, setBerichte] = useState<ExistingBericht[]>([]);
  const [berichteLoading, setBerichteLoading] = useState(false);
  const [berichteStartDate, setBerichteStartDate] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
  });
  const [berichteEndDate, setBerichteEndDate] = useState(
    () => new Date().toISOString().split("T")[0]
  );
  const [berichteVorarbeiter, setBerichteVorarbeiter] = useState("all");
  const [berichteMitarbeiter, setBerichteMitarbeiter] = useState("all");
  const [berichteProjekt, setBerichteProjekt] = useState("all");
  const [berichteProjects, setBerichteProjects] = useState<{ id: string; name: string }[]>([]);

  const years = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i);

  // -------------------------------------------------------------------------
  // Init
  // -------------------------------------------------------------------------

  useEffect(() => {
    checkAdminStatus();
    fetchProfiles();
  }, []);

  const checkAdminStatus = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      navigate("/");
      return;
    }
    const { data } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .single();

    if (data?.role !== "administrator") {
      navigate("/");
      return;
    }
    setIsAdmin(true);
    setCheckingAdmin(false);
  };

  const fetchProfiles = async () => {
    const { data } = await supabase
      .from("profiles")
      .select("id, vorname, nachname")
      .eq("is_active", true)
      .order("nachname");
    if (data) {
      setProfiles(data);
      const map: Record<string, Profile> = {};
      data.forEach((p) => {
        map[p.id] = p;
      });
      setProfileMap(map);
    }
  };

  // -------------------------------------------------------------------------
  // Tab 1: Arbeitszeiterfassung data
  // -------------------------------------------------------------------------

  const fetchGridData = useCallback(async () => {
    setGridLoading(true);
    const startOfMonth = `${gridYear}-${String(gridMonth).padStart(2, "0")}-01`;
    const daysInMonth = getDaysInMonth(gridYear, gridMonth);
    const endOfMonth = `${gridYear}-${String(gridMonth).padStart(2, "0")}-${String(daysInMonth).padStart(2, "0")}`;

    // Fetch time entries
    let entriesQuery = supabase
      .from("time_entries")
      .select("user_id, datum, stunden, taetigkeit, location_type")
      .gte("datum", startOfMonth)
      .lte("datum", endOfMonth);

    if (gridEmployee !== "all") {
      entriesQuery = entriesQuery.eq("user_id", gridEmployee);
    }

    const { data: entries } = await entriesQuery;
    setGridEntries(entries || []);

    // Fetch leistungsbericht_mitarbeiter flags via join
    let bmQuery = supabase
      .from("leistungsbericht_mitarbeiter" as any)
      .select(
        "mitarbeiter_id, ist_fahrer, ist_werkstatt, schmutzzulage, regen_schicht, fahrer_stunden, werkstatt_stunden, schmutzzulage_stunden, regen_stunden, summe_stunden, bericht_id, leistungsberichte!inner(datum)"
      )
      .gte("leistungsberichte.datum" as any, startOfMonth)
      .lte("leistungsberichte.datum" as any, endOfMonth);

    if (gridEmployee !== "all") {
      bmQuery = bmQuery.eq("mitarbeiter_id", gridEmployee);
    }

    const { data: bmData } = await bmQuery;

    const transformed: BerichtMitarbeiterRow[] = (bmData || []).map((row: any) => ({
      mitarbeiter_id: row.mitarbeiter_id,
      ist_fahrer: row.ist_fahrer || false,
      ist_werkstatt: row.ist_werkstatt || false,
      schmutzzulage: row.schmutzzulage || false,
      regen_schicht: row.regen_schicht || false,
      fahrer_stunden: row.fahrer_stunden,
      werkstatt_stunden: row.werkstatt_stunden,
      schmutzzulage_stunden: row.schmutzzulage_stunden,
      regen_stunden: row.regen_stunden,
      summe_stunden: row.summe_stunden || 0,
      bericht_id: row.bericht_id,
      bericht_datum: row.leistungsberichte?.datum || "",
    }));

    setGridBerichtData(transformed);
    setGridLoading(false);
  }, [gridMonth, gridYear, gridEmployee]);

  useEffect(() => {
    if (isAdmin) fetchGridData();
  }, [isAdmin, fetchGridData]);

  // Build grid data: userId -> day -> DayData
  const gridDataMap = useMemo(() => {
    const map: Record<string, Record<number, DayData>> = {};

    // First pass: time_entries (for hours and absence types)
    for (const entry of gridEntries) {
      if (!map[entry.user_id]) map[entry.user_id] = {};
      const day = parseInt(entry.datum.split("-")[2], 10);

      const isAbsence = ABSENCE_TYPES.includes(entry.taetigkeit);

      if (isAbsence) {
        map[entry.user_id][day] = {
          stunden: entry.stunden,
          istFahrer: false,
          istWerkstatt: false,
          schmutzzulage: false,
          regenSchicht: false,
          fahrerStunden: null,
          werkstattStunden: null,
          schmutzzulageStunden: null,
          regenStunden: null,
          isAbsence: true,
          absenceType: entry.taetigkeit,
        };
      } else {
        const existing = map[entry.user_id][day];
        if (existing && !existing.isAbsence) {
          // Aggregate hours for the same day
          existing.stunden += entry.stunden;
        } else if (!existing) {
          map[entry.user_id][day] = {
            stunden: entry.stunden,
            istFahrer: false,
            istWerkstatt: false,
            schmutzzulage: false,
            regenSchicht: false,
            fahrerStunden: null,
            werkstattStunden: null,
            schmutzzulageStunden: null,
            regenStunden: null,
            isAbsence: false,
            absenceType: "",
          };
        }
      }
    }

    // Second pass: overlay leistungsbericht_mitarbeiter flags
    for (const bm of gridBerichtData) {
      const uid = bm.mitarbeiter_id;
      const day = parseInt(bm.bericht_datum.split("-")[2], 10);
      if (!map[uid]) map[uid] = {};

      if (map[uid][day] && !map[uid][day].isAbsence) {
        // Overlay flags from bericht onto existing time entry data
        const d = map[uid][day];
        d.istFahrer = d.istFahrer || bm.ist_fahrer;
        d.istWerkstatt = d.istWerkstatt || bm.ist_werkstatt;
        d.schmutzzulage = d.schmutzzulage || bm.schmutzzulage;
        d.regenSchicht = d.regenSchicht || bm.regen_schicht;
        if (bm.fahrer_stunden !== null) d.fahrerStunden = bm.fahrer_stunden;
        if (bm.werkstatt_stunden !== null) d.werkstattStunden = bm.werkstatt_stunden;
        if (bm.schmutzzulage_stunden !== null) d.schmutzzulageStunden = bm.schmutzzulage_stunden;
        if (bm.regen_stunden !== null) d.regenStunden = bm.regen_stunden;
      } else if (!map[uid][day]) {
        // Bericht exists but no time_entry - use bericht summe_stunden
        map[uid][day] = {
          stunden: bm.summe_stunden,
          istFahrer: bm.ist_fahrer,
          istWerkstatt: bm.ist_werkstatt,
          schmutzzulage: bm.schmutzzulage,
          regenSchicht: bm.regen_schicht,
          fahrerStunden: bm.fahrer_stunden,
          werkstattStunden: bm.werkstatt_stunden,
          schmutzzulageStunden: bm.schmutzzulage_stunden,
          regenStunden: bm.regen_stunden,
          isAbsence: false,
          absenceType: "",
        };
      }
    }

    return map;
  }, [gridEntries, gridBerichtData]);

  // Determine which employees to show
  const gridEmployees = useMemo(() => {
    if (gridEmployee !== "all") {
      const p = profileMap[gridEmployee];
      return p ? [p] : [];
    }
    return profiles;
  }, [gridEmployee, profiles, profileMap]);

  const daysInMonth = getDaysInMonth(gridYear, gridMonth);
  const workingDays = countWorkingDays(gridYear, gridMonth);

  // -------------------------------------------------------------------------
  // Tab 2: Leistungsberichte data
  // -------------------------------------------------------------------------

  const fetchBerichte = useCallback(async () => {
    setBerichteLoading(true);

    // Load projects for filter
    const { data: projectsData } = await supabase
      .from("projects")
      .select("id, name")
      .order("name");
    setBerichteProjects(projectsData || []);

    // Load berichte
    const { data, error } = await supabase
      .from("leistungsberichte" as any)
      .select(
        "id, datum, objekt, projekt_id, erstellt_von, projects:projekt_id(name)"
      )
      .gte("datum", berichteStartDate)
      .lte("datum", berichteEndDate)
      .order("datum", { ascending: false });

    if (error || !data) {
      console.error("Error loading berichte:", error);
      setBerichteLoading(false);
      return;
    }

    // Load mitarbeiter counts and total hours
    const berichtIds = data.map((b: any) => b.id);
    let mitarbeiterDataAll: any[] = [];
    if (berichtIds.length > 0) {
      const { data: md } = await supabase
        .from("leistungsbericht_mitarbeiter" as any)
        .select("bericht_id, mitarbeiter_id, summe_stunden")
        .in("bericht_id", berichtIds);
      mitarbeiterDataAll = md || [];
    }

    const result: ExistingBericht[] = data.map((b: any) => {
      const maRows = mitarbeiterDataAll.filter((m: any) => m.bericht_id === b.id);
      const erstellerProfile = profileMap[b.erstellt_von];
      return {
        id: b.id,
        datum: b.datum,
        objekt: b.objekt || null,
        projekt_name: b.projects?.name || "-",
        ersteller_name: erstellerProfile
          ? `${erstellerProfile.vorname} ${erstellerProfile.nachname}`
          : "-",
        mitarbeiter_count: maRows.length,
        total_stunden: maRows.reduce(
          (s: number, m: any) => s + (m.summe_stunden || 0),
          0
        ),
      };
    });

    setBerichte(result);
    setBerichteLoading(false);
  }, [berichteStartDate, berichteEndDate, profileMap]);

  useEffect(() => {
    if (isAdmin && Object.keys(profileMap).length > 0) fetchBerichte();
  }, [isAdmin, fetchBerichte, profileMap]);

  // Filter berichte
  const filteredBerichte = useMemo(() => {
    return berichte.filter((b) => {
      if (berichteVorarbeiter !== "all" && !b.ersteller_name.includes(
        profileMap[berichteVorarbeiter]
          ? `${profileMap[berichteVorarbeiter].vorname} ${profileMap[berichteVorarbeiter].nachname}`
          : ""
      )) return false;
      if (berichteProjekt !== "all" && b.projekt_name !== berichteProjects.find(p => p.id === berichteProjekt)?.name) return false;
      return true;
    });
  }, [berichte, berichteVorarbeiter, berichteProjekt, profileMap, berichteProjects]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  if (checkingAdmin) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  if (!isAdmin) return null;

  return (
    <div className="min-h-screen bg-background">
      <PageHeader title="Stundenauswertung" />

      <div className="container mx-auto p-4 space-y-6">
        <Tabs defaultValue="arbeitszeiterfassung" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="arbeitszeiterfassung" className="text-xs sm:text-sm">
              <FileSpreadsheet className="w-4 h-4 mr-1 sm:mr-2 shrink-0" />
              <span className="truncate">Arbeitszeiterfassung</span>
            </TabsTrigger>
            <TabsTrigger value="leistungsberichte" className="text-xs sm:text-sm">
              <ClipboardList className="w-4 h-4 mr-1 sm:mr-2 shrink-0" />
              <span className="truncate">Leistungsberichte</span>
            </TabsTrigger>
            <TabsTrigger value="projektzeiterfassung" className="text-xs sm:text-sm">
              <Building2 className="w-4 h-4 mr-1 sm:mr-2 shrink-0" />
              <span className="truncate">Projektzeiterfassung</span>
            </TabsTrigger>
          </TabsList>

          {/* ============================================================= */}
          {/* TAB 1: Arbeitszeiterfassung (A3 Monthly Grid)                  */}
          {/* ============================================================= */}
          <TabsContent value="arbeitszeiterfassung" className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">
                  Monats\u00fcbersicht
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  MONAT: {monthNames[gridMonth - 1]} {gridYear} = {workingDays} x 8 Std.
                  ({workingDays * 8} Std. Regelarbeitszeit)
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Filters */}
                <div className="flex flex-col sm:flex-row gap-3">
                  <Select
                    value={gridMonth.toString()}
                    onValueChange={(v) => setGridMonth(parseInt(v))}
                  >
                    <SelectTrigger className="h-10 sm:w-[180px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent position="popper">
                      {monthNames.map((name, i) => (
                        <SelectItem key={i} value={(i + 1).toString()}>
                          {name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select
                    value={gridYear.toString()}
                    onValueChange={(v) => setGridYear(parseInt(v))}
                  >
                    <SelectTrigger className="h-10 sm:w-[120px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent position="popper">
                      {years.map((y) => (
                        <SelectItem key={y} value={y.toString()}>
                          {y}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select value={gridEmployee} onValueChange={setGridEmployee}>
                    <SelectTrigger className="h-10 sm:w-[220px]">
                      <SelectValue placeholder="Alle Mitarbeiter" />
                    </SelectTrigger>
                    <SelectContent position="popper">
                      <SelectItem value="all">Alle Mitarbeiter</SelectItem>
                      {profiles.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.nachname} {p.vorname}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Grid */}
                {gridLoading ? (
                  <div className="flex items-center justify-center py-16">
                    <Loader2 className="w-6 h-6 animate-spin mr-2" />
                    <span className="text-muted-foreground">Lade Daten...</span>
                  </div>
                ) : (
                  <div className="overflow-x-auto border rounded-lg">
                    <table
                      className="text-xs border-collapse"
                      style={{ minWidth: `${120 + daysInMonth * 44 + 56}px` }}
                    >
                      <thead>
                        {/* Row 1: Day numbers */}
                        <tr className="bg-muted/60">
                          <th className="sticky left-0 z-10 bg-muted/60 border border-border px-2 py-1 text-left font-semibold min-w-[120px]">
                            Mitarbeiter
                          </th>
                          {Array.from({ length: daysInMonth }, (_, i) => {
                            const day = i + 1;
                            const we = isWeekend(gridYear, gridMonth, day);
                            return (
                              <th
                                key={day}
                                className={cn(
                                  "border border-border px-0.5 py-1 text-center font-semibold min-w-[40px] w-10",
                                  we && "bg-orange-100"
                                )}
                              >
                                {day}
                              </th>
                            );
                          })}
                          <th className="border border-border px-2 py-1 text-center font-bold bg-gray-100 min-w-[56px]">
                            &Sigma;
                          </th>
                        </tr>
                        {/* Row 2: Weekday abbreviations */}
                        <tr className="bg-muted/40">
                          <th className="sticky left-0 z-10 bg-muted/40 border border-border px-2 py-0.5 text-left text-[10px] text-muted-foreground">
                            &nbsp;
                          </th>
                          {Array.from({ length: daysInMonth }, (_, i) => {
                            const day = i + 1;
                            const we = isWeekend(gridYear, gridMonth, day);
                            const wd = getWeekday(gridYear, gridMonth, day);
                            return (
                              <th
                                key={day}
                                className={cn(
                                  "border border-border px-0.5 py-0.5 text-center text-[10px] font-normal text-muted-foreground",
                                  we && "bg-orange-100"
                                )}
                              >
                                {wd}
                              </th>
                            );
                          })}
                          <th className="border border-border px-2 py-0.5 text-center text-[10px] bg-gray-100">
                            &nbsp;
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {gridEmployees.length === 0 ? (
                          <tr>
                            <td
                              colSpan={daysInMonth + 2}
                              className="text-center py-8 text-muted-foreground"
                            >
                              Keine Mitarbeiter gefunden
                            </td>
                          </tr>
                        ) : (
                          gridEmployees.map((employee) => {
                            const employeeDays = gridDataMap[employee.id] || {};
                            let totalHours = 0;
                            for (let d = 1; d <= daysInMonth; d++) {
                              const dd = employeeDays[d];
                              if (dd) totalHours += dd.stunden;
                            }

                            return (
                              <tr key={employee.id} className="hover:bg-muted/20">
                                <td className="sticky left-0 z-10 bg-card border border-border px-2 py-1 font-medium whitespace-nowrap">
                                  {employee.nachname} {employee.vorname}
                                </td>
                                {Array.from({ length: daysInMonth }, (_, i) => {
                                  const day = i + 1;
                                  const we = isWeekend(gridYear, gridMonth, day);
                                  const dd = employeeDays[day] || null;
                                  const cell = formatCell(dd);

                                  return (
                                    <td
                                      key={day}
                                      className={cn(
                                        "border border-border px-0.5 py-1 text-center whitespace-nowrap",
                                        we && !dd && "bg-orange-50",
                                        we && dd && "bg-orange-100",
                                        cell.className
                                      )}
                                      title={
                                        dd
                                          ? dd.isAbsence
                                            ? dd.absenceType
                                            : `${dd.stunden}h${dd.istFahrer ? " Fahrer" : ""}${dd.istWerkstatt ? " Werkstatt" : ""}${dd.schmutzzulage ? " Schmutz" : ""}${dd.regenSchicht ? " Regen" : ""}`
                                          : ""
                                      }
                                    >
                                      {cell.text}
                                    </td>
                                  );
                                })}
                                <td className="border border-border px-2 py-1 text-center font-bold bg-gray-50 whitespace-nowrap">
                                  {totalHours > 0 ? formatNumber(totalHours) : ""}
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Legend */}
                <div className="flex flex-wrap gap-3 text-xs text-muted-foreground pt-2">
                  <span>
                    <strong>F</strong> = Fahrer
                  </span>
                  <span>
                    <strong>W</strong> = Werkstatt
                  </span>
                  <span>
                    <strong>SCH</strong> = Schmutzzulage
                  </span>
                  <span>
                    <strong>R</strong> = Regen
                  </span>
                  <span className="text-green-600">
                    <strong>U</strong> = Urlaub
                  </span>
                  <span className="text-red-600">
                    <strong>K</strong> = Krankenstand
                  </span>
                  <span className="text-blue-600">
                    <strong>ZA</strong> = Zeitausgleich
                  </span>
                  <span>
                    <strong>Schule</strong> = Berufsschule
                  </span>
                  <span className="bg-orange-100 px-1 rounded">Sa/So</span>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ============================================================= */}
          {/* TAB 2: Leistungsberichte                                       */}
          {/* ============================================================= */}
          <TabsContent value="leistungsberichte" className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Leistungsberichte</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Filters */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <div>
                    <label className="text-sm font-medium mb-1 block">Von</label>
                    <input
                      type="date"
                      value={berichteStartDate}
                      onChange={(e) => setBerichteStartDate(e.target.value)}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">Bis</label>
                    <input
                      type="date"
                      value={berichteEndDate}
                      onChange={(e) => setBerichteEndDate(e.target.value)}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">
                      Vorarbeiter
                    </label>
                    <Select
                      value={berichteVorarbeiter}
                      onValueChange={setBerichteVorarbeiter}
                    >
                      <SelectTrigger className="h-10">
                        <SelectValue placeholder="Alle" />
                      </SelectTrigger>
                      <SelectContent position="popper">
                        <SelectItem value="all">Alle</SelectItem>
                        {profiles.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.nachname} {p.vorname}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">
                      Projekt
                    </label>
                    <Select
                      value={berichteProjekt}
                      onValueChange={setBerichteProjekt}
                    >
                      <SelectTrigger className="h-10">
                        <SelectValue placeholder="Alle" />
                      </SelectTrigger>
                      <SelectContent position="popper">
                        <SelectItem value="all">Alle Projekte</SelectItem>
                        {berichteProjects.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Quick date filters */}
                <div className="flex gap-2 flex-wrap">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const now = new Date();
                      setBerichteStartDate(
                        new Date(now.getFullYear(), now.getMonth(), 1)
                          .toISOString()
                          .split("T")[0]
                      );
                      setBerichteEndDate(
                        new Date(now.getFullYear(), now.getMonth() + 1, 0)
                          .toISOString()
                          .split("T")[0]
                      );
                    }}
                  >
                    Dieser Monat
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const now = new Date();
                      setBerichteStartDate(
                        new Date(now.getFullYear(), now.getMonth() - 1, 1)
                          .toISOString()
                          .split("T")[0]
                      );
                      setBerichteEndDate(
                        new Date(now.getFullYear(), now.getMonth(), 0)
                          .toISOString()
                          .split("T")[0]
                      );
                    }}
                  >
                    Letzter Monat
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const now = new Date();
                      setBerichteStartDate(
                        new Date(now.getFullYear(), 0, 1)
                          .toISOString()
                          .split("T")[0]
                      );
                      setBerichteEndDate(now.toISOString().split("T")[0]);
                    }}
                  >
                    Dieses Jahr
                  </Button>
                </div>

                {/* Table */}
                {berichteLoading ? (
                  <div className="flex items-center justify-center py-16">
                    <Loader2 className="w-6 h-6 animate-spin mr-2" />
                    <span className="text-muted-foreground">
                      Lade Berichte...
                    </span>
                  </div>
                ) : filteredBerichte.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <ClipboardList className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>Keine Leistungsberichte im gew\u00e4hlten Zeitraum</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto border rounded-lg">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-muted/60">
                          <th className="border-b px-3 py-2 text-left font-semibold">
                            Datum
                          </th>
                          <th className="border-b px-3 py-2 text-left font-semibold">
                            Projekt
                          </th>
                          <th className="border-b px-3 py-2 text-left font-semibold">
                            Objekt
                          </th>
                          <th className="border-b px-3 py-2 text-left font-semibold">
                            Vorarbeiter
                          </th>
                          <th className="border-b px-3 py-2 text-center font-semibold">
                            Mitarbeiter
                          </th>
                          <th className="border-b px-3 py-2 text-right font-semibold">
                            Stunden
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredBerichte.map((b) => (
                          <tr
                            key={b.id}
                            className="hover:bg-muted/30 cursor-pointer transition-colors"
                            onClick={() =>
                              navigate(`/time-tracking?edit=${b.id}`)
                            }
                          >
                            <td className="border-b px-3 py-2 whitespace-nowrap">
                              {format(parseISO(b.datum), "dd.MM.yyyy", {
                                locale: de,
                              })}
                            </td>
                            <td className="border-b px-3 py-2">
                              {b.projekt_name}
                            </td>
                            <td className="border-b px-3 py-2 text-muted-foreground">
                              {b.objekt || "-"}
                            </td>
                            <td className="border-b px-3 py-2">
                              {b.ersteller_name}
                            </td>
                            <td className="border-b px-3 py-2 text-center">
                              <Badge variant="secondary">
                                {b.mitarbeiter_count}
                              </Badge>
                            </td>
                            <td className="border-b px-3 py-2 text-right font-medium">
                              {b.total_stunden.toFixed(1)} h
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="bg-muted/30">
                          <td
                            colSpan={4}
                            className="px-3 py-2 font-bold text-right"
                          >
                            Gesamt:
                          </td>
                          <td className="px-3 py-2 text-center font-bold">
                            {filteredBerichte.reduce(
                              (s, b) => s + b.mitarbeiter_count,
                              0
                            )}
                          </td>
                          <td className="px-3 py-2 text-right font-bold">
                            {filteredBerichte
                              .reduce((s, b) => s + b.total_stunden, 0)
                              .toFixed(1)}{" "}
                            h
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ============================================================= */}
          {/* TAB 3: Projektzeiterfassung (existing component)               */}
          {/* ============================================================= */}
          <TabsContent value="projektzeiterfassung">
            <ProjectHoursReport />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
