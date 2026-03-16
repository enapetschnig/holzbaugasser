import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, FileText, FileCheck, Camera, ImagePlus, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

const ProjectOverview = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [projectName, setProjectName] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
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

  useEffect(() => {
    if (projectId) {
      checkAdminStatus();
      fetchProjectName();
    }
  }, [projectId]);

  useEffect(() => {
    if (projectId) {
      fetchFileCounts();
    }
  }, [projectId, isAdmin]);

  const checkAdminStatus = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

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

        {/* Floating Action Button für Fotos */}
        <Button
          className="fixed bottom-6 right-6 z-50 h-14 w-14 rounded-full shadow-lg"
          size="icon"
          onClick={handleQuickPhotoUpload}
        >
          <ImagePlus className="h-6 w-6" />
        </Button>
      </main>

    </div>
  );
};

export default ProjectOverview;
