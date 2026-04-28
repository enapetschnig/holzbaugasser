import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ListChecks, Plus, Pencil, Trash2, Check, X, ChevronUp, ChevronDown } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

type Template = {
  id: string;
  bezeichnung: string;
  sort_order: number;
  is_active: boolean;
};

export default function TaetigkeitTemplatesManager() {
  const { toast } = useToast();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [newBezeichnung, setNewBezeichnung] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("taetigkeit_templates" as any)
      .select("id, bezeichnung, sort_order, is_active")
      .order("sort_order");
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
    } else {
      setTemplates((data as any[]) || []);
    }
    setLoading(false);
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const handleAdd = async () => {
    const bez = newBezeichnung.trim();
    if (!bez) return;
    setSaving(true);
    const maxOrder = templates.length > 0 ? Math.max(...templates.map((t) => t.sort_order)) : 0;
    const { error } = await supabase
      .from("taetigkeit_templates" as any)
      .insert({ bezeichnung: bez, sort_order: maxOrder + 10 });
    setSaving(false);
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
      return;
    }
    setNewBezeichnung("");
    toast({ title: "Hinzugefügt", description: bez });
    load();
  };

  const startEdit = (t: Template) => {
    setEditId(t.id);
    setEditValue(t.bezeichnung);
  };

  const saveEdit = async () => {
    if (!editId) return;
    const bez = editValue.trim();
    if (!bez) return;
    setSaving(true);
    const { error } = await supabase
      .from("taetigkeit_templates" as any)
      .update({ bezeichnung: bez, updated_at: new Date().toISOString() })
      .eq("id", editId);
    setSaving(false);
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
      return;
    }
    setEditId(null);
    setEditValue("");
    toast({ title: "Gespeichert" });
    load();
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setSaving(true);
    const { error } = await supabase
      .from("taetigkeit_templates" as any)
      .delete()
      .eq("id", deleteId);
    setSaving(false);
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
      return;
    }
    setDeleteId(null);
    toast({ title: "Gelöscht" });
    load();
  };

  const moveUp = async (idx: number) => {
    if (idx === 0) return;
    const a = templates[idx - 1];
    const b = templates[idx];
    await supabase.from("taetigkeit_templates" as any).update({ sort_order: b.sort_order }).eq("id", a.id);
    await supabase.from("taetigkeit_templates" as any).update({ sort_order: a.sort_order }).eq("id", b.id);
    load();
  };

  const moveDown = async (idx: number) => {
    if (idx >= templates.length - 1) return;
    const a = templates[idx];
    const b = templates[idx + 1];
    await supabase.from("taetigkeit_templates" as any).update({ sort_order: b.sort_order }).eq("id", a.id);
    await supabase.from("taetigkeit_templates" as any).update({ sort_order: a.sort_order }).eq("id", b.id);
    load();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ListChecks className="w-5 h-5" />
          Tätigkeits-Vorlagen
        </CardTitle>
        <CardDescription>
          Vorlagen für die Tätigkeits-Eingabe im Leistungsbericht. Jeder kann sie auswählen,
          oder einen eigenen Text tippen. Nur du als Admin kannst sie bearbeiten.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Add */}
        <div className="flex gap-2">
          <Input
            placeholder="Neue Tätigkeit hinzufügen..."
            value={newBezeichnung}
            onChange={(e) => setNewBezeichnung(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleAdd();
              }
            }}
            className="flex-1"
          />
          <Button onClick={handleAdd} disabled={saving || !newBezeichnung.trim()}>
            <Plus className="h-4 w-4 mr-1" />
            Hinzufügen
          </Button>
        </div>

        {/* List */}
        {loading ? (
          <div className="text-center text-sm text-muted-foreground py-4">Lade...</div>
        ) : templates.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-4">
            Noch keine Vorlagen.
          </div>
        ) : (
          <div className="space-y-1">
            {templates.map((t, idx) => (
              <div
                key={t.id}
                className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/50 border"
              >
                <span className="text-xs text-muted-foreground w-6 text-right shrink-0">
                  {idx + 1}.
                </span>
                {editId === t.id ? (
                  <>
                    <Input
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveEdit();
                        if (e.key === "Escape") {
                          setEditId(null);
                          setEditValue("");
                        }
                      }}
                      className="flex-1 h-8"
                      autoFocus
                    />
                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={saveEdit}>
                      <Check className="h-4 w-4 text-green-600" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      onClick={() => {
                        setEditId(null);
                        setEditValue("");
                      }}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </>
                ) : (
                  <>
                    <span className="flex-1 text-sm truncate">{t.bezeichnung}</span>
                    <div className="hidden sm:flex gap-0.5">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={() => moveUp(idx)}
                        disabled={idx === 0}
                        title="Nach oben"
                      >
                        <ChevronUp className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={() => moveDown(idx)}
                        disabled={idx >= templates.length - 1}
                        title="Nach unten"
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      onClick={() => startEdit(t)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => setDeleteId(t.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Delete confirm */}
        <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Vorlage löschen?</AlertDialogTitle>
              <AlertDialogDescription>
                {templates.find((t) => t.id === deleteId)?.bezeichnung}
                <br />
                <br />
                Bestehende Leistungsberichte mit dieser Tätigkeit bleiben unverändert
                — die Vorlage steht nur nicht mehr zur Auswahl bereit.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Abbrechen</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={handleDelete}
              >
                Löschen
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
