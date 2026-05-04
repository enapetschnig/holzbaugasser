import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Upload, FileText, Trash2, Eye, Download, Pencil } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { FileViewer } from "@/components/FileViewer";
import { downloadLeistungsberichtPDF } from "@/lib/downloadLeistungsberichtPDF";

type DocumentType = "plans" | "reports" | "leistungsberichte" | "photos" | "chef";

type StorageFile = {
  name: string;
  id: string;
  created_at: string;
  metadata: any;
};

const bucketMap: Record<string, string> = {
  plans: "project-plans",
  reports: "project-reports",
  photos: "project-photos",
  chef: "project-chef",
};

const titleMap: Record<DocumentType, string> = {
  plans: "Pläne",
  reports: "Regieberichte",
  leistungsberichte: "Leistungsberichte",
  photos: "Fotos",
  chef: "🔒 Chefordner",
};

type LBListItem = {
  id: string;
  bericht_typ: "leistungsbericht" | "werk" | "lkw";
  datum: string;
  ersteller: string;
  total_stunden: number;
  ma_count: number;
  // Für Werkstatt/LKW: weitere Projekte (außer dem aktuellen) zur Hinweis-Anzeige
  other_projects: string[];
};

const ProjectDetail = () => {
  const { projectId, type } = useParams<{ projectId: string; type: DocumentType }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [files, setFiles] = useState<StorageFile[]>([]);
  const [lbList, setLbList] = useState<LBListItem[]>([]);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [viewerState, setViewerState] = useState<{
    open: boolean;
    fileName: string;
    filePath: string;
  }>({ open: false, fileName: "", filePath: "" });

  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [urlsLoading, setUrlsLoading] = useState(false);

  useEffect(() => {
    if (projectId && type) {
      checkAdminStatus();
      fetchProjectName();
      fetchFiles();
    }
  }, [projectId, type]);

  useEffect(() => {
    if (files.length > 0 && projectId && type) {
      generateSignedUrls();
    }
  }, [files]);

  const generateSignedUrls = async () => {
    if (!projectId || !type) return;
    
    const bucket = bucketMap[type];
    const isPublic = bucket === "project-photos";
    
    setUrlsLoading(true);
    const urls: Record<string, string> = {};
    
    for (const file of files) {
      const filePath = `${projectId}/${file.name}`;
      
      if (isPublic) {
        const { data } = supabase.storage
          .from(bucket)
          .getPublicUrl(filePath);
        urls[file.name] = data.publicUrl;
      } else {
        const { data, error } = await supabase.storage
          .from(bucket)
          .createSignedUrl(filePath, 3600);
        
        if (!error && data) {
          urls[file.name] = data.signedUrl;
        }
      }
    }
    
    setSignedUrls(urls);
    setUrlsLoading(false);
  };

  const checkAdminStatus = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .single();

    setIsAdmin(data?.role === "administrator");
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

  const fetchFiles = async () => {
    if (!projectId || !type) return;

    // Spezial-Branch: Leistungsberichte aus DB statt Storage
    if (type === "leistungsberichte") {
      await fetchLeistungsberichte();
      setLoading(false);
      return;
    }

    const bucket = bucketMap[type];
    if (!bucket) {
      setLoading(false);
      return;
    }
    const { data, error } = await supabase
      .storage
      .from(bucket)
      .list(projectId, {
        sortBy: { column: "created_at", order: "desc" },
      });

    if (!error && data) {
      setFiles(data);
    }
    setLoading(false);
  };

  const fetchLeistungsberichte = async () => {
    if (!projectId) return;

    // 1) Klassische Leistungsberichte (LB) — projekt_id im Header
    const { data: lbData } = await supabase
      .from("leistungsberichte" as any)
      .select("id, bericht_typ, datum, erstellt_von")
      .eq("projekt_id", projectId)
      .order("datum", { ascending: false });

    // 2) Werkstatt/LKW-Berichte — projekt_id ist im taetigkeiten-Eintrag
    const { data: tRows } = await supabase
      .from("leistungsbericht_taetigkeiten" as any)
      .select("bericht_id")
      .eq("projekt_id", projectId);
    const matrixIds = [...new Set(((tRows as any[]) || []).map((r: any) => r.bericht_id))];

    let matrixData: any[] = [];
    if (matrixIds.length > 0) {
      const { data: mData } = await supabase
        .from("leistungsberichte" as any)
        .select("id, bericht_typ, datum, erstellt_von")
        .in("id", matrixIds);
      matrixData = (mData as any[]) || [];
    }

    // Beide Listen mergen, Duplikate per id raus (sollte selten sein)
    const allBerichteMap = new Map<string, any>();
    for (const b of (lbData as any[]) || []) allBerichteMap.set(b.id, b);
    for (const b of matrixData) allBerichteMap.set(b.id, b);
    const allBerichte = Array.from(allBerichteMap.values()).sort((a, b) =>
      (b.datum as string).localeCompare(a.datum as string)
    );

    if (allBerichte.length === 0) {
      setLbList([]);
      return;
    }

    const allIds = allBerichte.map((b) => b.id);

    // Alle taetigkeiten dieser Berichte laden — für andere Projekte (Hinweis)
    const { data: allTaet } = await supabase
      .from("leistungsbericht_taetigkeiten" as any)
      .select("bericht_id, projekt_id")
      .in("bericht_id", allIds);

    // Mitarbeiter-Stunden + Anzahl
    const { data: maRows } = await supabase
      .from("leistungsbericht_mitarbeiter" as any)
      .select("bericht_id, summe_stunden")
      .in("bericht_id", allIds);

    // Andere Projekt-IDs pro Bericht (außer dem aktuellen)
    const otherProjektIds: Record<string, Set<string>> = {};
    for (const t of (allTaet as any[]) || []) {
      if (!t.projekt_id || t.projekt_id === projectId) continue;
      if (!otherProjektIds[t.bericht_id]) otherProjektIds[t.bericht_id] = new Set();
      otherProjektIds[t.bericht_id].add(t.projekt_id);
    }

    // Projekt-Namen für die anderen Projekt-IDs auflösen
    const distinctOtherIds = new Set<string>();
    Object.values(otherProjektIds).forEach((s) => s.forEach((id) => distinctOtherIds.add(id)));
    const projNameMap: Record<string, string> = {};
    if (distinctOtherIds.size > 0) {
      const { data: projData } = await supabase
        .from("projects")
        .select("id, name")
        .in("id", Array.from(distinctOtherIds));
      (projData || []).forEach((p: any) => { projNameMap[p.id] = p.name; });
    }

    // Stunden + MA-Count pro Bericht
    const stundenMap: Record<string, { sum: number; count: number }> = {};
    for (const m of (maRows as any[]) || []) {
      if (!stundenMap[m.bericht_id]) stundenMap[m.bericht_id] = { sum: 0, count: 0 };
      stundenMap[m.bericht_id].sum += parseFloat(m.summe_stunden) || 0;
      stundenMap[m.bericht_id].count += 1;
    }

    // Ersteller-Namen
    const erstellerIds = [...new Set(allBerichte.map((b) => b.erstellt_von).filter(Boolean))];
    const erstellerMap: Record<string, string> = {};
    if (erstellerIds.length > 0) {
      const { data: profileData } = await supabase
        .from("profiles")
        .select("id, vorname, nachname")
        .in("id", erstellerIds);
      (profileData || []).forEach((p: any) => {
        erstellerMap[p.id] = `${p.vorname || ""} ${p.nachname || ""}`.trim() || "—";
      });
    }

    const list: LBListItem[] = allBerichte.map((b) => {
      const otherSet = otherProjektIds[b.id] || new Set<string>();
      const otherNames = Array.from(otherSet).map((pid) => projNameMap[pid]).filter(Boolean);
      const stats = stundenMap[b.id] || { sum: 0, count: 0 };
      return {
        id: b.id,
        bericht_typ: ((b.bericht_typ as string) || "leistungsbericht") as "leistungsbericht" | "werk" | "lkw",
        datum: b.datum,
        ersteller: erstellerMap[b.erstellt_von] || "—",
        total_stunden: Math.round(stats.sum * 100) / 100,
        ma_count: stats.count,
        other_projects: otherNames,
      };
    });
    setLbList(list);
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0 || !projectId || !type) return;

    setUploading(true);
    const file = e.target.files[0];
    const bucket = bucketMap[type];
    const filePath = `${projectId}/${Date.now()}_${file.name}`;

    const { error } = await supabase
      .storage
      .from(bucket)
      .upload(filePath, file);

    if (error) {
      toast({
        variant: "destructive",
        title: "Fehler",
        description: "Datei konnte nicht hochgeladen werden",
      });
    } else {
      toast({
        title: "Erfolg",
        description: "Datei wurde hochgeladen",
      });
      fetchFiles();
    }
    setUploading(false);
    e.target.value = "";
  };

  const handleDelete = async (file: StorageFile) => {
    if (!projectId || !type) return;

    const bucket = bucketMap[type];
    const filePath = `${projectId}/${file.name}`;

    const { error } = await supabase
      .storage
      .from(bucket)
      .remove([filePath]);

    if (error) {
      toast({
        variant: "destructive",
        title: "Fehler",
        description: "Datei konnte nicht gelöscht werden",
      });
    } else {
      toast({
        title: "Gelöscht",
        description: "Datei wurde entfernt",
      });
      fetchFiles();
    }
  };

  const handleFileOpen = (file: StorageFile) => {
    const filePath = `${projectId}/${file.name}`;
    setViewerState({
      open: true,
      fileName: file.name,
      filePath: filePath
    });
  };

  const getFileUrl = (fileName: string) => {
    if (!projectId || !type) return "";
    const bucket = bucketMap[type];
    const { data } = supabase.storage.from(bucket).getPublicUrl(`${projectId}/${fileName}`);
    return data.publicUrl;
  };

  if (!type) {
    return <div>Ungültiger Dokumenttyp</div>;
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p>Lädt...</p>
      </div>
    );
  }

  // Leistungsberichte-Branch: eigene Liste (DB), kein Upload, PDF on-the-fly
  if (type === "leistungsberichte") {
    return (
      <div className="min-h-screen bg-background">
        <PageHeader title={`${projectName} - ${titleMap[type]}`} backPath="/projects" />
        <main className="container mx-auto px-4 py-6 max-w-5xl">
          <Card>
            <CardHeader>
              <CardTitle>Leistungsberichte</CardTitle>
              <CardDescription>
                {lbList.length === 0 ? "Keine Berichte für dieses Projekt vorhanden" : `${lbList.length} ${lbList.length === 1 ? "Bericht" : "Berichte"}`}
              </CardDescription>
            </CardHeader>
            <CardContent className="p-6">
              {lbList.length === 0 ? (
                <div className="text-center py-12">
                  <FileText className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                  <p className="text-lg font-semibold mb-2">Noch keine Leistungsberichte</p>
                  <p className="text-sm text-muted-foreground">
                    Berichte erscheinen hier automatisch, sobald sie für dieses Projekt erstellt wurden.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {lbList.map((lb) => {
                    const isWerk = lb.bericht_typ === "werk";
                    const isLkw = lb.bericht_typ === "lkw";
                    const typLabel = isWerk ? "Werkstatt" : isLkw ? "LKW" : "Leistungsbericht";
                    const editPath = isWerk ? "/werk-bericht" : isLkw ? "/lkw-bericht" : "/time-tracking";
                    return (
                      <div
                        key={lb.id}
                        className="flex items-start gap-3 p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                      >
                        <FileText className="w-10 h-10 text-muted-foreground shrink-0 mt-1" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <Badge
                              variant="outline"
                              className={
                                isWerk ? "border-amber-300 text-amber-700 bg-amber-50"
                                : isLkw ? "border-orange-300 text-orange-700 bg-orange-50"
                                : "border-blue-300 text-blue-700 bg-blue-50"
                              }
                            >
                              {typLabel}
                            </Badge>
                            <span className="font-medium">
                              {new Date(lb.datum + "T00:00:00").toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "long", year: "numeric" })}
                            </span>
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {lb.ma_count} {lb.ma_count === 1 ? "Mitarbeiter" : "Mitarbeiter"} · {lb.total_stunden.toFixed(2).replace(".", ",")} h gesamt · erstellt von {lb.ersteller}
                          </div>
                          {lb.other_projects.length > 0 && (
                            <div className="text-xs text-blue-700 dark:text-blue-400 mt-1">
                              ℹ Auch in: {lb.other_projects.join(", ")}
                            </div>
                          )}
                        </div>
                        <div className="flex flex-col sm:flex-row gap-2 shrink-0">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={downloadingId === lb.id}
                            onClick={async () => {
                              setDownloadingId(lb.id);
                              try {
                                await downloadLeistungsberichtPDF(lb.id);
                              } catch (err: any) {
                                toast({ variant: "destructive", title: "Fehler", description: err?.message || "PDF konnte nicht erstellt werden." });
                              } finally {
                                setDownloadingId(null);
                              }
                            }}
                          >
                            <Download className="w-4 h-4 sm:mr-2" />
                            <span className="hidden sm:inline">{downloadingId === lb.id ? "..." : "PDF"}</span>
                          </Button>
                          {isAdmin && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => navigate(`${editPath}?edit=${lb.id}`)}
                              title="Bericht bearbeiten"
                            >
                              <Pencil className="w-4 h-4 sm:mr-2" />
                              <span className="hidden sm:inline">Bearbeiten</span>
                            </Button>
                          )}
                        </div>
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

  return (
    <div className="min-h-screen bg-background">
      <PageHeader title={`${projectName} - ${titleMap[type]}`} backPath="/projects" />

      <main className="container mx-auto px-4 py-6 max-w-5xl">
        <Card>
          <CardHeader>
            <CardTitle>{titleMap[type]}</CardTitle>
            <CardDescription>
              {files.length} {files.length === 1 ? 'Datei' : 'Dateien'}
            </CardDescription>
          </CardHeader>

          <CardContent className="p-6">
            {/* Upload section - Admin only */}
            {isAdmin && (
              <div className="mb-6">
                <label htmlFor="file-upload" className="cursor-pointer">
                  <div className="border-2 border-dashed rounded-lg p-6 text-center hover:border-primary/50 transition-colors">
                    <Upload className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
                    <p className="text-base font-medium mb-1">
                      {uploading ? "Lädt hoch..." : "Datei auswählen"}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Klicken zum Auswählen
                    </p>
                  </div>
                </label>
                <Input
                  id="file-upload"
                  type="file"
                  onChange={handleUpload}
                  disabled={uploading}
                  multiple
                  className="hidden"
                  accept={type === "photos" ? "image/*" : "*"}
                />
              </div>
            )}

            {files.length === 0 ? (
              <div className="text-center py-12">
                <FileText className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                <p className="text-lg font-semibold mb-2">Keine Dateien</p>
                <p className="text-sm text-muted-foreground">
                  Lade die erste Datei hoch
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {files.map((file) => (
                  <div
                    key={file.id}
                    className="flex items-center gap-3 p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                  >
                    {urlsLoading ? (
                      <div className="w-12 h-12 sm:w-16 sm:h-16 bg-muted animate-pulse rounded shrink-0" />
                    ) : signedUrls[file.name] && (file.name.match(/\.(jpg|jpeg|png|gif|webp)$/i) || file.name.match(/\.pdf$/i)) ? (
                      <img 
                        src={signedUrls[file.name]} 
                        alt={file.name}
                        className="w-12 h-12 sm:w-16 sm:h-16 object-cover rounded shrink-0"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    ) : (
                      <FileText className="w-12 h-12 sm:w-16 sm:h-16 text-muted-foreground shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{file.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {new Date(file.created_at).toLocaleDateString("de-DE")}
                      </p>
                    </div>

                    <div className="flex gap-2 ml-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleFileOpen(file)}
                      >
                        <Eye className="w-4 h-4 sm:mr-2" />
                        <span className="hidden sm:inline">Ansehen</span>
                      </Button>
                      {isAdmin && (
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleDelete(file)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </main>

      <FileViewer
        open={viewerState.open}
        onClose={() => setViewerState({ open: false, fileName: "", filePath: "" })}
        fileName={viewerState.fileName}
        filePath={viewerState.filePath}
        bucketName={bucketMap[type]}
      />
    </div>
  );
};

export default ProjectDetail;
