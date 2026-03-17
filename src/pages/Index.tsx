import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Session, User } from "@supabase/supabase-js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Clock, FolderKanban, Users, BarChart3, LogOut, FileText, Camera, ArrowRight, Info, User as UserIcon, Zap, Receipt, Bell, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useOnboarding } from "@/contexts/OnboardingContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import ChangePasswordDialog from "@/components/ChangePasswordDialog";

type Project = {
  id: string;
  name: string;
  status: string;
  updated_at: string;
};

type Notification = {
  id: string;
  type: string;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
};

type RecentTimeEntry = {
  id: string;
  datum: string;
  stunden: number;
  taetigkeit: string;
  disturbance_id: string | null;
  projects: { name: string } | null;
  profiles?: {
    vorname: string;
    nachname: string;
  } | null;
};

export default function Index() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [userName, setUserName] = useState<string>("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [recentEntries, setRecentEntries] = useState<RecentTimeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [isActivated, setIsActivated] = useState<boolean | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [zeitkontoBalance, setZeitkontoBalance] = useState<number | null>(null);
  const { handleRestartInstallGuide } = useOnboarding();

  const fetchProjects = async () => {
    const { data } = await supabase
      .from("projects")
      .select("id, name, status, updated_at")
      .eq("status", "aktiv")
      .order("updated_at", { ascending: false })
      .limit(5);

    if (data) {
      setProjects(data);
    }
  };

  const fetchNotifications = async (userId: string) => {
    const { data } = await supabase
      .from("notifications")
      .select("id, type, title, message, is_read, created_at")
      .eq("user_id", userId)
      .eq("is_read", false)
      .order("created_at", { ascending: false })
      .limit(10);
    if (data) setNotifications(data);
  };

  const fetchRecentEntries = async (userId: string, role: string | null) => {
    // For admins, fetch all entries. For employees, only their own
    let query = supabase
      .from("time_entries")
      .select("id, datum, stunden, taetigkeit, disturbance_id, projects(name), profiles:user_id(vorname, nachname)")
      .order("datum", { ascending: false })
      .limit(5);

    if (role !== "administrator" && role !== "vorarbeiter") {
      query = query.eq("user_id", userId);
    }

    const { data } = await query;

    if (data) {
      setRecentEntries(data as any);
    }
  };

  const loadForUser = async (userId: string) => {
    // 1) Activation + name
    const profileReq = supabase
      .from("profiles")
      .select("vorname, nachname, is_active")
      .eq("id", userId)
      .maybeSingle();

    // 2) Role
    const roleReq = supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .maybeSingle();

    const [{ data: profileData }, { data: roleData }] = await Promise.all([profileReq, roleReq]);

    // Prüfe ob Benutzer aktiviert ist
    if (profileData) {
      setIsActivated(profileData.is_active !== false);
    } else {
      setIsActivated(true); // Fallback: neues Profil noch nicht angelegt
    }

    if (profileData) {
      setUserName(`${profileData.vorname} ${profileData.nachname}`.trim());
    } else {
      // Fallback: User-Metadaten verwenden
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.user_metadata) {
        setUserName(`${user.user_metadata.vorname || ''} ${user.user_metadata.nachname || ''}`.trim() || 'Neuer Benutzer');
      }
    }

    const role = roleData?.role ?? null;
    setUserRole(role);

    // Load Zeitkonto balance
    const { data: zkData } = await supabase
      .from("time_accounts")
      .select("balance_hours")
      .eq("user_id", userId)
      .maybeSingle();
    if (zkData) {
      setZeitkontoBalance(zkData.balance_hours || 0);
    }

    await Promise.all([
      fetchProjects(),
      fetchRecentEntries(userId, role),
      fetchNotifications(userId),
    ]);

    setLoading(false);
  };

  useEffect(() => {
    let isMounted = true;

    const handleSession = async (nextSession: Session | null) => {
      if (!isMounted) return;

      setSession(nextSession);
      setUser(nextSession?.user ?? null);

      if (!nextSession?.user) {
        setIsActivated(null);
        setUserRole(null);
        setUserName("");
        setProjects([]);
        setRecentEntries([]);
        setLoading(false);
        navigate("/auth");
        return;
      }

      // Block any UI until activation is verified
      setLoading(true);
      setIsActivated(null);

      await loadForUser(nextSession.user.id);
    };

    // Listen for auth changes FIRST
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      // Never run async supabase calls inside this callback.
      window.setTimeout(() => {
        void handleSession(nextSession);
      }, 0);
    });

    // THEN check initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      window.setTimeout(() => {
        void handleSession(session);
      }, 0);
    });

    // Realtime subscription for projects
    const projectsChannel = supabase
      .channel("dashboard-projects")
      .on("postgres_changes", { event: "*", schema: "public", table: "projects" }, () => {
        fetchProjects();
      })
      .subscribe();

    // Realtime subscription for time entries
    const entriesChannel = supabase
      .channel("dashboard-entries")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "time_entries",
          filter: user ? `user_id=eq.${user.id}` : undefined,
        },
        () => {
          if (user) fetchRecentEntries(user.id, userRole);
        }
      )
      .subscribe();

    return () => {
      isMounted = false;
      subscription.unsubscribe();
      supabase.removeChannel(projectsChannel);
      supabase.removeChannel(entriesChannel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate]);

  const handleDismissNotification = async (notificationId: string) => {
    await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("id", notificationId);
    setNotifications(prev => prev.filter(n => n.id !== notificationId));
  };

  const handleLogout = async () => {
    await supabase.auth.signOut({ scope: "local" });
    navigate("/auth");
  };

  useEffect(() => {
    if (!loading && !user) {
      navigate("/auth");
    }
  }, [loading, user, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p>Lädt...</p>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  if (isActivated === false) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="text-center space-y-4 max-w-md">
          <img src="/gasser-logo.png" alt="Holzbau Gasser" className="h-20 mx-auto" />
          <h1 className="text-xl font-bold">Freischaltung ausstehend</h1>
          <p className="text-muted-foreground">
            Ihr Konto wartet auf Freischaltung durch den Administrator.
            Sie werden benachrichtigt, sobald Ihr Zugang aktiviert wurde.
          </p>
          <Button variant="outline" onClick={() => supabase.auth.signOut()}>Abmelden</Button>
        </div>
      </div>
    );
  }

  const isAdmin = userRole === "administrator";
  const isVorarbeiter = userRole === "vorarbeiter";
  const canManageTime = isAdmin || isVorarbeiter;
  const canCreateProjects = isAdmin || isVorarbeiter;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card sticky top-0 z-50 shadow-sm">
        <div className="container mx-auto px-3 sm:px-4 lg:px-6 py-3 sm:py-4">
          <div className="flex justify-between items-center gap-3">
            <div className="flex items-center gap-2 sm:gap-3">
              <img src="/gasser-logo.png" alt="Holzbau Gasser" className="h-10 sm:h-14 w-auto" />
              <div className="hidden sm:block h-8 w-px bg-border" />
              <div className="flex flex-col">
                <span className="text-xs sm:text-sm text-muted-foreground">Hallo</span>
                <span className="text-sm sm:text-base font-semibold">{userName || "Benutzer"}</span>
              </div>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <UserIcon className="h-4 w-4 mr-2" />
                  <span className="hidden sm:inline">Menü</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Mein Account</DropdownMenuLabel>
                <DropdownMenuSeparator />
                
                <DropdownMenuItem onClick={handleRestartInstallGuide}>
                  <Info className="mr-2 h-4 w-4" />
                  <span>App zum Startbildschirm hinzufügen</span>
                </DropdownMenuItem>
                
                <DropdownMenuSeparator />

                <ChangePasswordDialog />
                
                <DropdownMenuSeparator />
                
                <DropdownMenuItem onClick={handleLogout}>
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Abmelden</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-3 sm:px-4 lg:px-6 py-4 sm:py-6 lg:py-8">
        <div className="mb-6 sm:mb-8">
          <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold mb-2">
            {isAdmin ? "Admin Dashboard" : isVorarbeiter ? "Vorarbeiter Dashboard" : "Mein Dashboard"}
          </h1>
          <p className="text-sm sm:text-base text-muted-foreground">
            {isAdmin
              ? "Verwaltung aller Projekte und Mitarbeiter"
              : isVorarbeiter
              ? "Zeiterfassung und Projektverwaltung"
              : "Urlaub und Projektdokumentation"}
          </p>
        </div>

        {/* Notifications Banner */}
        {notifications.length > 0 && (
          <div className="mb-4 space-y-2">
            {notifications.map((notif) => (
              <div
                key={notif.id}
                className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3 cursor-pointer"
                onClick={() => {
                  handleDismissNotification(notif.id);
                  if (notif.type === "krankmeldung_upload") navigate("/admin");
                  if (notif.type === "neue_registrierung") navigate("/admin");
                  if (notif.type === "lohnzettel_upload") navigate("/my-documents");
                }}
              >
                <Bell className="h-5 w-5 text-primary shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm">{notif.title}</p>
                  <p className="text-xs text-muted-foreground truncate">{notif.message}</p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0 h-8 w-8 p-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDismissNotification(notif.id);
                  }}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* Zeitkonto Info */}
        {zeitkontoBalance !== null && (
          <Card className="border-primary/20 bg-primary/5">
            <CardContent className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Clock className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Zeitkonto</p>
                  <p className={`text-lg font-bold ${zeitkontoBalance >= 0 ? "text-green-600" : "text-red-600"}`}>
                    {zeitkontoBalance >= 0 ? "+" : ""}{zeitkontoBalance % 1 === 0 ? zeitkontoBalance : zeitkontoBalance.toFixed(1)} Stunden
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Main Actions Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 lg:gap-6">
          {/* Zeiterfassung - Nur für Admin + Vorarbeiter */}
          {canManageTime && (
            <Card
              className="cursor-pointer hover:shadow-lg transition-all hover:border-primary/50"
              onClick={() => navigate("/time-tracking")}
            >
              <CardHeader className="space-y-2 pb-3">
                <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Clock className="h-6 w-6 text-primary" />
                </div>
                <CardTitle className="text-lg sm:text-xl">Leistungsbericht</CardTitle>
                <CardDescription className="text-sm">
                  Täglichen Leistungsbericht erstellen
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button className="w-full" size="sm">Bericht erstellen</Button>
              </CardContent>
            </Card>
          )}

          {/* Projekte - Für alle */}
          <Card 
            className="cursor-pointer hover:shadow-lg transition-all hover:border-primary/50" 
            onClick={() => navigate("/projects")}
          >
            <CardHeader className="space-y-2 pb-3">
              <div className="h-12 w-12 rounded-lg bg-accent/10 flex items-center justify-center">
                <FolderKanban className="h-6 w-6 text-accent" />
              </div>
              <CardTitle className="text-lg sm:text-xl">Projekte</CardTitle>
              <CardDescription className="text-sm">
                {isAdmin ? "Bauvorhaben & Dokumentation" : canCreateProjects ? "Projekte & Dokumentation" : "Fotos & Dokumente hochladen"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full" size="sm" variant="secondary">Projekte öffnen</Button>
            </CardContent>
          </Card>

          {/* Meine Stunden - Für Admin + Vorarbeiter */}
          {canManageTime && (
            <Card
              className="cursor-pointer hover:shadow-lg transition-all hover:border-primary/50"
              onClick={() => navigate("/my-hours")}
            >
              <CardHeader className="space-y-2 pb-3">
                <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
                  <BarChart3 className="h-6 w-6 text-primary" />
                </div>
                <CardTitle className="text-lg sm:text-xl">Meine Stunden</CardTitle>
                <CardDescription className="text-sm">
                  Übersicht gebuchter Zeiten
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button className="w-full" size="sm" variant="outline">Anzeigen</Button>
              </CardContent>
            </Card>
          )}

          {/* Regiearbeiten ausgeblendet - nicht mehr benötigt */}


          {/* Urlaub / Abwesenheit - Für alle Benutzer */}
          <Card
            className="cursor-pointer hover:shadow-lg transition-all hover:border-primary/50"
            onClick={() => navigate("/absence")}
          >
            <CardHeader className="space-y-2 pb-3">
              <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
                <Clock className="h-6 w-6 text-primary" />
              </div>
              <CardTitle className="text-lg sm:text-xl">Urlaub / Abwesenheit</CardTitle>
              <CardDescription className="text-sm">
                Urlaub, Krankenstand oder ZA eintragen
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full" size="sm">Abwesenheit melden</Button>
            </CardContent>
          </Card>

          {/* Meine Dokumente - Für Mitarbeiter + Vorarbeiter */}
          {!isAdmin && (
            <Card 
              className="cursor-pointer hover:shadow-lg transition-all hover:border-primary/50" 
              onClick={() => navigate("/my-documents")}
            >
              <CardHeader className="space-y-2 pb-3">
                <div className="h-12 w-12 rounded-lg bg-accent/10 flex items-center justify-center">
                  <FileText className="h-6 w-6 text-accent" />
                </div>
                <CardTitle className="text-lg sm:text-xl">Meine Dokumente</CardTitle>
                <CardDescription className="text-sm">
                  Lohnzettel & Krankmeldungen
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button className="w-full" size="sm" variant="outline">Dokumente öffnen</Button>
              </CardContent>
            </Card>
          )}


          {/* Admin: Stundenauswertung */}
          {isAdmin && (
            <Card 
              className="cursor-pointer hover:shadow-lg transition-all hover:border-primary/50" 
              onClick={() => navigate("/hours-report")}
            >
              <CardHeader className="space-y-2 pb-3">
                <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
                  <BarChart3 className="h-6 w-6 text-primary" />
                </div>
                <CardTitle className="text-lg sm:text-xl">Stundenauswertung</CardTitle>
                <CardDescription className="text-sm">
                  Auswertung der Projektstunden
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button className="w-full" size="sm">Auswerten</Button>
              </CardContent>
            </Card>
          )}

          {/* Admin: Mitarbeiter */}
          {isAdmin && (
            <Card 
              className="cursor-pointer hover:shadow-lg transition-all hover:border-primary/50" 
              onClick={() => navigate("/admin")}
            >
              <CardHeader className="space-y-2 pb-3">
                <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Users className="h-6 w-6 text-primary" />
                </div>
                <CardTitle className="text-lg sm:text-xl">Admin-Bereich</CardTitle>
                <CardDescription className="text-sm">
                  Benutzerverwaltung, Stunden & Verwaltung
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button className="w-full" size="sm" variant="outline">Verwalten</Button>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Recent Time Entries */}
        {recentEntries.length > 0 && (
          <div className="mt-6">
            <h2 className="text-xl sm:text-2xl font-bold mb-4">
              {canManageTime ? 'Letzte Projektbuchungen (Alle Mitarbeiter)' : 'Meine letzten Buchungen'}
            </h2>
            <div className="space-y-2">
              {recentEntries.map((entry) => (
                <Card 
                  key={entry.id} 
                  className="hover:shadow-md transition-shadow cursor-pointer"
                  onClick={() => {
                    if (entry.disturbance_id) {
                      navigate(`/disturbances/${entry.disturbance_id}`);
                    } else {
                      navigate("/my-hours");
                    }
                  }}
                >
                  <CardContent className="p-3">
                    <div className="flex justify-between items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm truncate">
                          {entry.projects?.name || (entry.disturbance_id ? "Regiebericht" : "Unbekanntes Projekt")}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">{entry.taetigkeit}</p>
                        {entry.profiles && (
                          <p className="text-xs text-muted-foreground">
                            von {entry.profiles.vorname} {entry.profiles.nachname}
                          </p>
                        )}
                      </div>
                      <div className="text-right ml-3 shrink-0">
                        <p className="font-bold">{entry.stunden} h</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(entry.datum).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })}
                        </p>
                      </div>
                      <ArrowRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
            <Button 
              variant="outline" 
              className="w-full mt-3" 
              onClick={() => navigate("/my-hours")}
            >
              Alle Stunden anzeigen
            </Button>
          </div>
        )}

        {!isAdmin && !isVorarbeiter && (
          <Card className="mt-6 bg-primary/5 border-primary/20">
            <CardHeader>
              <CardTitle className="text-lg">Schnellhilfe</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>✓ <strong>Projekte:</strong> Fotos & Dokumente auf Projekte hochladen</p>
              <p>✓ <strong>Urlaub:</strong> Urlaub oder Abwesenheit beantragen</p>
              <p>✓ <strong>Dokumente:</strong> Lohnzettel & Krankmeldungen einsehen</p>
            </CardContent>
          </Card>
        )}

        {/* Projects Overview */}
        {projects.length > 0 && (
          <div className="mt-6 sm:mt-8">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl sm:text-2xl font-bold">Aktive Projekte</h2>
              <Button variant="ghost" size="sm" onClick={() => navigate("/projects")}>
                Alle anzeigen
                <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
            
            <div className="grid gap-3 sm:gap-4">
              {projects.map((project) => (
                <Card 
                  key={project.id} 
                  className="hover:shadow-md transition-shadow cursor-pointer"
                  onClick={() => navigate("/projects")}
                >
                  <CardContent className="p-3 sm:p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0">
                        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                          <FolderKanban className="h-5 w-5 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-sm sm:text-base truncate">{project.name}</p>
                          <p className="text-xs text-muted-foreground">
                            Aktualisiert: {new Date(project.updated_at).toLocaleDateString("de-DE")}
                          </p>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}
      </main>

    </div>
  );
}
