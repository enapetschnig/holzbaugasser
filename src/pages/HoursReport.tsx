import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "@/hooks/use-toast";
import { ArrowLeft, Download, FileSpreadsheet, Building2, Hammer, ChevronDown, AlertTriangle, Pencil, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { format, isSameDay, parseISO } from "date-fns";
import { de } from "date-fns/locale";
import * as XLSX from "xlsx-js-style";
import { cn } from "@/lib/utils";
import ProjectHoursReport from "@/components/ProjectHoursReport";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getNormalWorkingHours } from "@/lib/workingHours";

interface TimeEntry {
  id: string;
  datum: string;
  start_time: string;
  end_time: string;
  pause_minutes: number;
  pause_start?: string;
  pause_end?: string;
  stunden: number;
  location_type: string;
  project_id: string | null;
  user_id: string;
  taetigkeit: string;
  week_type?: string | null;
  disturbance_id?: string | null;
}

interface Profile {
  vorname: string;
  nachname: string;
}

interface Project {
  id: string;
  name: string;
  adresse?: string;
  plz?: string;
}

const monthNames = [
  "Jänner", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember"
];

export default function HoursReport() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [projects, setProjects] = useState<Record<string, Project>>({});
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editingEntry, setEditingEntry] = useState<TimeEntry | null>(null);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [projectList, setProjectList] = useState<Project[]>([]);

  const years = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i);

  useEffect(() => {
    checkAdminStatus();
    fetchProfiles();
    fetchProjects();
    fetchProjectList();
  }, []);

  useEffect(() => {
    if (selectedUserId) {
      fetchTimeEntries();
    }
  }, [month, year, selectedUserId]);

  const checkAdminStatus = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .single();

    const admin = data?.role === "administrator";
    setIsAdmin(admin);

    // Wenn nicht Admin, eigene User ID setzen
    if (!admin) {
      setSelectedUserId(user.id);
    } else {
      // Check for employee query param
      const employeeParam = searchParams.get("employee");
      if (employeeParam) {
        setSelectedUserId(employeeParam);
      }
    }
  };

  const fetchProfiles = async () => {
    const { data } = await supabase.from("profiles").select("id, vorname, nachname");
    if (data) {
      const profileMap: Record<string, Profile> = {};
      data.forEach((p) => {
        profileMap[p.id] = { vorname: p.vorname, nachname: p.nachname };
      });
      setProfiles(profileMap);
    }
  };

  const fetchProjects = async () => {
    const { data } = await supabase.from("projects").select("id, name, adresse, plz");
    if (data) {
      const projectMap: Record<string, Project> = {};
      data.forEach((p) => {
        projectMap[p.id] = p;
      });
      setProjects(projectMap);
    }
  };

  const fetchTimeEntries = async () => {
    setLoading(true);
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0);

    const { data, error } = await supabase
      .from("time_entries")
      .select("*")
      .eq("user_id", selectedUserId)
      .gte("datum", format(startDate, "yyyy-MM-dd"))
      .lte("datum", format(endDate, "yyyy-MM-dd"))
      .order("datum");

    if (error) {
      toast({ title: "Fehler beim Laden", description: error.message, variant: "destructive" });
    } else {
      setTimeEntries(data || []);
    }
    setLoading(false);
  };

  const fetchProjectList = async () => {
    const { data } = await supabase
      .from("projects")
      .select("id, name, plz")
      .eq("status", "aktiv")
      .order("name");
    if (data) setProjectList(data as Project[]);
  };

  const handleUpdateEntry = async () => {
    if (!editingEntry || savingEdit) return;
    setSavingEdit(true);

    const pauseMinutes = editingEntry.pause_minutes || 0;
    let calculatedHours = 0;
    if (editingEntry.start_time && editingEntry.end_time) {
      const toMinCalc = (t: string) => {
        const [h, m] = t.substring(0, 5).split(":").map(Number);
        return h * 60 + m;
      };
      const totalMinutes = toMinCalc(editingEntry.end_time) - toMinCalc(editingEntry.start_time) - pauseMinutes;
      calculatedHours = Math.max(0, totalMinutes / 60);
    }

    const { error } = await supabase
      .from("time_entries")
      .update({
        taetigkeit: editingEntry.taetigkeit,
        start_time: editingEntry.start_time,
        end_time: editingEntry.end_time,
        pause_minutes: pauseMinutes,
        stunden: Math.max(0, calculatedHours),
        project_id: editingEntry.project_id,
      })
      .eq("id", editingEntry.id);

    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: "Eintrag konnte nicht aktualisiert werden" });
    } else {
      toast({ title: "Erfolg", description: "Eintrag wurde aktualisiert" });
      setShowEditDialog(false);
      setEditingEntry(null);
      fetchTimeEntries();
    }
    setSavingEdit(false);
  };

  const handleDeleteEntry = async (id: string) => {
    if (!confirm("Möchtest du diesen Eintrag wirklich löschen?")) return;
    const { error } = await supabase.from("time_entries").delete().eq("id", id);
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: "Eintrag konnte nicht gelöscht werden" });
    } else {
      toast({ title: "Erfolg", description: "Eintrag wurde gelöscht" });
      setShowEditDialog(false);
      setEditingEntry(null);
      fetchTimeEntries();
    }
  };

  const generateMonthDays = () => {
    const daysInMonth = new Date(year, month, 0).getDate();
    const days = [];

    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month - 1, day);
      const dayOfWeek = date.getDay();

      days.push({
        date,
        dayNumber: day,
        dayOfWeek,
        isWeekend: dayOfWeek === 0 || dayOfWeek === 6,
        isFriday: dayOfWeek === 5,
      });
    }

    return days;
  };

  const calculateOvertime = (date: Date, totalHours: number): number => {
    const normalHours = getNormalWorkingHours(date);
    return Math.max(0, totalHours - normalHours);
  };

  const toMin = (t: string) => {
    const [h, m] = (t || "00:00").substring(0, 5).split(":").map(Number);
    return h * 60 + m;
  };

  // Deduplicate overlapping time entries for a day (avoids double-counting from Regieberichte)
  const deduplicateDayEntries = (entries: TimeEntry[]): TimeEntry[] => {
    if (entries.length <= 1) return entries;
    const sorted = [...entries].sort((a, b) =>
      (a.start_time || "").localeCompare(b.start_time || "")
    );
    const result: TimeEntry[] = [];
    for (const entry of sorted) {
      const s = toMin(entry.start_time);
      const e = toMin(entry.end_time);
      const overlaps = result.some(r => s < toMin(r.end_time) && e > toMin(r.start_time));
      if (!overlaps) result.push(entry);
    }
    return result;
  };

  // Returns a Set of entry IDs that are overlapping (= removed by deduplication)
  const getOverlappingEntryIds = (entries: TimeEntry[]): Set<string> => {
    if (entries.length <= 1) return new Set();
    const sorted = [...entries].sort((a, b) =>
      (a.start_time || "").localeCompare(b.start_time || "")
    );
    const kept: TimeEntry[] = [];
    const overlapping = new Set<string>();
    for (const entry of sorted) {
      const s = toMin(entry.start_time);
      const e = toMin(entry.end_time);
      const overlapsKept = kept.some(r => s < toMin(r.end_time) && e > toMin(r.start_time));
      if (overlapsKept) {
        overlapping.add(entry.id);
      } else {
        kept.push(entry);
      }
    }
    return overlapping;
  };

  const calculateLunchBreak = (entry: TimeEntry) => {
    // Prioritize new pause_start/pause_end fields if available
    if (entry.pause_start && entry.pause_end) {
      return {
        start: entry.pause_start.substring(0, 5),
        end: entry.pause_end.substring(0, 5),
      };
    }
    
    // Fallback for old entries with only pause_minutes
    if (!entry.pause_minutes || entry.pause_minutes === 0) return null;

    const pauseStart = new Date(`2000-01-01T12:00:00`);
    const pauseEnd = new Date(pauseStart);
    pauseEnd.setMinutes(pauseEnd.getMinutes() + entry.pause_minutes);

    return {
      start: format(pauseStart, "HH:mm"),
      end: format(pauseEnd, "HH:mm"),
    };
  };

  const monthDays = generateMonthDays();

  // Group entries by day and deduplicate overlapping ones before summing
  const uniqueEntriesByDay = Object.values(
    timeEntries.reduce((acc, entry) => {
      if (!acc[entry.datum]) acc[entry.datum] = [];
      acc[entry.datum].push(entry);
      return acc;
    }, {} as Record<string, TimeEntry[]>)
  ).flatMap((dayEntries) => deduplicateDayEntries(dayEntries));

  const totalHours = uniqueEntriesByDay.reduce((sum, entry) => sum + entry.stunden, 0);
  const totalOvertime = uniqueEntriesByDay.reduce((sum, entry) => {
    const entryDate = parseISO(entry.datum);
    return sum + calculateOvertime(entryDate, entry.stunden);
  }, 0);

  const addBordersToCell = (cell: any, thick: boolean = false, centered: boolean = false) => {
    const borderStyle = thick ? "medium" : "thin";
    cell.s = {
      border: {
        top: { style: borderStyle, color: { rgb: "000000" } },
        bottom: { style: borderStyle, color: { rgb: "000000" } },
        left: { style: borderStyle, color: { rgb: "000000" } },
        right: { style: borderStyle, color: { rgb: "000000" } },
      },
      alignment: { vertical: "center", horizontal: centered ? "center" : "left" },
    };
  };

  const exportToExcel = (includeOvertime: boolean = true) => {
    if (!selectedUserId) {
      toast({ title: "Kein Mitarbeiter ausgewählt", variant: "destructive" });
      return;
    }

    const employeeName = profiles[selectedUserId]
      ? `${profiles[selectedUserId].vorname} ${profiles[selectedUserId].nachname}`
      : "Mitarbeiter";

    const monthNamesShort = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

    const worksheetData: any[][] = [
      // Firmendaten Header
      ["Holzknecht Natursteine", "", "", "", "", "", "", "", "", "", "", ""],
      ["", "", "", "", "", "", "", "", "", "", "", ""],
      ["", "", "", "", "", "", "", "", "", "", "", ""],
      ["", "", "", "", "", "", "", "", "", "", "", ""],
      ["Dienstnehmer:", "", employeeName, "", "", "", "", "", "Monat:", `${monthNamesShort[month - 1]}-${year.toString().slice(-2)}`, "", ""],
      ["", "", "", "", "", "", "", "", "", "", "", ""],
    ];

    // Header-Zeilen dynamisch je nach includeOvertime
    if (includeOvertime) {
      worksheetData.push(
        ["Datum", "V o r m i t t a g", "", "Unterbrechung", "N a c h m i t t a g", "", "Stunden", "Überstunden", "Ort", "Projekt", "Tätigkeit", "PLZ"],
        ["", "Beginn", "Ende", "von - bis", "Beginn", "Ende", "Gesamt", "", "", "", "", ""]
      );
    } else {
      worksheetData.push(
        ["Datum", "V o r m i t t a g", "", "Unterbrechung", "N a c h m i t t a g", "", "Stunden", "Ort", "Projekt", "Tätigkeit", "PLZ", ""],
        ["", "Beginn", "Ende", "von - bis", "Beginn", "Ende", "Gesamt", "", "", "", "", ""]
      );
    }

    worksheetData.push(["", "", "", "", "", "", "", "", "", "", "", ""]);

    // Vormonat letzter Tag hinzufügen (leere Zeile)
    const prevMonthLastDay = new Date(year, month - 1, 0).getDate();
    worksheetData.push([prevMonthLastDay, "", "", "", "", "", "", "", "", "", "", ""]);

    // Alle Tage des Monats (1-31) durchgehen
    const daysInMonth = new Date(year, month, 0).getDate();
    for (let day = 1; day <= daysInMonth; day++) {
      const dayDate = new Date(year, month - 1, day);
      // Finde alle Einträge für diesen Tag
      const dayEntries = timeEntries.filter((e) => isSameDay(parseISO(e.datum), dayDate));
      

      const uniqueDayEntries = deduplicateDayEntries(dayEntries);

      if (uniqueDayEntries.length === 0) {
        worksheetData.push([day, "", "", "", "", "", "", "", "", "", "", ""]);
      } else {
        // Alle (deduplizierten) Einträge des Tages hinzufügen
        uniqueDayEntries.forEach((entry, entryIndex) => {
          const lunchBreak = calculateLunchBreak(entry);
          const project = projects[entry.project_id];
          
          // Ort-Spalte: Baustelle oder Werkstatt
          const ortText = entry.location_type === "baustelle" ? "Baustelle" : "Werkstatt";
          
          // Projekt-Spalte: Urlaub/Krankenstand/Weiterbildung, Störung oder Projektname
          const isAbsence = ["Urlaub", "Krankenstand", "Weiterbildung", "Feiertag"].includes(entry.taetigkeit);
          const isDisturbance = entry.disturbance_id != null || entry.taetigkeit?.startsWith("Störungseinsatz");
          
          let projektName = "";
          if (isAbsence) {
            projektName = entry.taetigkeit;
          } else if (isDisturbance) {
            projektName = "Störung";
          } else {
            projektName = project?.name || "";
          }
          
          // PLZ: nur bei Baustellen (nicht bei Abwesenheit/Werkstatt/Störung)
          const plz = (isAbsence || isDisturbance)
            ? ""
            : entry.location_type === "baustelle" ? (project?.plz || "") : "";

          // Datum nur beim ersten Eintrag des Tages anzeigen
          const displayDay = entryIndex === 0 ? day : "";

          if (includeOvertime) {
            // Export MIT Überstunden: Tatsächliche Zeiten verwenden
            const actualMorningEnd = lunchBreak?.start || "";
            const actualAfternoonStart = lunchBreak?.end || "";
            const actualPauseText = entry.pause_minutes && entry.pause_minutes > 0 && lunchBreak 
              ? `${lunchBreak.start} - ${lunchBreak.end}` 
              : "";
            
            const overtime = calculateOvertime(dayDate, entry.stunden);
            const overtimeText = overtime > 0 ? overtime.toFixed(2) : "";

            worksheetData.push([
              displayDay,
              entry.start_time?.substring(0, 5) || "",
              actualMorningEnd,
              actualPauseText,
              actualAfternoonStart,
              entry.end_time?.substring(0, 5) || "",
              entry.stunden.toFixed(2),
              overtimeText,
              ortText,
              projektName,
              entry.taetigkeit,
              plz,
            ]);
          } else {
            // Export OHNE Überstunden: Regelarbeitszeiten Mo-Fr 08:00-17:00 verwenden
            const dayOfWeek = dayDate.getDay();
            const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
            const regelarbeitszeit = isWeekend ? 0 : 8;

            // Regelarbeitszeiten: Mo-Fr 08:00-12:00, 13:00-17:00
            const regelStart = isWeekend ? "" : "08:00";
            const regelMorningEnd = isWeekend ? "" : "12:00";
            const regelPause = isWeekend ? "" : "12:00 - 13:00";
            const regelAfternoonStart = isWeekend ? "" : "13:00";
            const regelEnd = isWeekend ? "" : "17:00";
            
            worksheetData.push([
              displayDay,
              regelStart,
              regelMorningEnd,
              regelPause,
              regelAfternoonStart,
              regelEnd,
              regelarbeitszeit.toFixed(2),
              ortText,
              projektName,
              entry.taetigkeit,
              plz,
              "",
            ]);
          }
        });

        // Tagessumme wenn mehrere Einträge am Tag
        if (uniqueDayEntries.length > 1) {
          const dayTotalHours = uniqueDayEntries.reduce((sum, e) => sum + e.stunden, 0);
          const dayTotalOvertime = calculateOvertime(dayDate, dayTotalHours);
          if (includeOvertime) {
            worksheetData.push(["", "", "", "", "", "Tagessumme:", dayTotalHours.toFixed(2), dayTotalOvertime > 0 ? dayTotalOvertime.toFixed(2) : "", "", "", "", ""]);
          } else {
            const regelarbeitszeitTag = (dayDate.getDay() === 0 || dayDate.getDay() === 6) ? 0 : 8;
            worksheetData.push(["", "", "", "", "", "Tagessumme:", regelarbeitszeitTag.toFixed(2), "", "", "", "", ""]);
          }
        }
      }
    }

    // Regelarbeitszeit-Summe berechnen für Export ohne Überstunden (dedupliziert)
    const calculateRegelarbeitszeitSumme = () => {
      let summe = 0;
      for (let day = 1; day <= daysInMonth; day++) {
        const dayDate = new Date(year, month - 1, day);
        const dayEntries = timeEntries.filter((e) => isSameDay(parseISO(e.datum), dayDate));
        const uniqueDayEntries = deduplicateDayEntries(dayEntries);
        if (uniqueDayEntries.length > 0) {
          const dayOfWeek = dayDate.getDay();
          const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
          summe += isWeekend ? 0 : 8;
        }
      }
      return summe;
    };

    // Summenzeile mit oder ohne Überstunden
    if (includeOvertime) {
      worksheetData.push(["", "", "", "", "", "SUMME", totalHours.toFixed(2), totalOvertime.toFixed(2), "", "", "", ""]);
    } else {
      const regelarbeitszeitSumme = calculateRegelarbeitszeitSumme();
      worksheetData.push(["", "", "", "", "", "SUMME", regelarbeitszeitSumme.toFixed(2), "", "", "", "", ""]);
    }
    
    // Footer-Zeilen
    worksheetData.push(["", "", "", "", "", "", "", "", "", "", "", ""]); // Leer
    worksheetData.push(["", "", "", "", "", "", "", "", "", "", "", ""]); // Leer
    worksheetData.push(["", "", "", "", "", "", "", "", "", "", "", ""]); // Leer
    if (includeOvertime) {
      worksheetData.push(["", "Hiermit bestätige ich die Richtigkeit der von mir angegebenen Überstunden.", "", "", "", "", "", "", "", "", "", ""]);
      worksheetData.push(["", "", "", "", "", "", "", "", "", "", "", ""]); // Leer
      worksheetData.push(["", `Derzeitiger offener Überstundenstand: ${totalOvertime.toFixed(2)}`, "", "", "", "", "", "", "", "", "", ""]);
      worksheetData.push(["", "Restliche Überstunden wurden zur Gänze abgegolten.", "", "", "", "", "", "", "", "", "", ""]);
    } else {
      worksheetData.push(["", "", "", "", "", "", "", "", "", "", "", ""]); // Leer statt Überstunden-Text
      worksheetData.push(["", "", "", "", "", "", "", "", "", "", "", ""]); // Leer
      worksheetData.push(["", "", "", "", "", "", "", "", "", "", "", ""]); // Leer
      worksheetData.push(["", "", "", "", "", "", "", "", "", "", "", ""]); // Leer
    }
    worksheetData.push(["", "", "", "", "", "", "", "", "", "", "", ""]); // Leer
    worksheetData.push(["", "Datum:", "", "", "", "Unterschrift:", "", "", "", "", "", ""]);

    const ws = XLSX.utils.aoa_to_sheet(worksheetData);
    
    // Spaltenbreiten für 12 Spalten
    ws["!cols"] = [
      { wch: 12 },  // A: Datum
      { wch: 24 },  // B: breiter für Footer-Text
      { wch: 24 },  // C
      { wch: 26 },  // D
      { wch: 12 },  // E
      { wch: 12 },  // F
      { wch: 10 },  // G: Stunden
      { wch: 12 },  // H: Überstunden oder Ort
      { wch: 12 },  // I: Ort oder Projekt
      { wch: 22 },  // J: Projekt
      { wch: 20 },  // K: Tätigkeit
      { wch: 6 },   // L: PLZ
    ];

    // Merged Cells
    const sumRowIndex = worksheetData.length - 9; // Footer hat immer 9 Zeilen
    ws["!merges"] = [
      // Firmendaten Header
      { s: { r: 0, c: 0 }, e: { r: 0, c: 5 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 5 } },
      { s: { r: 2, c: 0 }, e: { r: 2, c: 5 } },
      { s: { r: 3, c: 0 }, e: { r: 3, c: 5 } },
      // Mitarbeiter und Monat
      { s: { r: 5, c: 0 }, e: { r: 5, c: 1 } },
      { s: { r: 5, c: 2 }, e: { r: 5, c: 7 } },
      { s: { r: 5, c: 9 }, e: { r: 5, c: 11 } },
      { s: { r: 7, c: 1 }, e: { r: 7, c: 2 } },
      { s: { r: 7, c: 4 }, e: { r: 7, c: 5 } },
      // Footer Merges - immer aktiv
      { s: { r: sumRowIndex + 4, c: 1 }, e: { r: sumRowIndex + 4, c: 10 } },
      { s: { r: sumRowIndex + 6, c: 1 }, e: { r: sumRowIndex + 6, c: 10 } },
      { s: { r: sumRowIndex + 7, c: 1 }, e: { r: sumRowIndex + 7, c: 10 } }
    ];

    // Zeilenhöhe für Header
    ws["!rows"] = ws["!rows"] || [];
    [0, 1, 2, 3].forEach((r) => {
      ws["!rows"][r] = { hpt: 18 };
    });
    
    // Footer-Texte: erhöhte Zeilenhöhe für Lesbarkeit - immer aktiv
    ws["!rows"][sumRowIndex + 4] = { hpt: 30 }; // "Hiermit bestätige ich..."
    ws["!rows"][sumRowIndex + 6] = { hpt: 25 }; // "Derzeitiger offener Überstundenstand..."

    // Formatierung anwenden
    const range = XLSX.utils.decode_range(ws["!ref"] || "A1");
    for (let R = range.s.r; R <= range.e.r; ++R) {
      for (let C = range.s.c; C <= range.e.c; ++C) {
        const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
        if (!ws[cellAddress]) {
          ws[cellAddress] = { t: "s", v: "" };
        }
        
        const isFirmenHeader = R >= 0 && R <= 3;
        const isHeaderRow = R === 7 || R === 8;
        const footerBaseRow = worksheetData.length - 9; // Footer hat immer 9 Zeilen
        const isSumRow = R === footerBaseRow;
        const isFooterRow = R >= footerBaseRow + 1;
        
        const borderStyle = isHeaderRow ? "medium" : "thin";
        
        if (isFirmenHeader || isFooterRow) {
          ws[cellAddress].s = {
            alignment: { 
              vertical: "center", 
              horizontal: "left",
              wrapText: true
            },
            font: { bold: R === 0, size: R === 0 ? 14 : 11 },
          };
        } else {
          ws[cellAddress].s = {
            border: {
              top: { style: borderStyle, color: { rgb: "000000" } },
              bottom: { style: borderStyle, color: { rgb: "000000" } },
              left: { style: borderStyle, color: { rgb: "000000" } },
              right: { style: borderStyle, color: { rgb: "000000" } },
            },
            alignment: { 
              vertical: "center", 
              horizontal: isHeaderRow ? "center" : "left",
              wrapText: false
            },
          };
          
          if (isHeaderRow || isSumRow) {
            ws[cellAddress].s = {
              ...ws[cellAddress].s,
              font: { bold: true },
            };
          }
        }
      }
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Arbeitszeit");
    const suffix = includeOvertime ? "_mit_Ueberstunden" : "_ohne_Ueberstunden";
    XLSX.writeFile(wb, `Arbeitszeiterfassung_${employeeName}_${monthNamesShort[month - 1]}_${year}${suffix}.xlsx`);

    toast({ title: "Excel exportiert", description: `Datei wurde heruntergeladen` });
  };

  return (
    <div className="container mx-auto p-4 space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <h1 className="text-3xl font-bold">Stundenauswertung</h1>
      </div>

      <Tabs defaultValue="mitarbeiter" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="mitarbeiter">
            <FileSpreadsheet className="w-4 h-4 mr-2" />
            Arbeitszeiterfassung
          </TabsTrigger>
          <TabsTrigger value="projekte">
            <Building2 className="w-4 h-4 mr-2" />
            Projektzeiterfassung
          </TabsTrigger>
        </TabsList>

        <TabsContent value="mitarbeiter" className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2 text-lg sm:text-xl">
                    <FileSpreadsheet className="w-5 h-5 sm:w-6 sm:h-6" />
                    Arbeitszeiterfassung nach Mitarbeitern
                  </CardTitle>
                  <CardDescription className="text-xs sm:text-sm">Monatsberichte mit Überstunden exportieren</CardDescription>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button disabled={!selectedUserId} className="h-11">
                      <Download className="mr-2 h-4 w-4" />
                      <span className="hidden sm:inline">Excel exportieren</span>
                      <span className="sm:hidden">Export</span>
                      <ChevronDown className="ml-2 h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => exportToExcel(true)}>
                      Mit Überstunden
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => exportToExcel(false)}>
                      Ohne Überstunden
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              
              <div className="flex flex-col sm:flex-row gap-3">
                {isAdmin && (
                  <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                    <SelectTrigger className="h-11">
                      <SelectValue placeholder="Mitarbeiter auswählen" />
                    </SelectTrigger>
                    <SelectContent position="popper">
                      {Object.entries(profiles).map(([id, profile]) => (
                        <SelectItem key={id} value={id}>
                          {profile.vorname} {profile.nachname}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <Select value={month.toString()} onValueChange={(v) => setMonth(parseInt(v))}>
                  <SelectTrigger className="h-11">
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
                <Select value={year.toString()} onValueChange={(v) => setYear(parseInt(v))}>
                  <SelectTrigger className="h-11">
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
              </div>

              {selectedUserId && (
                <>
                  <div className="bg-muted/50 p-4 rounded-lg">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-sm text-muted-foreground">Gesamtstunden</p>
                        <p className="text-2xl font-bold">{totalHours.toFixed(2)} h</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Überstunden</p>
                        <p className="text-2xl font-bold">{totalOvertime.toFixed(2)} h</p>
                      </div>
                    </div>
                  </div>

                  <ScrollArea className="h-[500px] rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[100px]">Datum</TableHead>
                          <TableHead>Vormittag</TableHead>
                          <TableHead>Pause</TableHead>
                          <TableHead>Nachmittag</TableHead>
                          <TableHead className="text-right">Stunden</TableHead>
                          <TableHead className="text-right">Überstunden</TableHead>
                          <TableHead>Ort</TableHead>
                          <TableHead>Projekt</TableHead>
                          <TableHead>Tätigkeit</TableHead>
                          {isAdmin && <TableHead className="w-[50px]"></TableHead>}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {loading ? (
                          <TableRow>
                            <TableCell colSpan={9} className="text-center">
                              Lade...
                            </TableCell>
                          </TableRow>
                        ) : monthDays.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={9} className="text-center">
                              Keine Daten verfügbar
                            </TableCell>
                          </TableRow>
                        ) : (
                          monthDays.map((day) => {
                            // Finde alle Einträge für diesen Tag
                            const dayEntries = timeEntries.filter((e) => isSameDay(parseISO(e.datum), day.date));
                            const overlappingIds = getOverlappingEntryIds(dayEntries);
                            const uniqueDayEntries = deduplicateDayEntries(dayEntries);
                            const dayTotalHours = uniqueDayEntries.reduce((sum, e) => sum + e.stunden, 0);
                            const hasMultipleEntries = dayEntries.length > 1;

                            if (dayEntries.length === 0) {
                              return (
                                <TableRow
                                  key={day.dayNumber}
                                  className={cn(day.isWeekend && "bg-muted/30", "text-muted-foreground")}
                                >
                                  <TableCell className="font-medium">
                                    <div className="flex flex-col">
                                      <span>{day.dayNumber}</span>
                                      <span className="text-xs text-muted-foreground">
                                        {format(day.date, "EEE", { locale: de })}
                                      </span>
                                    </div>
                                  </TableCell>
                                  <TableCell colSpan={8}></TableCell>
                                </TableRow>
                              );
                            }

                            return dayEntries.map((entry, entryIndex) => {
                              const lunchBreak = calculateLunchBreak(entry);
                              const isOverlapping = overlappingIds.has(entry.id);
                              const overtime = isOverlapping ? 0 : calculateOvertime(day.date, entry.stunden);
                              const project = projects[entry.project_id];
                              const ortIcon = entry.location_type === "baustelle" ? "🏗️" : entry.location_type === "werkstatt" ? "🔧" : "";
                              const ortText = entry.location_type === "baustelle" ? "Baustelle" : entry.location_type === "werkstatt" ? "Werkstatt" : "";
                              const projektName = entry.taetigkeit === "Urlaub" || entry.taetigkeit === "Krankenstand"
                                ? entry.taetigkeit
                                : (project?.name || "");
                              const isFirstEntry = entryIndex === 0;
                              const isLastEntry = entryIndex === dayEntries.length - 1;

                              return (
                                <TableRow
                                  key={entry.id}
                                  className={cn(
                                    day.isWeekend && "bg-muted/30",
                                    hasMultipleEntries && !isLastEntry && "border-b-0",
                                    isOverlapping && "bg-orange-50/60"
                                  )}
                                >
                                  <TableCell className="font-medium">
                                    {isFirstEntry && (
                                      <div className="flex flex-col">
                                        <span>{day.dayNumber}</span>
                                        <span className="text-xs text-muted-foreground">
                                          {format(day.date, "EEE", { locale: de })}
                                        </span>
                                      </div>
                                    )}
                                  </TableCell>
                                  <TableCell>
                                    <div className="flex items-center gap-1">
                                      <span>{entry.start_time?.substring(0, 5)}</span>
                                      <span>-</span>
                                      <span>{entry.pause_minutes > 0 ? "12:00" : entry.end_time?.substring(0, 5)}</span>
                                    </div>
                                  </TableCell>
                                  <TableCell>
                                    {entry.pause_minutes > 0 && (
                                      <span className="text-sm">12:00 - 13:00</span>
                                    )}
                                  </TableCell>
                                  <TableCell>
                                    {entry.pause_minutes > 0 && (
                                      <div className="flex items-center gap-1">
                                        <span>13:00</span>
                                        <span>-</span>
                                        <span>{entry.end_time?.substring(0, 5)}</span>
                                      </div>
                                    )}
                                  </TableCell>
                                  <TableCell className="text-right font-medium">
                                    {isOverlapping ? (
                                      <div className="flex flex-col items-end gap-0.5">
                                        <span className="line-through text-muted-foreground text-xs">
                                          {entry.stunden.toFixed(2)} h
                                        </span>
                                        <span className="flex items-center gap-1 text-orange-600 text-xs font-semibold">
                                          <AlertTriangle className="w-3 h-3" />
                                          Doppelbuchung
                                        </span>
                                      </div>
                                    ) : (
                                      <>
                                        {entry.stunden.toFixed(2)} h
                                        {hasMultipleEntries && isLastEntry && (
                                          <div className="text-xs text-primary font-bold mt-1">
                                            Σ {dayTotalHours.toFixed(2)} h
                                          </div>
                                        )}
                                      </>
                                    )}
                                  </TableCell>
                                  <TableCell className="text-right">
                                    {overtime > 0 && (
                                      <span className="text-orange-600 font-medium">
                                        +{overtime.toFixed(2)} h
                                      </span>
                                    )}
                                  </TableCell>
                                  <TableCell>
                                    <span className="flex items-center gap-1">
                                      <span>{ortIcon}</span>
                                      <span className="text-xs">{ortText}</span>
                                    </span>
                                  </TableCell>
                                  <TableCell className="max-w-[150px] truncate">
                                    {projektName}
                                  </TableCell>
                                  <TableCell className="max-w-[150px] truncate">
                                    {entry.taetigkeit}
                                  </TableCell>
                                  {isAdmin && (
                                    <TableCell>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-7 w-7 p-0"
                                        onClick={() => { setEditingEntry(entry); setShowEditDialog(true); }}
                                      >
                                        <Pencil className="h-3.5 w-3.5" />
                                      </Button>
                                    </TableCell>
                                  )}
                                </TableRow>
                              );
                            });
                          })
                        )}
                      </TableBody>
                      <TableFooter>
                        <TableRow>
                          <TableCell colSpan={4} className="text-right font-bold">
                            Gesamt:
                          </TableCell>
                          <TableCell className="text-right font-bold">
                            {totalHours.toFixed(2)} h
                          </TableCell>
                          <TableCell className="text-right font-bold text-orange-600">
                            {totalOvertime.toFixed(2)} h
                          </TableCell>
                          <TableCell colSpan={3}></TableCell>
                        </TableRow>
                      </TableFooter>
                    </Table>
                  </ScrollArea>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="projekte">
          <ProjectHoursReport />
        </TabsContent>
      </Tabs>

      {/* Admin Edit Dialog */}
      <Dialog open={showEditDialog} onOpenChange={(open) => {
        setShowEditDialog(open);
        if (!open) setEditingEntry(null);
      }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Stundeneintrag bearbeiten</DialogTitle>
            <DialogDescription>
              {editingEntry && (
                <>
                  {profiles[editingEntry.user_id]
                    ? `${profiles[editingEntry.user_id].vorname} ${profiles[editingEntry.user_id].nachname} – `
                    : ""}
                  {format(parseISO(editingEntry.datum), "EEEE, dd. MMMM yyyy", { locale: de })}
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          {editingEntry && (
            <div className="space-y-4">
              <div>
                <Label>Tätigkeit</Label>
                <Input
                  value={editingEntry.taetigkeit}
                  onChange={(e) => setEditingEntry({ ...editingEntry, taetigkeit: e.target.value })}
                />
              </div>

              <div>
                <Label>Projekt</Label>
                <Select
                  value={editingEntry.project_id || "none"}
                  onValueChange={(v) => setEditingEntry({ ...editingEntry, project_id: v === "none" ? null : v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Projekt auswählen" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Kein Projekt</SelectItem>
                    {projectList.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}{p.plz ? ` (${p.plz})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Beginn</Label>
                  <Input
                    type="time"
                    value={editingEntry.start_time?.substring(0, 5) || ""}
                    onChange={(e) => setEditingEntry({ ...editingEntry, start_time: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Ende</Label>
                  <Input
                    type="time"
                    value={editingEntry.end_time?.substring(0, 5) || ""}
                    onChange={(e) => setEditingEntry({ ...editingEntry, end_time: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <Label>Pause (Minuten)</Label>
                <Input
                  type="number"
                  min="0"
                  value={editingEntry.pause_minutes || 0}
                  onChange={(e) => setEditingEntry({ ...editingEntry, pause_minutes: parseInt(e.target.value) || 0 })}
                />
              </div>

              <div className="flex gap-2 pt-4">
                <Button onClick={handleUpdateEntry} className="flex-1" disabled={savingEdit}>
                  {savingEdit ? "Wird gespeichert..." : "Speichern"}
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
}
