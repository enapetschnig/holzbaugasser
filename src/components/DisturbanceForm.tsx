import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Calendar, Clock, User, Mail, Phone, MapPin, FileText, Package, Plus, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

type MaterialEntry = {
  id: string;
  material: string;
  menge: string;
};

type DisturbanceFormProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  editData?: {
    id: string;
    datum: string;
    start_time: string;
    end_time: string;
    pause_minutes: number;
    pause_start: string | null;
    pause_end: string | null;
    kunde_name: string;
    kunde_email: string | null;
    kunde_adresse: string | null;
    kunde_telefon: string | null;
    beschreibung: string;
    notizen: string | null;
  } | null;
};

export const DisturbanceForm = ({ open, onOpenChange, onSuccess, editData }: DisturbanceFormProps) => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);

  const [formData, setFormData] = useState({
    datum: format(new Date(), "yyyy-MM-dd"),
    startTime: "08:00",
    endTime: "10:00",
    pauseStart: "",
    pauseEnd: "",
    kundeName: "",
    kundeEmail: "",
    kundeAdresse: "",
    kundeTelefon: "",
    beschreibung: "",
    notizen: "",
  });

  const [materials, setMaterials] = useState<MaterialEntry[]>([]);

  useEffect(() => {
    if (editData) {
      setFormData({
        datum: editData.datum,
        startTime: editData.start_time.slice(0, 5),
        endTime: editData.end_time.slice(0, 5),
        pauseStart: editData.pause_start?.slice(0, 5) || "",
        pauseEnd: editData.pause_end?.slice(0, 5) || "",
        kundeName: editData.kunde_name,
        kundeEmail: editData.kunde_email || "",
        kundeAdresse: editData.kunde_adresse || "",
        kundeTelefon: editData.kunde_telefon || "",
        beschreibung: editData.beschreibung,
        notizen: editData.notizen || "",
      });
      // Load existing materials when editing
      loadExistingMaterials(editData.id);
    } else {
      // Reset form for new entry
      setFormData({
        datum: format(new Date(), "yyyy-MM-dd"),
        startTime: "08:00",
        endTime: "10:00",
        pauseStart: "",
        pauseEnd: "",
        kundeName: "",
        kundeEmail: "",
        kundeAdresse: "",
        kundeTelefon: "",
        beschreibung: "",
        notizen: "",
      });
      setMaterials([]);
    }
  }, [editData, open]);

  const loadExistingMaterials = async (disturbanceId: string) => {
    const { data } = await supabase
      .from("disturbance_materials")
      .select("id, material, menge")
      .eq("disturbance_id", disturbanceId);
    
    if (data) {
      setMaterials(data.map(m => ({
        id: m.id,
        material: m.material,
        menge: m.menge || "",
      })));
    }
  };

  const calculatePauseMinutes = (): number => {
    if (!formData.pauseStart || !formData.pauseEnd) return 0;
    const [sh, sm] = formData.pauseStart.split(":").map(Number);
    const [eh, em] = formData.pauseEnd.split(":").map(Number);
    return Math.max(0, (eh * 60 + em) - (sh * 60 + sm));
  };

  const calculateHours = (): number => {
    const [startH, startM] = formData.startTime.split(":").map(Number);
    const [endH, endM] = formData.endTime.split(":").map(Number);
    const totalMinutes = (endH * 60 + endM) - (startH * 60 + startM) - calculatePauseMinutes();
    return Math.max(0, totalMinutes / 60);
  };

  const addMaterial = () => {
    setMaterials([...materials, { id: crypto.randomUUID(), material: "", menge: "" }]);
  };

  const removeMaterial = (id: string) => {
    setMaterials(materials.filter(m => m.id !== id));
  };

  const updateMaterial = (id: string, field: "material" | "menge", value: string) => {
    setMaterials(materials.map(m => m.id === id ? { ...m, [field]: value } : m));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      toast({ variant: "destructive", title: "Fehler", description: "Sie müssen angemeldet sein" });
      setSaving(false);
      return;
    }

    // Validation
    if (!formData.kundeName.trim()) {
      toast({ variant: "destructive", title: "Fehler", description: "Kundenname ist erforderlich" });
      setSaving(false);
      return;
    }

    if (!formData.beschreibung.trim()) {
      toast({ variant: "destructive", title: "Fehler", description: "Arbeitsbeschreibung ist erforderlich" });
      setSaving(false);
      return;
    }

    const [startH, startM] = formData.startTime.split(":").map(Number);
    const [endH, endM] = formData.endTime.split(":").map(Number);
    if (endH * 60 + endM <= startH * 60 + startM) {
      toast({ variant: "destructive", title: "Fehler", description: "Endzeit muss nach Startzeit liegen" });
      setSaving(false);
      return;
    }

    // Check for overlapping time entries on the same day
    const toMin = (t: string) => { const [h, m] = t.slice(0, 5).split(":").map(Number); return h * 60 + m; };
    const newStart = toMin(formData.startTime);
    const newEnd   = toMin(formData.endTime);

    let overlapQuery = supabase
      .from("time_entries")
      .select("id, start_time, end_time, taetigkeit, disturbance_id")
      .eq("user_id", user.id)
      .eq("datum", formData.datum);

    if (editData) {
      // Exclude time entries belonging to the disturbance being edited
      overlapQuery = overlapQuery.or(`disturbance_id.is.null,disturbance_id.neq.${editData.id}`);
    }

    const { data: existingEntries } = await overlapQuery;
    const conflict = existingEntries?.find(e => {
      const s = toMin(e.start_time);
      const en = toMin(e.end_time);
      return newStart < en && newEnd > s;
    });

    if (conflict) {
      toast({
        variant: "destructive",
        title: "Zeitüberschneidung",
        description: `Es existiert bereits ein Eintrag von ${conflict.start_time.slice(0, 5)} bis ${conflict.end_time.slice(0, 5)} Uhr an diesem Tag.`,
      });
      setSaving(false);
      return;
    }

    const stunden = calculateHours();

    const disturbanceData = {
      user_id: user.id,
      datum: formData.datum,
      start_time: formData.startTime,
      end_time: formData.endTime,
      pause_minutes: calculatePauseMinutes(),
      stunden,
      kunde_name: formData.kundeName.trim(),
      kunde_email: formData.kundeEmail.trim() || null,
      kunde_adresse: formData.kundeAdresse.trim() || null,
      kunde_telefon: formData.kundeTelefon.trim() || null,
      beschreibung: formData.beschreibung.trim(),
      notizen: formData.notizen.trim() || null,
    };

    if (editData) {
      // Update existing
      const { error } = await supabase
        .from("disturbances")
        .update(disturbanceData)
        .eq("id", editData.id);

      if (error) {
        toast({ variant: "destructive", title: "Fehler", description: "Regiebericht konnte nicht aktualisiert werden" });
        setSaving(false);
        return;
      }

      // Update time entries for all workers
      const timeOk = await updateTimeEntriesForAllWorkers(editData.id, user.id, stunden);
      if (!timeOk) { setSaving(false); return; }

      // Update materials
      const matOk = await updateMaterials(editData.id, user.id);
      if (!matOk) { setSaving(false); return; }

      toast({ title: "Erfolg", description: "Regiebericht wurde aktualisiert" });
    } else {
      // Create new disturbance
      const { data: newDisturbance, error } = await supabase
        .from("disturbances")
        .insert(disturbanceData)
        .select()
        .single();

      if (error) {
        toast({ variant: "destructive", title: "Fehler", description: "Regiebericht konnte nicht erstellt werden" });
        setSaving(false);
        return;
      }

      // Create time entry for current user
      const { error: timeError } = await supabase.from("time_entries").insert({
        user_id: user.id,
        datum: formData.datum,
        start_time: formData.startTime,
        end_time: formData.endTime,
        pause_minutes: calculatePauseMinutes(),
        stunden,
        project_id: null,
        disturbance_id: newDisturbance.id,
        taetigkeit: `Regiebericht: ${formData.kundeName.trim()}`,
        location_type: "baustelle",
      });
      if (timeError) {
        toast({ variant: "destructive", title: "Fehler", description: "Zeiteintrag konnte nicht erstellt werden" });
        setSaving(false);
        return;
      }

      // Add main worker entry
      const { error: workerError } = await supabase.from("disturbance_workers").insert({
        disturbance_id: newDisturbance.id,
        user_id: user.id,
        is_main: true,
      });
      if (workerError) {
        toast({ variant: "destructive", title: "Fehler", description: "Mitarbeiter-Eintrag konnte nicht erstellt werden" });
        setSaving(false);
        return;
      }

      // Create materials
      const validMaterials = materials.filter(m => m.material.trim());
      if (validMaterials.length > 0) {
        const { error: matError } = await supabase.from("disturbance_materials").insert(
          validMaterials.map(m => ({
            disturbance_id: newDisturbance.id,
            user_id: user.id,
            material: m.material.trim(),
            menge: m.menge.trim() || null,
          }))
        );
        if (matError) {
          toast({ variant: "destructive", title: "Fehler", description: "Materialien konnten nicht gespeichert werden" });
          setSaving(false);
          return;
        }
      }

      toast({ title: "Erfolg", description: "Regiebericht wurde erfasst" });
      
      setSaving(false);
      onOpenChange(false);
      
      // Navigate to detail page with signature dialog open
      navigate(`/disturbances/${newDisturbance.id}?openSignature=true`);
      return;
    }

    setSaving(false);
    onSuccess();
  };

  const updateTimeEntriesForAllWorkers = async (disturbanceId: string, mainUserId: string, stunden: number): Promise<boolean> => {
    const { error } = await supabase
      .from("time_entries")
      .update({
        datum: formData.datum,
        start_time: formData.startTime,
        end_time: formData.endTime,
        pause_minutes: calculatePauseMinutes(),
        stunden,
        taetigkeit: `Regiebericht: ${formData.kundeName.trim()}`,
      })
      .eq("disturbance_id", disturbanceId);
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: "Zeiteinträge konnten nicht aktualisiert werden" });
      return false;
    }
    return true;
  };

  const updateMaterials = async (disturbanceId: string, userId: string): Promise<boolean> => {
    const { error: delError } = await supabase
      .from("disturbance_materials")
      .delete()
      .eq("disturbance_id", disturbanceId);
    if (delError) {
      toast({ variant: "destructive", title: "Fehler", description: "Materialien konnten nicht aktualisiert werden" });
      return false;
    }

    const validMaterials = materials.filter(m => m.material.trim());
    if (validMaterials.length > 0) {
      const { error: insError } = await supabase.from("disturbance_materials").insert(
        validMaterials.map(m => ({
          disturbance_id: disturbanceId,
          user_id: userId,
          material: m.material.trim(),
          menge: m.menge.trim() || null,
        }))
      );
      if (insError) {
        toast({ variant: "destructive", title: "Fehler", description: "Materialien konnten nicht gespeichert werden" });
        return false;
      }
    }
    return true;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            {editData ? "Regiebericht bearbeiten" : "Neuen Regiebericht erfassen"}
          </DialogTitle>
          <DialogDescription>
            Erfassen Sie einen Service-Einsatz beim Kunden.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto pr-1">
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Date and Time Section */}
          <div className="space-y-4">
            <h3 className="font-medium flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              Datum & Uhrzeit
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <Label htmlFor="datum">Datum</Label>
                <Input
                  id="datum"
                  type="date"
                  value={formData.datum}
                  onChange={(e) => setFormData({ ...formData, datum: e.target.value })}
                  required
                />
              </div>
              <div>
                <Label htmlFor="startTime">Startzeit</Label>
                <Input
                  id="startTime"
                  type="time"
                  value={formData.startTime}
                  onChange={(e) => setFormData({ ...formData, startTime: e.target.value })}
                  required
                />
              </div>
              <div>
                <Label htmlFor="endTime">Endzeit</Label>
                <Input
                  id="endTime"
                  type="time"
                  value={formData.endTime}
                  onChange={(e) => setFormData({ ...formData, endTime: e.target.value })}
                  required
                />
              </div>
              <div>
                <Label htmlFor="pauseStart">Pause von</Label>
                <Input
                  id="pauseStart"
                  type="time"
                  value={formData.pauseStart}
                  onChange={(e) => setFormData({ ...formData, pauseStart: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="pauseEnd">Pause bis</Label>
                <Input
                  id="pauseEnd"
                  type="time"
                  value={formData.pauseEnd}
                  onChange={(e) => setFormData({ ...formData, pauseEnd: e.target.value })}
                />
              </div>
              {calculatePauseMinutes() > 0 && (
                <div className="flex items-end">
                  <p className="text-xs text-muted-foreground py-2">{calculatePauseMinutes()} Min. Pause</p>
                </div>
              )}
              <div className="flex items-end">
                <div className="bg-muted rounded-md px-3 py-2 w-full text-center">
                  <span className="text-sm text-muted-foreground">Stunden: </span>
                  <span className="font-bold text-primary">{calculateHours().toFixed(2)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Customer Section */}
          <div className="space-y-4">
            <h3 className="font-medium flex items-center gap-2">
              <User className="h-4 w-4" />
              Kundendaten
            </h3>
            <div className="space-y-3">
              <div>
                <Label htmlFor="kundeName">Kundenname *</Label>
                <Input
                  id="kundeName"
                  value={formData.kundeName}
                  onChange={(e) => setFormData({ ...formData, kundeName: e.target.value })}
                  placeholder="Max Mustermann"
                  required
                />
              </div>
              <div>
                <Label htmlFor="kundeEmail" className="flex items-center gap-1">
                  <Mail className="h-3 w-3" /> E-Mail (optional)
                </Label>
                <Input
                  id="kundeEmail"
                  type="email"
                  value={formData.kundeEmail}
                  onChange={(e) => setFormData({ ...formData, kundeEmail: e.target.value })}
                  placeholder="kunde@email.at"
                />
              </div>
              <div>
                <Label htmlFor="kundeTelefon" className="flex items-center gap-1">
                  <Phone className="h-3 w-3" /> Telefon (optional)
                </Label>
                <Input
                  id="kundeTelefon"
                  type="tel"
                  value={formData.kundeTelefon}
                  onChange={(e) => setFormData({ ...formData, kundeTelefon: e.target.value })}
                  placeholder="+43 664 ..."
                />
              </div>
              <div>
                <Label htmlFor="kundeAdresse" className="flex items-center gap-1">
                  <MapPin className="h-3 w-3" /> Adresse (optional)
                </Label>
                <Input
                  id="kundeAdresse"
                  value={formData.kundeAdresse}
                  onChange={(e) => setFormData({ ...formData, kundeAdresse: e.target.value })}
                  placeholder="Musterstraße 1, 9020 Klagenfurt"
                />
              </div>
            </div>
          </div>

          {/* Work Description Section */}
          <div className="space-y-4">
            <h3 className="font-medium flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Arbeitsdetails
            </h3>
            <div className="space-y-3">
              <div>
                <Label htmlFor="beschreibung">Durchgeführte Arbeit *</Label>
                <Textarea
                  id="beschreibung"
                  value={formData.beschreibung}
                  onChange={(e) => setFormData({ ...formData, beschreibung: e.target.value })}
                  placeholder="Beschreiben Sie die durchgeführten Arbeiten..."
                  rows={4}
                  required
                />
              </div>
              <div>
                <Label htmlFor="notizen">Notizen (optional)</Label>
                <Textarea
                  id="notizen"
                  value={formData.notizen}
                  onChange={(e) => setFormData({ ...formData, notizen: e.target.value })}
                  placeholder="Zusätzliche Bemerkungen..."
                  rows={2}
                />
              </div>
            </div>
          </div>

          {/* Materials Section */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-medium flex items-center gap-2">
                <Package className="h-4 w-4" />
                Verwendetes Material (optional)
              </h3>
              <Button type="button" variant="outline" size="sm" onClick={addMaterial}>
                <Plus className="h-4 w-4 mr-1" />
                Material
              </Button>
            </div>
            
            {materials.length > 0 && (
              <div className="space-y-2">
                {materials.map((mat) => (
                  <div key={mat.id} className="flex gap-2 items-start">
                    <Input
                      placeholder="Material"
                      value={mat.material}
                      onChange={(e) => updateMaterial(mat.id, "material", e.target.value)}
                      className="flex-1"
                    />
                    <Input
                      placeholder="Menge"
                      value={mat.menge}
                      onChange={(e) => updateMaterial(mat.id, "menge", e.target.value)}
                      className="w-24"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeMaterial(mat.id)}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </form>
        </div>

        {/* Sticky Actions */}
        <div className="flex gap-3 justify-end pt-4 border-t bg-background flex-shrink-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button onClick={(e) => { 
            e.preventDefault();
            const form = document.querySelector('form');
            if (form) form.requestSubmit();
          }} disabled={saving}>
            {saving ? "Speichern..." : editData ? "Aktualisieren" : "Regiebericht erfassen"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
