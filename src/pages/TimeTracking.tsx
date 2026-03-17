import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Trash2, Save, FileText, Users, CalendarDays, Info } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { format } from "date-fns";
import { de } from "date-fns/locale";
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
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Project = {
  id: string;
  name: string;
  plz: string;
  adresse: string | null;
  status: string | null;
};

type Profile = {
  id: string;
  vorname: string;
  nachname: string;
};

type Taetigkeit = {
  position: number;
  bezeichnung: string;
};

type MitarbeiterRow = {
  id: string; // local key
  mitarbeiterId: string;
  istFahrer: boolean;
  istWerkstatt: boolean;
  schmutzzulage: boolean;
  regenSchicht: boolean;
  fahrerStunden: string;    // "" means all hours
  werkstattStunden: string;
  schmutzzulageStunden: string;
  regenStunden: string;
  stunden: Record<number, number>; // position -> hours
};

type ExistingBericht = {
  id: string;
  datum: string;
  projekt_name: string;
  mitarbeiter_count: number;
  total_stunden: number;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function calcPauseMinutes(von: string, bis: string): number {
  if (!von || !bis) return 0;
  const [hv, mv] = von.split(":").map(Number);
  const [hb, mb] = bis.split(":").map(Number);
  const diff = (hb * 60 + mb) - (hv * 60 + mv);
  return Math.max(0, diff);
}

function sumStunden(row: MitarbeiterRow): number {
  return Object.values(row.stunden).reduce((a, b) => a + (b || 0), 0);
}

function createEmptyMitarbeiterRow(): MitarbeiterRow {
  return {
    id: crypto.randomUUID(),
    mitarbeiterId: "",
    istFahrer: false,
    istWerkstatt: false,
    schmutzzulage: false,
    regenSchicht: false,
    fahrerStunden: "",
    werkstattStunden: "",
    schmutzzulageStunden: "",
    regenStunden: "",
    stunden: { 1: 0.5 },  // Rüstzeit/Anfahrt immer 0,5h
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const TimeTracking = () => {
  const navigate = useNavigate();
  const { toast } = useToast();

  // Auth & role
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  // Data
  const [projects, setProjects] = useState<Project[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);

  // Form: Kopfdaten
  const [datum, setDatum] = useState(format(new Date(), "yyyy-MM-dd"));
  const [projektId, setProjektId] = useState("");
  const [objekt, setObjekt] = useState("");
  const [ankunftZeit, setAnkunftZeit] = useState("07:00");
  const [abfahrtZeit, setAbfahrtZeit] = useState("16:00");
  const [pauseVon, setPauseVon] = useState("11:00");
  const [pauseBis, setPauseBis] = useState("11:30");
  const [wetter, setWetter] = useState("");
  const [schmutzzulageAlle, setSchmutzzulageAlle] = useState(false);
  const [regenSchichtAlle, setRegenSchichtAlle] = useState(false);

  // Form: Taetigkeiten
  const [taetigkeiten, setTaetigkeiten] = useState<Taetigkeit[]>([
    { position: 1, bezeichnung: "Rüstzeit/Anfahrt, Ankunftszeit Baustelle" },
    { position: 2, bezeichnung: "" },
    { position: 3, bezeichnung: "" },
    { position: 4, bezeichnung: "" },
  ]);

  // Form: Mitarbeiter
  const [mitarbeiterRows, setMitarbeiterRows] = useState<MitarbeiterRow[]>([
    createEmptyMitarbeiterRow(),
  ]);

  // Geräteeinsatz
  const [geraete, setGeraete] = useState<{ id: string; geraet: string; stunden: string }[]>([]);
  const GERAETE_OPTIONEN = ["LKW", "Kran", "Bagger", "Sonstiges"];

  // Materialien
  const [materialien, setMaterialien] = useState<{ id: string; bezeichnung: string; menge: string }[]>([]);

  // Anmerkungen & Fertiggestellt
  const [anmerkungen, setAnmerkungen] = useState("");
  const [fertiggestellt, setFertiggestellt] = useState(false);

  // Mitarbeiter-Auswahl Dialog
  const [showMitarbeiterDialog, setShowMitarbeiterDialog] = useState(false);
  const [selectedNewMitarbeiter, setSelectedNewMitarbeiter] = useState<Set<string>>(new Set());

  // Neues Projekt Dialog
  const [showNewProjectDialog, setShowNewProjectDialog] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectPlz, setNewProjectPlz] = useState("");
  const [newProjectAdresse, setNewProjectAdresse] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);

  // Gleiche Stunden für alle
  const [gleicheStundenFuerAlle, setGleicheStundenFuerAlle] = useState(false);

  // Saving state
  const [saving, setSaving] = useState(false);

  // Editing existing report
  const [editingBerichtId, setEditingBerichtId] = useState<string | null>(null);

  // Existing reports list
  const [existingBerichte, setExistingBerichte] = useState<ExistingBericht[]>([]);
  const [loadingBerichte, setLoadingBerichte] = useState(false);

  // Derived
  const selectedProject = useMemo(
    () => projects.find((p) => p.id === projektId),
    [projects, projektId]
  );

  const pauseMinuten = useMemo(
    () => calcPauseMinutes(pauseVon, pauseBis),
    [pauseVon, pauseBis]
  );

  const gesamtStunden = useMemo(
    () => mitarbeiterRows.reduce((sum, row) => sum + sumStunden(row), 0),
    [mitarbeiterRows]
  );

  // Auto-fill position 1 text
  const pos1Text = useMemo(
    () => `Rüstzeit/Anfahrt, Ankunftszeit Baustelle: ${ankunftZeit}`,
    [ankunftZeit]
  );

  // Auto-fill pause text for last position
  const pauseText = useMemo(() => {
    if (!pauseVon || !pauseBis) return "Pause";
    return `Pause ${pauseVon}–${pauseBis} (${pauseMinuten} Min.)`;
  }, [pauseVon, pauseBis, pauseMinuten]);

  // -------------------------------------------------------------------------
  // Role check
  // -------------------------------------------------------------------------
  useEffect(() => {
    const checkRole = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        navigate("/auth");
        return;
      }
      setCurrentUserId(user.id);

      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .single();

      const role = data?.role;
      if (role === "mitarbeiter") {
        toast({
          variant: "destructive",
          title: "Kein Zugriff",
          description:
            "Diese Seite ist nur für Administratoren und Vorarbeiter zugänglich.",
        });
        navigate("/");
        return;
      }
      setIsAdmin(role === "administrator");
      setLoading(false);
    };
    checkRole();
  }, []);

  // -------------------------------------------------------------------------
  // Load projects & profiles
  // -------------------------------------------------------------------------
  const loadData = useCallback(async () => {
    const [projectsRes, profilesRes] = await Promise.all([
      supabase
        .from("projects")
        .select("id, name, plz, adresse, status")
        .in("status", ["aktiv", "in_planung"])
        .order("name"),
      supabase
        .from("profiles")
        .select("id, vorname, nachname")
        .eq("is_active", true)
        .order("nachname"),
    ]);

    if (projectsRes.data) setProjects(projectsRes.data);
    if (profilesRes.data) setProfiles(profilesRes.data);
  }, []);

  useEffect(() => {
    if (!loading) loadData();
  }, [loading, loadData]);

  // -------------------------------------------------------------------------
  // Load existing Berichte
  // -------------------------------------------------------------------------
  const loadBerichte = useCallback(async () => {
    if (!currentUserId) return;
    setLoadingBerichte(true);

    const { data, error } = await supabase
      .from("leistungsberichte" as any)
      .select(`
        id,
        datum,
        projekt_id,
        projects:projekt_id ( name )
      `)
      .order("datum", { ascending: false })
      .limit(20);

    if (error) {
      console.error("Error loading Berichte:", error);
      setLoadingBerichte(false);
      return;
    }

    if (!data || data.length === 0) {
      setExistingBerichte([]);
      setLoadingBerichte(false);
      return;
    }

    // Load mitarbeiter counts and total hours for each bericht
    const berichtIds = data.map((b: any) => b.id);
    const { data: mitarbeiterData } = await supabase
      .from("leistungsbericht_mitarbeiter" as any)
      .select("bericht_id, summe_stunden")
      .in("bericht_id", berichtIds);

    const berichte: ExistingBericht[] = data.map((b: any) => {
      const maRows = (mitarbeiterData || []).filter(
        (m: any) => m.bericht_id === b.id
      );
      return {
        id: b.id,
        datum: b.datum,
        projekt_name: b.projects?.name || "–",
        mitarbeiter_count: maRows.length,
        total_stunden: maRows.reduce(
          (s: number, m: any) => s + (m.summe_stunden || 0),
          0
        ),
      };
    });

    setExistingBerichte(berichte);
    setLoadingBerichte(false);
  }, [currentUserId]);

  useEffect(() => {
    if (!loading && currentUserId) loadBerichte();
  }, [loading, currentUserId, loadBerichte]);

  // -------------------------------------------------------------------------
  // Taetigkeiten handlers
  // -------------------------------------------------------------------------
  const updateTaetigkeit = (position: number, bezeichnung: string) => {
    setTaetigkeiten((prev) =>
      prev.map((t) => (t.position === position ? { ...t, bezeichnung } : t))
    );
  };

  const addTaetigkeit = () => {
    if (taetigkeiten.length >= 8) return;
    const nextPos = taetigkeiten.length + 1;
    setTaetigkeiten((prev) => [...prev, { position: nextPos, bezeichnung: "" }]);
  };

  const removeTaetigkeit = (position: number) => {
    if (taetigkeiten.length <= 1) return;
    setTaetigkeiten((prev) => {
      const filtered = prev.filter((t) => t.position !== position);
      // Re-number positions
      return filtered.map((t, i) => ({ ...t, position: i + 1 }));
    });
  };

  // -------------------------------------------------------------------------
  // Mitarbeiter handlers
  // -------------------------------------------------------------------------
  const updateMitarbeiterField = (
    id: string,
    field: keyof MitarbeiterRow,
    value: any
  ) => {
    // When "gleiche Stunden" is active, sync W/S/R flags (but NOT F) to all rows
    const syncFields: (keyof MitarbeiterRow)[] = [
      "istWerkstatt",
      "schmutzzulage",
      "regenSchicht",
      "werkstattStunden",
      "schmutzzulageStunden",
      "regenStunden",
    ];
    if (gleicheStundenFuerAlle && syncFields.includes(field)) {
      setMitarbeiterRows((prev) =>
        prev.map((r) => ({ ...r, [field]: value }))
      );
    } else {
      setMitarbeiterRows((prev) =>
        prev.map((r) => (r.id === id ? { ...r, [field]: value } : r))
      );
    }
  };

  const updateMitarbeiterStunden = (
    id: string,
    position: number,
    value: number
  ) => {
    setMitarbeiterRows((prev) => {
      if (gleicheStundenFuerAlle) {
        // Apply the same hours value to ALL rows for this position
        return prev.map((r) => ({
          ...r,
          stunden: { ...r.stunden, [position]: value },
        }));
      }
      return prev.map((r) =>
        r.id === id
          ? { ...r, stunden: { ...r.stunden, [position]: value } }
          : r
      );
    });
  };

  const addMitarbeiter = () => {
    setMitarbeiterRows((prev) => [...prev, createEmptyMitarbeiterRow()]);
  };

  const openMitarbeiterDialog = () => {
    setSelectedNewMitarbeiter(new Set());
    setShowMitarbeiterDialog(true);
  };

  const handleAddSelectedMitarbeiter = () => {
    if (selectedNewMitarbeiter.size === 0) {
      setShowMitarbeiterDialog(false);
      return;
    }
    const newRows: MitarbeiterRow[] = Array.from(selectedNewMitarbeiter).map(
      (profileId) => ({
        ...createEmptyMitarbeiterRow(),
        mitarbeiterId: profileId,
      })
    );
    setMitarbeiterRows((prev) => {
      // Remove the initial empty row if it exists and has no mitarbeiterId
      const cleaned = prev.filter((r) => r.mitarbeiterId !== "");
      return [...cleaned, ...newRows];
    });
    setShowMitarbeiterDialog(false);
  };

  const alreadyAddedMitarbeiterIds = useMemo(
    () => new Set(mitarbeiterRows.filter((r) => r.mitarbeiterId).map((r) => r.mitarbeiterId)),
    [mitarbeiterRows]
  );

  const removeMitarbeiter = (id: string) => {
    if (mitarbeiterRows.length <= 1) return;
    setMitarbeiterRows((prev) => prev.filter((r) => r.id !== id));
  };

  // Neues Projekt erstellen
  const handleCreateProject = async () => {
    if (!newProjectName.trim()) {
      toast({ variant: "destructive", title: "Projektname ist Pflicht" });
      return;
    }
    if (!newProjectPlz.match(/^\d{4,5}$/)) {
      toast({ variant: "destructive", title: "PLZ muss 4-5 Ziffern haben" });
      return;
    }
    setCreatingProject(true);
    try {
      const { data, error } = await supabase
        .from("projects")
        .insert({
          name: newProjectName.trim(),
          plz: newProjectPlz.trim(),
          adresse: newProjectAdresse.trim() || null,
          status: "aktiv",
        })
        .select("id, name, plz, adresse, status")
        .single();
      if (error) throw error;
      if (data) {
        setProjects((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
        setProjektId(data.id);
        toast({ title: "Projekt erstellt" });
      }
      setShowNewProjectDialog(false);
      setNewProjectName("");
      setNewProjectPlz("");
      setNewProjectAdresse("");
    } catch (err: any) {
      toast({ variant: "destructive", title: "Fehler", description: err.message });
    } finally {
      setCreatingProject(false);
    }
  };

  // Schmutzzulage for all toggle
  useEffect(() => {
    setMitarbeiterRows((prev) =>
      prev.map((r) => ({ ...r, schmutzzulage: schmutzzulageAlle }))
    );
  }, [schmutzzulageAlle]);

  // Regen for all toggle
  useEffect(() => {
    setMitarbeiterRows((prev) =>
      prev.map((r) => ({ ...r, regenSchicht: regenSchichtAlle }))
    );
  }, [regenSchichtAlle]);

  // -------------------------------------------------------------------------
  // Build Taetigkeiten display list (with auto-filled positions)
  // -------------------------------------------------------------------------
  const displayTaetigkeiten = useMemo(() => {
    return taetigkeiten.map((t) => {
      if (t.position === 1) {
        return { ...t, bezeichnung: t.bezeichnung || pos1Text, isAuto: !t.bezeichnung };
      }
      return { ...t, isAuto: false };
    });
  }, [taetigkeiten, pos1Text]);

  // -------------------------------------------------------------------------
  // Validate
  // -------------------------------------------------------------------------
  const validate = (): string | null => {
    if (!projektId) return "Bitte ein Projekt auswählen.";
    if (!datum) return "Bitte ein Datum eingeben.";
    if (!ankunftZeit || !abfahrtZeit) return "Ankunft- und Abfahrtszeit sind erforderlich.";

    const activeTaetigkeiten = taetigkeiten.filter((t) => t.bezeichnung.trim());
    if (activeTaetigkeiten.length === 0 && !pos1Text) {
      return "Mindestens eine Tätigkeit ist erforderlich.";
    }

    const activeMitarbeiter = mitarbeiterRows.filter((r) => r.mitarbeiterId);
    if (activeMitarbeiter.length === 0) {
      return "Mindestens ein Mitarbeiter ist erforderlich.";
    }

    // Check for duplicate mitarbeiter
    const ids = activeMitarbeiter.map((r) => r.mitarbeiterId);
    if (new Set(ids).size !== ids.length) {
      return "Jeder Mitarbeiter darf nur einmal vorkommen.";
    }

    return null;
  };

  // -------------------------------------------------------------------------
  // Save
  // -------------------------------------------------------------------------
  const handleSave = async () => {
    const errorMsg = validate();
    if (errorMsg) {
      toast({ variant: "destructive", title: "Fehler", description: errorMsg });
      return;
    }

    setSaving(true);
    try {
      // If editing, delete old records first
      if (editingBerichtId) {
        // Delete in correct order (foreign keys)
        await supabase
          .from("leistungsbericht_stunden" as any)
          .delete()
          .eq("bericht_id", editingBerichtId);
        await supabase
          .from("leistungsbericht_mitarbeiter" as any)
          .delete()
          .eq("bericht_id", editingBerichtId);
        await supabase
          .from("leistungsbericht_taetigkeiten" as any)
          .delete()
          .eq("bericht_id", editingBerichtId);
        await supabase
          .from("leistungsbericht_geraete" as any)
          .delete()
          .eq("bericht_id", editingBerichtId);
        await supabase
          .from("leistungsbericht_materialien" as any)
          .delete()
          .eq("bericht_id", editingBerichtId);

        // Delete associated time_entries
        await supabase
          .from("time_entries")
          .delete()
          .eq("datum", datum)
          .in(
            "user_id",
            mitarbeiterRows.filter((r) => r.mitarbeiterId).map((r) => r.mitarbeiterId)
          );

        // Delete the bericht itself
        await supabase
          .from("leistungsberichte" as any)
          .delete()
          .eq("id", editingBerichtId);
      }

      // 1. Create Leistungsbericht
      const { data: berichtData, error: berichtError } = await supabase
        .from("leistungsberichte" as any)
        .insert({
          erstellt_von: currentUserId,
          projekt_id: projektId,
          datum,
          objekt: objekt || null,
          ankunft_zeit: ankunftZeit,
          abfahrt_zeit: abfahrtZeit,
          pause_von: pauseVon || null,
          pause_bis: pauseBis || null,
          pause_minuten: pauseMinuten,
          wetter: wetter || null,
          anmerkungen: anmerkungen || null,
          fertiggestellt,
          schmutzzulage_alle: schmutzzulageAlle,
          regen_schicht_alle: regenSchichtAlle,
        })
        .select("id")
        .single();

      if (berichtError) throw berichtError;
      const berichtId = (berichtData as any).id;

      // 2. Build final taetigkeiten list with auto-fills
      const finalTaetigkeiten: { position: number; bezeichnung: string }[] = [];
      for (const t of taetigkeiten) {
        const bez = t.position === 1
          ? pos1Text
          : t.bezeichnung.trim();
        if (bez) {
          finalTaetigkeiten.push({ position: t.position, bezeichnung: bez });
        }
      }

      // Add Pause position
      const pausePos = finalTaetigkeiten.length + 1;
      finalTaetigkeiten.push({ position: pausePos, bezeichnung: pauseText });

      // 3. Create taetigkeiten records
      const { data: taetigkeitenData, error: taetigkeitenError } = await supabase
        .from("leistungsbericht_taetigkeiten" as any)
        .insert(
          finalTaetigkeiten.map((t) => ({
            bericht_id: berichtId,
            position: t.position,
            bezeichnung: t.bezeichnung,
          }))
        )
        .select("id, position");

      if (taetigkeitenError) throw taetigkeitenError;

      // Map position -> taetigkeit DB id
      const positionToTaetigkeitId: Record<number, string> = {};
      for (const t of (taetigkeitenData as any[]) || []) {
        positionToTaetigkeitId[t.position] = t.id;
      }

      // 4. Create mitarbeiter records
      const activeMitarbeiter = mitarbeiterRows.filter((r) => r.mitarbeiterId);
      const mitarbeiterInserts = activeMitarbeiter.map((r) => ({
        bericht_id: berichtId,
        mitarbeiter_id: r.mitarbeiterId,
        ist_fahrer: r.istFahrer,
        ist_werkstatt: r.istWerkstatt,
        schmutzzulage: r.schmutzzulage,
        regen_schicht: r.regenSchicht,
        fahrer_stunden: r.fahrerStunden ? parseFloat(r.fahrerStunden) : null,
        werkstatt_stunden: r.werkstattStunden ? parseFloat(r.werkstattStunden) : null,
        schmutzzulage_stunden: r.schmutzzulageStunden ? parseFloat(r.schmutzzulageStunden) : null,
        regen_stunden: r.regenStunden ? parseFloat(r.regenStunden) : null,
        summe_stunden: sumStunden(r),
      }));

      const { error: mitarbeiterError } = await supabase
        .from("leistungsbericht_mitarbeiter" as any)
        .insert(mitarbeiterInserts);

      if (mitarbeiterError) throw mitarbeiterError;

      // 5. Create stunden records (matrix entries)
      const stundenInserts: any[] = [];
      for (const row of activeMitarbeiter) {
        for (const [posStr, hours] of Object.entries(row.stunden)) {
          const pos = Number(posStr);
          if (hours > 0 && positionToTaetigkeitId[pos]) {
            stundenInserts.push({
              bericht_id: berichtId,
              mitarbeiter_id: row.mitarbeiterId,
              taetigkeit_id: positionToTaetigkeitId[pos],
              stunden: hours,
            });
          }
        }
      }

      if (stundenInserts.length > 0) {
        const { error: stundenError } = await supabase
          .from("leistungsbericht_stunden" as any)
          .insert(stundenInserts);

        if (stundenError) throw stundenError;
      }

      // 6. Create time_entries for each mitarbeiter
      const taetigkeitLabels = finalTaetigkeiten
        .filter((t) => !t.bezeichnung.startsWith("Pause"))
        .map((t) => t.bezeichnung);

      const timeEntryInserts = activeMitarbeiter.map((r) => {
        // Build activity description from hours
        const parts: string[] = [];
        for (const [posStr, hours] of Object.entries(r.stunden)) {
          const pos = Number(posStr);
          if (hours > 0) {
            const tObj = finalTaetigkeiten.find((t) => t.position === pos);
            if (tObj && !tObj.bezeichnung.startsWith("Pause")) {
              parts.push(`${tObj.bezeichnung} (${hours}h)`);
            }
          }
        }

        return {
          user_id: r.mitarbeiterId,
          project_id: projektId,
          datum,
          stunden: sumStunden(r),
          taetigkeit: parts.join(", ") || taetigkeitLabels.join(", "),
          start_time: ankunftZeit,
          end_time: abfahrtZeit,
          pause_minutes: pauseMinuten,
          location_type: r.istWerkstatt ? "werkstatt" : "baustelle",
        };
      });

      const { error: timeError } = await supabase
        .from("time_entries")
        .insert(timeEntryInserts);

      if (timeError) throw timeError;

      // 7. Save Geräte
      if (geraete.length > 0) {
        const geraeteInserts = geraete
          .filter((g) => g.geraet.trim() && parseFloat(g.stunden) > 0)
          .map((g) => ({
            bericht_id: berichtId,
            geraet: g.geraet.trim(),
            stunden: parseFloat(g.stunden),
          }));
        if (geraeteInserts.length > 0) {
          const { error: geraeteError } = await supabase
            .from("leistungsbericht_geraete" as any)
            .insert(geraeteInserts);
          if (geraeteError) throw geraeteError;
        }
      }

      // 8. Save Materialien
      if (materialien.length > 0) {
        const materialienInserts = materialien
          .filter((m) => m.bezeichnung)
          .map((m) => ({
            bericht_id: berichtId,
            bezeichnung: m.bezeichnung,
            menge: m.menge,
          }));
        if (materialienInserts.length > 0) {
          const { error: materialienError } = await supabase
            .from("leistungsbericht_materialien" as any)
            .insert(materialienInserts);
          if (materialienError) throw materialienError;
        }
      }

      toast({
        title: "Gespeichert",
        description: `Leistungsbericht für ${format(
          new Date(datum),
          "dd.MM.yyyy"
        )} wurde erfolgreich gespeichert.`,
      });

      // Reset form
      resetForm();
      loadBerichte();
    } catch (err: any) {
      console.error("Save error:", err);
      toast({
        variant: "destructive",
        title: "Fehler beim Speichern",
        description: err.message || "Unbekannter Fehler",
      });
    } finally {
      setSaving(false);
    }
  };

  // -------------------------------------------------------------------------
  // Reset form
  // -------------------------------------------------------------------------
  const resetForm = () => {
    setEditingBerichtId(null);
    setProjektId("");
    setObjekt("");
    setAnkunftZeit("07:00");
    setAbfahrtZeit("16:00");
    setPauseVon("11:00");
    setPauseBis("11:30");
    setWetter("");
    setSchmutzzulageAlle(false);
    setRegenSchichtAlle(false);
    setGeraete([]);
    setMaterialien([]);
    setAnmerkungen("");
    setFertiggestellt(false);
    setTaetigkeiten([
      { position: 1, bezeichnung: "Rüstzeit/Anfahrt, Ankunftszeit Baustelle" },
      { position: 2, bezeichnung: "" },
      { position: 3, bezeichnung: "" },
      { position: 4, bezeichnung: "" },
    ]);
    setMitarbeiterRows([createEmptyMitarbeiterRow()]);
    setGleicheStundenFuerAlle(false);
    setDatum(format(new Date(), "yyyy-MM-dd"));
  };

  // -------------------------------------------------------------------------
  // Load existing Bericht for editing
  // -------------------------------------------------------------------------
  const loadBericht = async (id: string) => {
    try {
      const { data: bericht, error } = await supabase
        .from("leistungsberichte" as any)
        .select("*")
        .eq("id", id)
        .single();

      if (error) throw error;
      const b = bericht as any;

      setEditingBerichtId(id);
      setDatum(b.datum);
      setProjektId(b.projekt_id);
      setObjekt(b.objekt || "");
      setAnkunftZeit(b.ankunft_zeit || "07:00");
      setAbfahrtZeit(b.abfahrt_zeit || "16:00");
      setPauseVon(b.pause_von || "11:00");
      setPauseBis(b.pause_bis || "11:30");
      setWetter(b.wetter || "");
      setSchmutzzulageAlle(b.schmutzzulage_alle || false);
      setRegenSchichtAlle(b.regen_schicht_alle || false);
      setAnmerkungen(b.anmerkungen || "");
      setFertiggestellt(b.fertiggestellt || false);

      // Load taetigkeiten
      const { data: tData } = await supabase
        .from("leistungsbericht_taetigkeiten" as any)
        .select("*")
        .eq("bericht_id", id)
        .order("position");

      if (tData && (tData as any[]).length > 0) {
        // Filter out auto-generated LKW and Pause entries
        const manualT = (tData as any[]).filter(
          (t) =>
            !t.bezeichnung.startsWith("LKW AN+ABFAHRT") &&
            !t.bezeichnung.startsWith("Pause")
        );
        const mapped = manualT.map((t: any) => ({
          position: t.position,
          bezeichnung: t.bezeichnung,
        }));
        setTaetigkeiten(
          mapped.length > 0
            ? mapped
            : [{ position: 1, bezeichnung: "Rüstzeit/Anfahrt, Ankunftszeit Baustelle" }]
        );
      }

      // Load mitarbeiter
      const { data: mData } = await supabase
        .from("leistungsbericht_mitarbeiter" as any)
        .select("*")
        .eq("bericht_id", id);

      // Load stunden
      const { data: sData } = await supabase
        .from("leistungsbericht_stunden" as any)
        .select("*")
        .eq("bericht_id", id);

      // Build taetigkeit_id -> position mapping
      const taetigkeitIdToPos: Record<string, number> = {};
      for (const t of (tData as any[]) || []) {
        taetigkeitIdToPos[t.id] = t.position;
      }

      if (mData && (mData as any[]).length > 0) {
        const rows: MitarbeiterRow[] = (mData as any[]).map((m: any) => {
          const stundenMap: Record<number, number> = {};
          for (const s of (sData as any[]) || []) {
            if (s.mitarbeiter_id === m.mitarbeiter_id) {
              const pos = taetigkeitIdToPos[s.taetigkeit_id];
              if (pos) stundenMap[pos] = s.stunden;
            }
          }
          return {
            id: crypto.randomUUID(),
            mitarbeiterId: m.mitarbeiter_id,
            istFahrer: m.ist_fahrer || false,
            istWerkstatt: m.ist_werkstatt || false,
            schmutzzulage: m.schmutzzulage || false,
            regenSchicht: m.regen_schicht || false,
            fahrerStunden: m.fahrer_stunden != null ? String(m.fahrer_stunden) : "",
            werkstattStunden: m.werkstatt_stunden != null ? String(m.werkstatt_stunden) : "",
            schmutzzulageStunden: m.schmutzzulage_stunden != null ? String(m.schmutzzulage_stunden) : "",
            regenStunden: m.regen_stunden != null ? String(m.regen_stunden) : "",
            stunden: stundenMap,
          };
        });
        setMitarbeiterRows(rows);
      }

      // Load geraete
      const { data: geraeteData } = await supabase
        .from("leistungsbericht_geraete" as any)
        .select("*")
        .eq("bericht_id", id);

      if (geraeteData && (geraeteData as any[]).length > 0) {
        setGeraete(
          (geraeteData as any[]).map((g: any) => ({
            id: crypto.randomUUID(),
            geraet: g.geraet,
            stunden: String(g.stunden),
          }))
        );
      } else {
        setGeraete([]);
      }

      // Load materialien
      const { data: materialienData } = await supabase
        .from("leistungsbericht_materialien" as any)
        .select("*")
        .eq("bericht_id", id);

      if (materialienData && (materialienData as any[]).length > 0) {
        setMaterialien(
          (materialienData as any[]).map((m: any) => ({
            id: crypto.randomUUID(),
            bezeichnung: m.bezeichnung,
            menge: m.menge || "",
          }))
        );
      } else {
        setMaterialien([]);
      }

      // Scroll to top
      window.scrollTo({ top: 0, behavior: "smooth" });

      toast({
        title: "Bericht geladen",
        description: "Der Leistungsbericht wurde zum Bearbeiten geladen.",
      });
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Fehler",
        description: "Bericht konnte nicht geladen werden.",
      });
    }
  };

  // -------------------------------------------------------------------------
  // Delete Bericht
  // -------------------------------------------------------------------------
  const deleteBericht = async (id: string) => {
    if (!confirm("Diesen Leistungsbericht wirklich löschen?")) return;

    try {
      await supabase
        .from("leistungsbericht_stunden" as any)
        .delete()
        .eq("bericht_id", id);
      await supabase
        .from("leistungsbericht_mitarbeiter" as any)
        .delete()
        .eq("bericht_id", id);
      await supabase
        .from("leistungsbericht_taetigkeiten" as any)
        .delete()
        .eq("bericht_id", id);
      await supabase
        .from("leistungsbericht_geraete" as any)
        .delete()
        .eq("bericht_id", id);
      await supabase
        .from("leistungsbericht_materialien" as any)
        .delete()
        .eq("bericht_id", id);
      await supabase
        .from("leistungsberichte" as any)
        .delete()
        .eq("id", id);

      toast({ title: "Gelöscht", description: "Bericht wurde gelöscht." });
      loadBerichte();

      if (editingBerichtId === id) resetForm();
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Fehler",
        description: "Bericht konnte nicht gelöscht werden.",
      });
    }
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <PageHeader title="Leistungsbericht" />
        <div className="container mx-auto px-3 sm:px-4 lg:px-6 py-6">
          <p className="text-muted-foreground">Laden...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <PageHeader title="Leistungsbericht" />

      <div className="container mx-auto px-3 sm:px-4 lg:px-6 py-4 sm:py-6 space-y-6 max-w-5xl">
        {/* ---------- HEADER ---------- */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <CardTitle className="text-xl sm:text-2xl">
                  Leistungsbericht
                </CardTitle>
                <p className="text-sm text-red-600 font-medium mt-1">
                  Der Leistungsbericht ist täglich abzugeben!
                </p>
              </div>
              <div className="flex items-center gap-2">
                {editingBerichtId && (
                  <Badge variant="secondary" className="text-xs">
                    Bearbeiten
                  </Badge>
                )}
                <Input
                  type="date"
                  value={datum}
                  onChange={(e) => setDatum(e.target.value)}
                  className="w-auto"
                />
              </div>
            </div>
          </CardHeader>
        </Card>

        {/* ---------- BAUVORHABEN ---------- */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Bauvorhaben</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Projekt *</Label>
                <div className="flex gap-2">
                  <Select value={projektId} onValueChange={setProjektId}>
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="Projekt auswählen..." />
                    </SelectTrigger>
                    <SelectContent>
                      {projects.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="shrink-0 h-10 w-10"
                    onClick={() => setShowNewProjectDialog(true)}
                    title="Neues Projekt erstellen"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Ort</Label>
                <Input
                  value={
                    selectedProject
                      ? `${selectedProject.plz} ${selectedProject.adresse || ""}`
                      : ""
                  }
                  readOnly
                  className="bg-muted"
                  placeholder="Wird automatisch ausgefüllt"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Objekt</Label>
              <Input
                value={objekt}
                onChange={(e) => setObjekt(e.target.value)}
                placeholder="z.B. Umbau, Fassade, Dachverlängerung..."
              />
            </div>
          </CardContent>
        </Card>

        {/* ---------- ZEITANGABEN ---------- */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Zeitangaben</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="space-y-2">
                <Label>Ankunft Baustelle</Label>
                <Input
                  type="time"
                  value={ankunftZeit}
                  onChange={(e) => setAnkunftZeit(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Abfahrt Baustelle</Label>
                <Input
                  type="time"
                  value={abfahrtZeit}
                  onChange={(e) => setAbfahrtZeit(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Pause von</Label>
                <Input
                  type="time"
                  value={pauseVon}
                  onChange={(e) => setPauseVon(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Pause bis</Label>
                <Input
                  type="time"
                  value={pauseBis}
                  onChange={(e) => setPauseBis(e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 items-end">
              <div className="space-y-2">
                <Label>Pause</Label>
                <div className="flex items-center h-10 px-3 rounded-md border bg-muted text-sm">
                  {pauseMinuten} Minuten
                </div>
              </div>
              <div className="space-y-2">
                <Label>Wetter</Label>
                <Input
                  value={wetter}
                  onChange={(e) => setWetter(e.target.value)}
                  placeholder="z.B. sonnig, Regen..."
                />
              </div>
            </div>

            {/* Normalarbeitszeit banner */}
            <div className="rounded-md bg-red-50 border border-red-200 p-3">
              <p className="text-xs sm:text-sm text-red-700 font-medium">
                Normalarbeitszeit Mo–Do 7–16 Uhr = 9 Std. – 1 Std. Pause = 8
                Std. &nbsp;&nbsp; Fr 7–15 Uhr = 8 Std. – 1 Std. Pause = 7 Std.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* ---------- TAETIGKEITEN ---------- */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">Tätigkeiten</CardTitle>
              {taetigkeiten.length < 8 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={addTaetigkeit}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Zeile
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {taetigkeiten.map((t) => (
              <div key={t.position} className="flex items-center gap-2">
                <span className="w-8 text-center font-mono text-sm font-bold text-muted-foreground shrink-0">
                  {t.position}.
                </span>
                {t.position === 1 ? (
                  <Input
                    value={t.bezeichnung}
                    onChange={(e) => updateTaetigkeit(t.position, e.target.value)}
                    placeholder={pos1Text}
                    className="flex-1"
                  />
                ) : (
                  <Input
                    value={t.bezeichnung}
                    onChange={(e) =>
                      updateTaetigkeit(t.position, e.target.value)
                    }
                    placeholder={`Tätigkeit ${t.position}...`}
                    className="flex-1"
                  />
                )}
                {taetigkeiten.length > 1 && t.position > 1 && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="shrink-0 h-8 w-8 text-muted-foreground hover:text-destructive"
                    onClick={() => removeTaetigkeit(t.position)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}

            {/* Auto-displayed Pause info */}
            <div className="flex items-center gap-2 opacity-60">
              <span className="w-8 text-center font-mono text-sm font-bold text-muted-foreground shrink-0">
                +
              </span>
              <div className="flex-1 text-sm px-3 py-2 rounded-md bg-muted border">
                {pauseText}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ---------- MITARBEITER & STUNDEN MATRIX ---------- */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">
                Mitarbeiter & Stunden
              </CardTitle>
              <Button variant="outline" size="sm" onClick={openMitarbeiterDialog}>
                <Plus className="h-4 w-4 mr-1" />
                Mitarbeiter
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {/* Schmutzzulage & Regen toggles */}
            <div className="flex flex-wrap items-center gap-4 mb-4">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="schmutzzulage-alle"
                  checked={schmutzzulageAlle}
                  onCheckedChange={(v) => setSchmutzzulageAlle(v === true)}
                />
                <Label htmlFor="schmutzzulage-alle" className="text-sm cursor-pointer">
                  Schmutzzulage für alle
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="regen-alle"
                  checked={regenSchichtAlle}
                  onCheckedChange={(v) => setRegenSchichtAlle(v === true)}
                />
                <Label htmlFor="regen-alle" className="text-sm cursor-pointer">
                  Regen für alle
                </Label>
              </div>
            </div>

            {/* Gleiche Stunden toggle */}
            <div className="flex items-center gap-3 mb-4">
              <Switch
                id="gleiche-stunden"
                checked={gleicheStundenFuerAlle}
                onCheckedChange={setGleicheStundenFuerAlle}
              />
              <Label htmlFor="gleiche-stunden" className="text-sm cursor-pointer">
                Stunden für alle Mitarbeiter gleich übernehmen
              </Label>
            </div>

            {/* F/W/S/R Legende */}
            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground mt-2 mb-4">
              <span><strong>F</strong> = Fahrer</span>
              <span><strong>W</strong> = Werkstatt</span>
              <span><strong>S</strong> = Schmutzzulage</span>
              <span><strong>R</strong> = Regen/Wetterschicht</span>
            </div>

            {/* Scrollable matrix table */}
            <div className="overflow-x-auto -mx-4 sm:-mx-6 px-4 sm:px-6">
              <table className="w-full text-sm border-collapse min-w-[600px]">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="sticky left-0 z-10 bg-muted/50 text-left px-2 py-2 font-medium whitespace-nowrap min-w-[160px]">
                      Name
                    </th>
                    <th className="px-1 py-2 font-medium text-center min-w-[50px]" title="Fahrer">
                      F
                    </th>
                    <th className="px-1 py-2 font-medium text-center min-w-[50px]" title="Werkstatt">
                      W
                    </th>
                    <th className="px-1 py-2 font-medium text-center min-w-[50px]" title="Schmutzzulage">
                      S
                    </th>
                    <th className="px-1 py-2 font-medium text-center min-w-[50px]" title="Regen/Wetterschicht">
                      R
                    </th>
                    {taetigkeiten.map((t) => (
                      <th
                        key={t.position}
                        className="px-1 py-2 font-medium text-center w-16"
                        title={
                          t.bezeichnung ||
                          (t.position === 1 ? pos1Text : `Tätigkeit ${t.position}`)
                        }
                      >
                        {t.position}
                      </th>
                    ))}
                    <th className="px-2 py-2 font-medium text-center whitespace-nowrap min-w-[80px]">
                      Summe
                    </th>
                    <th className="px-1 py-2 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {mitarbeiterRows.map((row) => {
                    const total = sumStunden(row);
                    return (
                      <tr key={row.id} className="border-b hover:bg-muted/30">
                        {/* Name select */}
                        <td className="sticky left-0 z-10 bg-card px-2 py-1.5">
                          <Select
                            value={row.mitarbeiterId}
                            onValueChange={(v) =>
                              updateMitarbeiterField(row.id, "mitarbeiterId", v)
                            }
                          >
                            <SelectTrigger className="h-9 text-sm">
                              <SelectValue placeholder="Mitarbeiter..." />
                            </SelectTrigger>
                            <SelectContent>
                              {profiles.map((p) => (
                                <SelectItem key={p.id} value={p.id}>
                                  {p.nachname} {p.vorname}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                        {/* F - Fahrer */}
                        <td className="px-1 py-1.5 text-center">
                          <div className="flex items-center justify-center gap-0.5">
                            <Checkbox
                              checked={row.istFahrer}
                              onCheckedChange={(v) =>
                                updateMitarbeiterField(
                                  row.id,
                                  "istFahrer",
                                  v === true
                                )
                              }
                            />
                            {row.istFahrer && (
                              <Input
                                type="number"
                                step="0.25"
                                min="0"
                                inputMode="decimal"
                                className="h-7 w-12 text-center text-xs px-0.5"
                                value={row.fahrerStunden}
                                onChange={(e) =>
                                  updateMitarbeiterField(row.id, "fahrerStunden", e.target.value)
                                }
                                placeholder="alle"
                              />
                            )}
                          </div>
                        </td>
                        {/* W - Werkstatt */}
                        <td className="px-1 py-1.5 text-center">
                          <div className="flex items-center justify-center gap-0.5">
                            <Checkbox
                              checked={row.istWerkstatt}
                              onCheckedChange={(v) =>
                                updateMitarbeiterField(
                                  row.id,
                                  "istWerkstatt",
                                  v === true
                                )
                              }
                            />
                            {row.istWerkstatt && (
                              <Input
                                type="number"
                                step="0.25"
                                min="0"
                                inputMode="decimal"
                                className="h-7 w-12 text-center text-xs px-0.5"
                                value={row.werkstattStunden}
                                onChange={(e) =>
                                  updateMitarbeiterField(row.id, "werkstattStunden", e.target.value)
                                }
                                placeholder="alle"
                              />
                            )}
                          </div>
                        </td>
                        {/* S - Schmutzzulage */}
                        <td className="px-1 py-1.5 text-center">
                          <div className="flex items-center justify-center gap-0.5">
                            <Checkbox
                              checked={row.schmutzzulage}
                              onCheckedChange={(v) =>
                                updateMitarbeiterField(
                                  row.id,
                                  "schmutzzulage",
                                  v === true
                                )
                              }
                            />
                            {row.schmutzzulage && (
                              <Input
                                type="number"
                                step="0.25"
                                min="0"
                                inputMode="decimal"
                                className="h-7 w-12 text-center text-xs px-0.5"
                                value={row.schmutzzulageStunden}
                                onChange={(e) =>
                                  updateMitarbeiterField(row.id, "schmutzzulageStunden", e.target.value)
                                }
                                placeholder="alle"
                              />
                            )}
                          </div>
                        </td>
                        {/* R - Regen/Wetterschicht */}
                        <td className="px-1 py-1.5 text-center">
                          <div className="flex items-center justify-center gap-0.5">
                            <Checkbox
                              checked={row.regenSchicht}
                              onCheckedChange={(v) =>
                                updateMitarbeiterField(
                                  row.id,
                                  "regenSchicht",
                                  v === true
                                )
                              }
                            />
                            {row.regenSchicht && (
                              <Input
                                type="number"
                                step="0.25"
                                min="0"
                                inputMode="decimal"
                                className="h-7 w-12 text-center text-xs px-0.5"
                                value={row.regenStunden}
                                onChange={(e) =>
                                  updateMitarbeiterField(row.id, "regenStunden", e.target.value)
                                }
                                placeholder="alle"
                              />
                            )}
                          </div>
                        </td>
                        {/* Hours per activity */}
                        {taetigkeiten.map((t) => (
                          <td key={t.position} className="px-1 py-1.5 text-center">
                            <Input
                              type="number"
                              inputMode="decimal"
                              step="0.25"
                              min="0"
                              max="24"
                              className="h-9 w-16 text-center text-sm px-1"
                              value={row.stunden[t.position] || ""}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value) || 0;
                                updateMitarbeiterStunden(
                                  row.id,
                                  t.position,
                                  val
                                );
                              }}
                              placeholder="–"
                            />
                          </td>
                        ))}
                        {/* Sum */}
                        <td className="px-2 py-1.5 text-center font-semibold">
                          <div
                            className={`rounded px-2 py-1 ${
                              total > 0
                                ? "bg-green-100 text-green-800"
                                : "text-muted-foreground"
                            }`}
                          >
                            {total > 0 ? total.toFixed(2) : "–"}
                          </div>
                        </td>
                        {/* Remove */}
                        <td className="px-1 py-1.5 text-center">
                          {mitarbeiterRows.length > 1 && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-destructive"
                              onClick={() => removeMitarbeiter(row.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2">
                    <td
                      colSpan={5 + taetigkeiten.length}
                      className="px-2 py-2 text-right font-semibold"
                    >
                      Gesamtsumme Arbeitsstunden:
                    </td>
                    <td className="px-2 py-2 text-center font-bold text-lg">
                      {gesamtStunden.toFixed(2)}
                    </td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* ---------- ZUSÄTZLICHE ANGABEN (einklappbar) ---------- */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Zusätzliche Angaben</CardTitle>
            <p className="text-sm text-muted-foreground">Geräteeinsatz, Materialien, Anmerkungen</p>
          </CardHeader>
          <CardContent>
            <Accordion type="multiple" className="w-full">
              {/* Geräteeinsatz */}
              <AccordionItem value="geraete">
                <AccordionTrigger className="text-sm font-medium py-2">
                  Geräteeinsatz {geraete.length > 0 && <Badge variant="secondary" className="ml-2 text-xs">{geraete.length}</Badge>}
                </AccordionTrigger>
                <AccordionContent className="space-y-2 pb-4">
                  <p className="text-xs text-muted-foreground mb-2">LKW, Kran (in Stunden)</p>
                  {geraete.map((g) => (
                    <div key={g.id} className="flex items-center gap-2">
                      {!GERAETE_OPTIONEN.includes(g.geraet) && g.geraet !== "" ? (
                        <Input
                          value={g.geraet.trim()}
                          onChange={(e) =>
                            setGeraete((prev) =>
                              prev.map((item) =>
                                item.id === g.id ? { ...item, geraet: e.target.value } : item
                              )
                            )
                          }
                          placeholder="Gerät eingeben..."
                          className="flex-1"
                        />
                      ) : (
                        <Select
                          value={g.geraet}
                          onValueChange={(v) =>
                            setGeraete((prev) =>
                              prev.map((item) =>
                                item.id === g.id ? { ...item, geraet: v === "Sonstiges" ? " " : v } : item
                              )
                            )
                          }
                        >
                          <SelectTrigger className="flex-1">
                            <SelectValue placeholder="Gerät auswählen..." />
                          </SelectTrigger>
                          <SelectContent>
                            {GERAETE_OPTIONEN.map((opt) => (
                              <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                      <Input
                        type="number" step="0.5" min="0"
                        value={g.stunden}
                        onChange={(e) =>
                          setGeraete((prev) =>
                            prev.map((item) => item.id === g.id ? { ...item, stunden: e.target.value } : item)
                          )
                        }
                        placeholder="Std."
                        className="w-20"
                      />
                      <Button variant="ghost" size="icon" className="shrink-0 h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => setGeraete((prev) => prev.filter((item) => item.id !== g.id))}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                  <Button variant="outline" size="sm"
                    onClick={() => setGeraete((prev) => [...prev, { id: crypto.randomUUID(), geraet: "", stunden: "" }])}
                  >
                    <Plus className="h-4 w-4 mr-1" /> Gerät
                  </Button>
                </AccordionContent>
              </AccordionItem>

              {/* Materialien */}
              <AccordionItem value="materialien">
                <AccordionTrigger className="text-sm font-medium py-2">
                  Verbrauchte Materialien {materialien.length > 0 && <Badge variant="secondary" className="ml-2 text-xs">{materialien.length}</Badge>}
                </AccordionTrigger>
                <AccordionContent className="space-y-2 pb-4">
                  {materialien.map((m) => (
                    <div key={m.id} className="flex items-center gap-2">
                      <Input value={m.bezeichnung}
                        onChange={(e) => setMaterialien((prev) => prev.map((item) => item.id === m.id ? { ...item, bezeichnung: e.target.value } : item))}
                        placeholder="Bezeichnung..." className="flex-1"
                      />
                      <Input value={m.menge}
                        onChange={(e) => setMaterialien((prev) => prev.map((item) => item.id === m.id ? { ...item, menge: e.target.value } : item))}
                        placeholder="Menge" className="w-24"
                      />
                      <Button variant="ghost" size="icon" className="shrink-0 h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => setMaterialien((prev) => prev.filter((item) => item.id !== m.id))}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                  <Button variant="outline" size="sm"
                    onClick={() => setMaterialien((prev) => [...prev, { id: crypto.randomUUID(), bezeichnung: "", menge: "" }])}
                  >
                    <Plus className="h-4 w-4 mr-1" /> Material
                  </Button>
                </AccordionContent>
              </AccordionItem>

              {/* Anmerkungen */}
              <AccordionItem value="anmerkungen">
                <AccordionTrigger className="text-sm font-medium py-2">
                  Anmerkungen {anmerkungen && <Badge variant="secondary" className="ml-2 text-xs">1</Badge>}
                </AccordionTrigger>
                <AccordionContent className="pb-4">
                  <Textarea rows={3} value={anmerkungen}
                    onChange={(e) => setAnmerkungen(e.target.value)}
                    placeholder="Anmerkungen zum Leistungsbericht..."
                  />
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </CardContent>
        </Card>

        {/* ---------- BAUVORHABEN FERTIGGESTELLT ---------- */}
        <div className="flex items-center gap-2">
          <Checkbox
            id="fertiggestellt"
            checked={fertiggestellt}
            onCheckedChange={(v) => setFertiggestellt(v === true)}
          />
          <Label htmlFor="fertiggestellt" className="text-sm cursor-pointer font-medium">
            Bauvorhaben fertiggestellt
          </Label>
        </div>

        {/* ---------- SICHERHEITSHINWEIS ---------- */}
        <Card className="bg-muted">
          <CardContent className="pt-4">
            <div className="flex items-start gap-3">
              <Info className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
              <p className="text-sm text-muted-foreground">
                Maßnahmen gemäß § 14 ASchG &amp; BauV § 154 sowie Hinweis zur Verwendung von Persönlicher Schutzausrüstung zur Kenntnis genommen!
              </p>
            </div>
          </CardContent>
        </Card>

        {/* ---------- SUBMIT ---------- */}
        <div className="flex flex-col sm:flex-row gap-3">
          <Button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 sm:flex-none"
            size="lg"
          >
            <Save className="h-5 w-5 mr-2" />
            {saving
              ? "Speichern..."
              : editingBerichtId
              ? "Bericht aktualisieren"
              : "Leistungsbericht speichern"}
          </Button>
          {editingBerichtId && (
            <Button variant="outline" size="lg" onClick={resetForm}>
              Abbrechen
            </Button>
          )}
        </div>

        {/* ---------- EXISTING REPORTS ---------- */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Bisherige Leistungsberichte
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loadingBerichte ? (
              <p className="text-sm text-muted-foreground">Laden...</p>
            ) : existingBerichte.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Noch keine Leistungsberichte vorhanden.
              </p>
            ) : (
              <div className="space-y-2">
                {existingBerichte.map((b) => (
                  <div
                    key={b.id}
                    className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                  >
                    <div
                      className="flex-1 cursor-pointer"
                      onClick={() => loadBericht(b.id)}
                    >
                      <div className="flex items-center gap-3 flex-wrap">
                        <div className="flex items-center gap-1.5">
                          <CalendarDays className="h-4 w-4 text-muted-foreground" />
                          <span className="font-medium">
                            {format(new Date(b.datum), "dd.MM.yyyy", {
                              locale: de,
                            })}
                          </span>
                        </div>
                        <Badge variant="outline">{b.projekt_name}</Badge>
                        <div className="flex items-center gap-1 text-sm text-muted-foreground">
                          <Users className="h-3.5 w-3.5" />
                          {b.mitarbeiter_count}
                        </div>
                        <span className="text-sm font-medium">
                          {b.total_stunden.toFixed(1)} Std.
                        </span>
                      </div>
                    </div>
                    {isAdmin && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteBericht(b.id);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ---------- MITARBEITER AUSWAHL DIALOG ---------- */}
      <Dialog open={showMitarbeiterDialog} onOpenChange={setShowMitarbeiterDialog}>
        <DialogContent className="sm:max-w-md max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Mitarbeiter hinzufügen</DialogTitle>
          </DialogHeader>
          <div className="flex items-center gap-2 mb-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const allIds = new Set(
                  profiles
                    .filter((p) => !alreadyAddedMitarbeiterIds.has(p.id))
                    .map((p) => p.id)
                );
                setSelectedNewMitarbeiter(allIds);
              }}
            >
              Alle auswählen
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelectedNewMitarbeiter(new Set())}
            >
              Alle abwählen
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto space-y-1 pr-1">
            {profiles.map((p) => {
              const alreadyAdded = alreadyAddedMitarbeiterIds.has(p.id);
              const isSelected = alreadyAdded || selectedNewMitarbeiter.has(p.id);
              return (
                <label
                  key={p.id}
                  className={`flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer hover:bg-muted/50 ${
                    alreadyAdded ? "opacity-50 cursor-not-allowed" : ""
                  }`}
                >
                  <Checkbox
                    checked={isSelected}
                    disabled={alreadyAdded}
                    onCheckedChange={(checked) => {
                      if (alreadyAdded) return;
                      setSelectedNewMitarbeiter((prev) => {
                        const next = new Set(prev);
                        if (checked) {
                          next.add(p.id);
                        } else {
                          next.delete(p.id);
                        }
                        return next;
                      });
                    }}
                  />
                  <span className="text-sm">
                    {p.nachname} {p.vorname}
                    {alreadyAdded && (
                      <span className="ml-2 text-xs text-muted-foreground">(bereits hinzugefügt)</span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setShowMitarbeiterDialog(false)}>
              Abbrechen
            </Button>
            <Button onClick={handleAddSelectedMitarbeiter} disabled={selectedNewMitarbeiter.size === 0}>
              {selectedNewMitarbeiter.size > 0
                ? `${selectedNewMitarbeiter.size} Mitarbeiter hinzufügen`
                : "Hinzufügen"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Neues Projekt Dialog */}
      <Dialog open={showNewProjectDialog} onOpenChange={setShowNewProjectDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Neues Projekt erstellen</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Projektname *</Label>
              <Input
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                placeholder="z.B. Schönlieb, VS-Rosegg..."
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label>PLZ *</Label>
              <Input
                value={newProjectPlz}
                onChange={(e) => setNewProjectPlz(e.target.value)}
                placeholder="z.B. 9072"
                inputMode="numeric"
              />
            </div>
            <div className="space-y-2">
              <Label>Adresse</Label>
              <Input
                value={newProjectAdresse}
                onChange={(e) => setNewProjectAdresse(e.target.value)}
                placeholder="Straße, Ort (optional)"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowNewProjectDialog(false)}>
              Abbrechen
            </Button>
            <Button onClick={handleCreateProject} disabled={creatingProject}>
              {creatingProject ? "Erstellt..." : "Projekt erstellen"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default TimeTracking;
