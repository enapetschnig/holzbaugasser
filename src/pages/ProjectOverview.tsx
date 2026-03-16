import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, FileText, FileCheck, Package, Camera, ImagePlus, Lock, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

type DocumentCategory = {
  type: "plans" | "reports" | "photos" | "chef";
  title: string;
  description: string;
  icon: React.ReactNode;
  count: number;
  adminOnly?: boolean;
};

type CatalogItem = { id: string; name: string; einheit: string };

const CUSTOM_MATERIAL_VALUE = "__custom__";

const ProjectOverview = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [projectName, setProjectName] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [materialCount, setMaterialCount] = useState(0);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [categories, setCategories] = useState<DocumentCategory[]>([
    {
      type: "photos",
      title: "Fotos",
      description: "Baufortschritt und Dokumentationsfotos",
      icon: <Camera className="h-8 w-8" />,
      count: 0,
    },
    {
      type: "plans",
      title: "Pläne",
      description: "Baupläne und technische Zeichnungen",
      icon: <FileText className="h-8 w-8" />,
      count: 0,
    },
    {
      type: "reports",
      title: "Regieberichte",
      description: "Bautagebücher und Stundenberichte",
      icon: <FileCheck className="h-8 w-8" />,
      count: 0,
    },
    {
      type: "chef",
      title: "🔒 Chefordner",
      description: "Vertrauliche Chef-Dokumente",
      icon: <Lock className="h-8 w-8" />,
      count: 0,
      adminOnly: true,
    },
  ]);

  // Material dialog state
  const [materialCatalog, setMaterialCatalog] = useState<CatalogItem[]>([]);
  const [showMaterialDialog, setShowMaterialDialog] = useState(false);
  const [selectedMaterial, setSelectedMaterial] = useState("");
  const [customMaterial, setCustomMaterial] = useState("");
  const [newMenge, setNewMenge] = useState("");
  const [submittingMaterial, setSubmittingMaterial] = useState(false);

  useEffect(() => {
    if (projectId) {
      checkAdminStatus();
      fetchProjectName();
      fetchMaterialCatalog();
    }
  }, [projectId]);

  useEffect(() => {
    if (projectId) {
      fetchFileCounts();
      fetchMaterialCount();
    }
  }, [projectId, isAdmin]);

  const checkAdminStatus = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    setCurrentUserId(user.id);

    const { data } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "administrator")
      .maybeSingle();

    setIsAdmin(!!data);
  };

  const fetchProjectName = async () => {
    if (!projectId) return;

    const { data } = await supabase
      .from("projects")
      .select("name")
      .eq("id", projectId)
      .single();

    if (data) {
      setProjectName(data.name);
    }
  };

  const fetchMaterialCount = async () => {
    if (!projectId) return;

    const { count } = await supabase
      .from("material_entries")
      .select("*", { count: "exact", head: true })
      .eq("project_id", projectId);

    setMaterialCount(count || 0);
  };

  const fetchMaterialCatalog = async () => {
    const { data } = await supabase
      .from("materials")
      .select("id, name, einheit")
      .order("name");
    if (data) setMaterialCatalog(data);
  };

  const getMaterialName = (): string => {
    if (selectedMaterial === CUSTOM_MATERIAL_VALUE) return customMaterial.trim();
    return selectedMaterial;
  };

  const handleAddMaterial = async () => {
    const materialName = getMaterialName();
    if (!projectId || !currentUserId || !materialName) return;

    setSubmittingMaterial(true);
    const { error } = await supabase
      .from("material_entries")
      .insert({
        project_id: projectId,
        user_id: currentUserId,
        material: materialName,
        menge: newMenge.trim() || null,
      });

    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: "Material konnte nicht gespeichert werden" });
    } else {
      toast({ title: "Gespeichert", description: "Material wurde hinzugefügt" });
      resetMaterialDialog();
      fetchMaterialCount();
    }
    setSubmittingMaterial(false);
  };

  const resetMaterialDialog = () => {
    setShowMaterialDialog(false);
    setSelectedMaterial("");
    setCustomMaterial("");
    setNewMenge("");
  };

  const fetchFileCounts = async () => {
    if (!projectId) return;

    const bucketMap: Record<string, string> = {
      plans: "project-plans",
      reports: "project-reports",
      photos: "project-photos",
      chef: "project-chef",
    };

    const updatedCategories = await Promise.all(
      categories.map(async (category) => {
        if (category.type === "chef" && !isAdmin) {
          return { ...category, count: 0 };
        }

        const bucket = bucketMap[category.type];
        const { data } = await supabase
          .storage
          .from(bucket)
          .list(projectId);

        return {
          ...category,
          count: data?.length || 0,
        };
      })
    );

    setCategories(updatedCategories);
  };

  const handleQuickPhotoUpload = () => {
    navigate(`/projects/${projectId}/photos`);
  };

  const visibleCategories = categories.filter(
    (category) => !category.adminOnly || isAdmin
  );

  // Get unit hint from catalog for selected material
  const selectedCatalogItem = materialCatalog.find(c => c.name === selectedMaterial);
  const mengePlaceholder = selectedCatalogItem
    ? `z.B. 10 ${selectedCatalogItem.einheit}`
    : "z.B. 10 Stück";

  const isMaterialValid = selectedMaterial === CUSTOM_MATERIAL_VALUE
    ? customMaterial.trim().length > 0
    : selectedMaterial.length > 0;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card sticky top-0 z-50 shadow-sm">
        <div className="container mx-auto px-3 sm:px-4 lg:px-6 py-3 sm:py-4">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => navigate("/projects")}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              <span className="hidden sm:inline">Zurück</span>
            </Button>
            <img
              src="/gasser-logo.png"
              alt="Holzbau Gasser"
              className="h-10 w-10 sm:h-14 sm:w-14 cursor-pointer hover:opacity-80 transition-opacity object-contain"
              onClick={() => navigate("/projects")}
            />
          </div>
        </div>
      </header>

      <main className="container mx-auto px-3 sm:px-4 lg:px-6 py-4 sm:py-6 max-w-4xl">
        <div className="mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold mb-2">{projectName}</h1>
          <p className="text-muted-foreground">Dokumentation und Dateien</p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {/* Fotos - first */}
          {visibleCategories.filter(c => c.type === "photos").map((category) => (
            <Card
              key={category.type}
              className="cursor-pointer hover:shadow-lg transition-shadow"
              onClick={() => navigate(`/projects/${projectId}/${category.type}`)}
            >
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="text-primary">{category.icon}</div>
                  <div className="text-2xl font-bold">{category.count}</div>
                </div>
                <CardTitle className="text-xl">{category.title}</CardTitle>
                <CardDescription>{category.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <Button variant="outline" className="w-full">Öffnen</Button>
              </CardContent>
            </Card>
          ))}

          {/* Materialliste - second (nach Fotos) */}
          <Card
            className="cursor-pointer hover:shadow-lg transition-shadow"
            onClick={() => navigate(`/projects/${projectId}/materials`)}
          >
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="text-primary"><Package className="h-8 w-8" /></div>
                <div className="text-2xl font-bold">{materialCount}</div>
              </div>
              <CardTitle className="text-xl">Materialliste</CardTitle>
              <CardDescription>Verwendete Materialien dokumentieren</CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" className="w-full">Öffnen</Button>
            </CardContent>
          </Card>

          {/* Rest: Pläne, Regieberichte, Chefordner */}
          {visibleCategories.filter(c => c.type !== "photos").map((category) => (
            <Card
              key={category.type}
              className="cursor-pointer hover:shadow-lg transition-shadow"
              onClick={() => navigate(`/projects/${projectId}/${category.type}`)}
            >
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="text-primary">{category.icon}</div>
                  <div className="text-2xl font-bold">{category.count}</div>
                </div>
                <CardTitle className="text-xl">{category.title}</CardTitle>
                <CardDescription>{category.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <Button variant="outline" className="w-full">Öffnen</Button>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Material hinzufügen Button */}
        <Button
          className="w-full mt-4 gap-2"
          variant="outline"
          size="lg"
          onClick={() => setShowMaterialDialog(true)}
        >
          <Plus className="h-5 w-5" />
          Material hinzufügen
        </Button>

        {/* Floating Action Button für Fotos */}
        <Button
          className="fixed bottom-6 right-6 z-50 h-14 w-14 rounded-full shadow-lg"
          size="icon"
          onClick={handleQuickPhotoUpload}
        >
          <ImagePlus className="h-6 w-6" />
        </Button>
      </main>

      {/* Material Dialog */}
      <Dialog open={showMaterialDialog} onOpenChange={(open) => { if (!open) resetMaterialDialog(); else setShowMaterialDialog(true); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              Material hinzufügen
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label>Material</Label>
              <Select value={selectedMaterial} onValueChange={(val) => { setSelectedMaterial(val); if (val !== CUSTOM_MATERIAL_VALUE) setCustomMaterial(""); }}>
                <SelectTrigger className="h-12 text-base">
                  <SelectValue placeholder="Material auswählen" />
                </SelectTrigger>
                <SelectContent>
                  {materialCatalog.map(c => (
                    <SelectItem key={c.id} value={c.name} className="text-base py-3">
                      {c.name} ({c.einheit})
                    </SelectItem>
                  ))}
                  <SelectItem value={CUSTOM_MATERIAL_VALUE} className="text-base py-3 font-medium">
                    Anderes Material...
                  </SelectItem>
                </SelectContent>
              </Select>
              {selectedMaterial === CUSTOM_MATERIAL_VALUE && (
                <Input
                  placeholder="Material eingeben"
                  value={customMaterial}
                  onChange={(e) => setCustomMaterial(e.target.value)}
                  autoFocus
                  className="h-12 text-base"
                />
              )}
            </div>
            <div className="space-y-2">
              <Label>Menge</Label>
              <Input
                placeholder={mengePlaceholder}
                value={newMenge}
                onChange={(e) => setNewMenge(e.target.value)}
                className="h-12 text-base"
              />
            </div>
            <div className="flex gap-2 pt-2">
              <Button
                className="flex-1 h-12 text-base"
                onClick={handleAddMaterial}
                disabled={submittingMaterial || !isMaterialValid}
              >
                {submittingMaterial ? "Speichert..." : "Speichern"}
              </Button>
              <Button
                className="flex-1 h-12 text-base"
                variant="outline"
                onClick={resetMaterialDialog}
              >
                Abbrechen
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ProjectOverview;
