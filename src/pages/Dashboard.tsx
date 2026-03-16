import { Building2, Clock, FileText, FolderOpen, Users, FileSpreadsheet, Zap, Bell, X } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatDistanceToNow } from "date-fns";
import { de } from "date-fns/locale";

type Notification = {
  id: string;
  type: string;
  title: string;
  message: string;
  is_read: boolean;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

const Dashboard = () => {
  const navigate = useNavigate();
  const [isAdmin, setIsAdmin] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    init();
  }, []);

  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel("dashboard-notifications")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (payload) => setNotifications((prev) => [payload.new as Notification, ...prev])
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId]);

  const init = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setUserId(user.id);

    const { data: role } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .single();
    setIsAdmin(role?.role === "administrator");

    const { data: notifs } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", user.id)
      .eq("is_read", false)
      .order("created_at", { ascending: false })
      .limit(10);
    if (notifs) setNotifications(notifs as Notification[]);
  };

  const handleNotificationClick = async (notif: Notification) => {
    await supabase.from("notifications").update({ is_read: true }).eq("id", notif.id);
    setNotifications((prev) => prev.filter((n) => n.id !== notif.id));

    if (notif.type === "lohnzettel_upload") navigate("/my-documents");
    else if (notif.type === "krankmeldung_upload") navigate("/employees");
  };

  const dismissNotification = async (e: React.MouseEvent, notifId: string) => {
    e.stopPropagation();
    await supabase.from("notifications").update({ is_read: true }).eq("id", notifId);
    setNotifications((prev) => prev.filter((n) => n.id !== notifId));
  };

  const features = [
    {
      title: "Zeiterfassung",
      description: "Stunden schnell und einfach erfassen",
      icon: Clock,
      action: () => navigate("/time-tracking"),
      color: "bg-primary/10 text-primary"
    },
    {
      title: "Regieberichte",
      description: "Service-Einsätze dokumentieren",
      icon: Zap,
      action: () => navigate("/disturbances"),
      color: "bg-amber-500/10 text-amber-600"
    },
    {
      title: "Projekte",
      description: "Bauvorhaben verwalten und dokumentieren",
      icon: FolderOpen,
      action: () => navigate("/projects"),
      color: "bg-accent/10 text-accent"
    },
    {
      title: "Baustellen",
      description: "Aktuelle Baustellenübersicht",
      icon: Building2,
      action: () => navigate("/construction-sites"),
      color: "bg-secondary text-secondary-foreground"
    },
  ];

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        <div className="mb-8">
          <div className="flex items-center gap-4 mb-4">
            <img src="/gasser-logo.png" alt="Holzbau Gasser" className="h-20 w-20 object-contain" />
            <div>
              <h1 className="text-4xl font-bold text-foreground">Holzbau Gasser</h1>
              <p className="text-muted-foreground">Digitale Projektdokumentation</p>
            </div>
          </div>
        </div>

        {notifications.length > 0 && (
          <div className="mb-6 space-y-2">
            {notifications.map((notif) => (
              <Card
                key={notif.id}
                className="border-l-4 border-l-blue-500 cursor-pointer hover:bg-muted/50 transition-colors"
                onClick={() => handleNotificationClick(notif)}
              >
                <CardContent className="flex items-center gap-3 py-3 px-4">
                  <Bell className="h-5 w-5 text-blue-500 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">{notif.title}</p>
                    <p className="text-xs text-muted-foreground truncate">{notif.message}</p>
                  </div>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {formatDistanceToNow(new Date(notif.created_at), { addSuffix: true, locale: de })}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 flex-shrink-0"
                    onClick={(e) => dismissNotification(e, notif.id)}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {features.map((feature) => {
            const Icon = feature.icon;
            return (
              <Card key={feature.title} className="hover:shadow-lg transition-all duration-300 border-2 cursor-pointer" onClick={feature.action}>
                <CardHeader>
                  <div className={`w-14 h-14 rounded-xl ${feature.color} flex items-center justify-center mb-4`}>
                    <Icon className="w-7 h-7" />
                  </div>
                  <CardTitle className="text-2xl">{feature.title}</CardTitle>
                  <CardDescription className="text-base">{feature.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <Button className="w-full" size="lg">
                    Öffnen
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {isAdmin && (
          <div className="mt-6">
            <h2 className="text-2xl font-bold mb-4">Admin-Bereich</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card className="hover:shadow-lg transition-all duration-300 border-2 border-orange-200 cursor-pointer" onClick={() => navigate("/hours-report")}>
                <CardHeader>
                  <div className="w-14 h-14 rounded-xl bg-orange-50 text-orange-600 flex items-center justify-center mb-4">
                    <FileSpreadsheet className="w-7 h-7" />
                  </div>
                  <CardTitle className="text-2xl">Stundenauswertung</CardTitle>
                  <CardDescription className="text-base">Monatsberichte mit Überstunden exportieren</CardDescription>
                </CardHeader>
                <CardContent>
                  <Button className="w-full" size="lg">
                    Öffnen
                  </Button>
                </CardContent>
              </Card>

              <Card className="hover:shadow-lg transition-all duration-300 border-2 border-blue-200 cursor-pointer" onClick={() => navigate("/employees")}>
                <CardHeader>
                  <div className="w-14 h-14 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center mb-4">
                    <Users className="w-7 h-7" />
                  </div>
                  <CardTitle className="text-2xl">Mitarbeiterverwaltung</CardTitle>
                  <CardDescription className="text-base">Stammdaten und Dokumente verwalten</CardDescription>
                </CardHeader>
                <CardContent>
                  <Button className="w-full" size="lg">
                    Öffnen
                  </Button>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        <Card className="mt-8 bg-primary/5 border-primary/20">
          <CardHeader>
            <CardTitle className="text-xl">Schnellzugriff</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Button variant="outline" className="h-24 flex-col gap-2" onClick={() => navigate("/time-tracking")}>
              <Clock className="w-6 h-6" />
              <span>Zeit eintragen</span>
            </Button>
            <Button variant="outline" className="h-24 flex-col gap-2" onClick={() => navigate("/projects")}>
              <FolderOpen className="w-6 h-6" />
              <span>Neues Projekt</span>
            </Button>
            <Button variant="outline" className="h-24 flex-col gap-2" onClick={() => navigate("/reports")}>
              <FileText className="w-6 h-6" />
              <span>Bericht erstellen</span>
            </Button>
            <Button variant="outline" className="h-24 flex-col gap-2" onClick={() => navigate("/construction-sites")}>
              <Building2 className="w-6 h-6" />
              <span>Baustelle öffnen</span>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Dashboard;
