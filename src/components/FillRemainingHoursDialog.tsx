import { useState, useEffect, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Clock } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

type Project = {
  id: string;
  name: string;
  plz: string;
};

type ExistingEntry = {
  start_time: string;
  end_time: string;
  stunden: number;
};

interface BlockFormData {
  locationType: "baustelle" | "werkstatt";
  projectId: string;
  description: string;
}

interface FillRemainingHoursDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  remainingHours: number;
  bookedHours: number;
  targetHours: number;
  projects: Project[];
  existingEntries: ExistingEntry[];
  onSubmit: (projectId: string | null, locationType: string, description: string, startTime: string, endTime: string, pauseMinutes: number, pauseStart: string | null, pauseEnd: string | null) => Promise<void>;
}

function calculateFreeBlocks(existingEntries: ExistingEntry[]): { start: number; end: number }[] {
  const DAY_START = 8 * 60;
  const DAY_END = 17 * 60;

  const occupied: { start: number; end: number }[] = [];

  for (const entry of existingEntries) {
    const [sh, sm] = entry.start_time.split(":").map(Number);
    const [eh, em] = entry.end_time.split(":").map(Number);
    occupied.push({ start: sh * 60 + sm, end: eh * 60 + em });
  }
  occupied.sort((a, b) => a.start - b.start);

  const merged: { start: number; end: number }[] = [];
  for (const interval of occupied) {
    if (merged.length > 0 && interval.start <= merged[merged.length - 1].end) {
      merged[merged.length - 1].end = Math.max(merged[merged.length - 1].end, interval.end);
    } else {
      merged.push({ ...interval });
    }
  }

  const free: { start: number; end: number }[] = [];
  let cursor = DAY_START;

  for (const interval of merged) {
    if (interval.start > cursor) {
      free.push({ start: cursor, end: Math.min(interval.start, DAY_END) });
    }
    cursor = Math.max(cursor, interval.end);
  }

  if (cursor < DAY_END) {
    free.push({ start: cursor, end: DAY_END });
  }

  return free;
}

function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

function pickBlocks(freeBlocks: { start: number; end: number }[], remainingMinutes: number): { start: string; end: string; hours: number }[] {
  const result: { start: string; end: string; hours: number }[] = [];
  let left = remainingMinutes;

  for (const block of freeBlocks) {
    if (left <= 0) break;
    const available = block.end - block.start;
    const use = Math.min(available, left);
    result.push({
      start: minutesToTime(block.start),
      end: minutesToTime(block.start + use),
      hours: use / 60,
    });
    left -= use;
  }

  return result;
}

export const FillRemainingHoursDialog = ({
  open,
  onOpenChange,
  remainingHours,
  bookedHours,
  targetHours,
  projects,
  existingEntries,
  onSubmit,
}: FillRemainingHoursDialogProps) => {
  const [submitting, setSubmitting] = useState(false);
  const [blockForms, setBlockForms] = useState<BlockFormData[]>([]);

  const suggestedBlocks = useMemo(() => {
    const freeBlocks = calculateFreeBlocks(existingEntries);
    return pickBlocks(freeBlocks, Math.round(remainingHours * 60));
  }, [existingEntries, remainingHours]);

  // Reset forms when dialog opens or blocks change
  useEffect(() => {
    if (open) {
      setBlockForms(suggestedBlocks.map(() => ({
        locationType: "werkstatt" as const,
        projectId: "",
        description: "",
      })));
    }
  }, [open, suggestedBlocks]);

  const updateBlockForm = (index: number, updates: Partial<BlockFormData>) => {
    setBlockForms(prev => prev.map((form, i) => i === index ? { ...form, ...updates } : form));
  };

  const handleSubmit = async () => {
    if (suggestedBlocks.length === 0) return;
    setSubmitting(true);
    try {
      for (let i = 0; i < suggestedBlocks.length; i++) {
        const block = suggestedBlocks[i];
        const form = blockForms[i];
        if (!form) continue;

        await onSubmit(
          form.locationType === "werkstatt" ? null : (form.projectId || null),
          form.locationType,
          form.description,
          block.start,
          block.end,
          0,
          null,
          null,
        );
      }
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Reststunden auffüllen
          </DialogTitle>
          <DialogDescription>
            Fehlende Stunden für jeden Zeitblock einzeln buchen
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[65vh] pr-3">
          <div className="space-y-4">
            {/* Hours summary */}
            <div className="bg-muted/50 rounded-lg p-3 space-y-1">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Gebucht / Soll:</span>
                <span className="font-medium">{bookedHours.toFixed(2)} / {targetHours.toFixed(2)} h</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="font-medium text-sm">Reststunden:</span>
                <Badge variant="secondary" className="font-bold px-2 py-0.5">
                  {remainingHours.toFixed(2)} h
                </Badge>
              </div>
            </div>

            {suggestedBlocks.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">Kein freier Zeitraum verfügbar (08:00–17:00)</p>
            )}

            {/* Per-block forms */}
            {suggestedBlocks.map((block, i) => {
              const form = blockForms[i];
              if (!form) return null;

              return (
                <div key={i} className="border rounded-lg p-4 space-y-3">
                  {/* Block header */}
                  <div className="flex items-center justify-between">
                    <h4 className="font-semibold text-sm flex items-center gap-2">
                      <Clock className="w-3.5 h-3.5" />
                      Block {i + 1}
                    </h4>
                    <span className="font-mono text-sm font-medium bg-primary/5 px-2 py-0.5 rounded">
                      {block.start} – {block.end} ({block.hours.toFixed(1)}h)
                    </span>
                  </div>

                  {/* Location */}
                  <RadioGroup
                    value={form.locationType}
                    onValueChange={(value: "baustelle" | "werkstatt") => updateBlockForm(i, { locationType: value, projectId: "" })}
                    className="grid grid-cols-2 gap-2"
                  >
                    <div>
                      <RadioGroupItem value="baustelle" id={`fill-baustelle-${i}`} className="peer sr-only" />
                      <Label
                        htmlFor={`fill-baustelle-${i}`}
                        className="flex h-9 cursor-pointer items-center justify-center rounded-md border-2 border-muted bg-popover hover:bg-accent peer-data-[state=checked]:border-primary text-xs"
                      >
                        Baustelle
                      </Label>
                    </div>
                    <div>
                      <RadioGroupItem value="werkstatt" id={`fill-werkstatt-${i}`} className="peer sr-only" />
                      <Label
                        htmlFor={`fill-werkstatt-${i}`}
                        className="flex h-9 cursor-pointer items-center justify-center rounded-md border-2 border-muted bg-popover hover:bg-accent peer-data-[state=checked]:border-primary text-xs"
                      >
                        Lager
                      </Label>
                    </div>
                  </RadioGroup>

                  {/* Project - only for Baustelle */}
                  {form.locationType === "baustelle" && (
                    <Select value={form.projectId} onValueChange={(v) => updateBlockForm(i, { projectId: v })}>
                      <SelectTrigger className="h-9 text-sm">
                        <SelectValue placeholder="Projekt auswählen" />
                      </SelectTrigger>
                      <SelectContent>
                        {projects.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name} ({p.plz})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}

                  {/* Description */}
                  <Input
                    value={form.description}
                    onChange={(e) => updateBlockForm(i, { description: e.target.value })}
                    placeholder="Beschreibung (optional)"
                    className="h-9 text-sm"
                  />
                </div>
              );
            })}

            {/* Actions */}
            <div className="flex gap-2 justify-end pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onOpenChange(false)}
                disabled={submitting}
              >
                Abbrechen
              </Button>
              <Button
                size="sm"
                onClick={handleSubmit}
                disabled={submitting || suggestedBlocks.length === 0}
              >
                {submitting ? "Wird gebucht..." : `${suggestedBlocks.length} Block${suggestedBlocks.length > 1 ? "e" : ""} buchen`}
              </Button>
            </div>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
};
