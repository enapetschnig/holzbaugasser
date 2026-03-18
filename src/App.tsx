import { useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { OnboardingProvider } from "./contexts/OnboardingContext";
import { InstallPromptDialog } from "./components/InstallPromptDialog";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { useOnboarding } from "./contexts/OnboardingContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import TimeTracking from "./pages/TimeTracking";
import Projects from "./pages/Projects";
import ProjectDetail from "./pages/ProjectDetail";
import ProjectOverview from "./pages/ProjectOverview";
import MyHours from "./pages/MyHours";
import MyDocuments from "./pages/MyDocuments";
import Reports from "./pages/Reports";
import ConstructionSites from "./pages/ConstructionSites";
import Admin from "./pages/Admin";
import HoursReport from "./pages/HoursReport";
import Employees from "./pages/Employees";
import Notepad from "./pages/Notepad";
import Absence from "./pages/Absence";
import Disturbances from "./pages/Disturbances";
import DisturbanceDetail from "./pages/DisturbanceDetail";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

function AppContent() {
  const {
    showInstallDialog,
    handleInstallDialogClose,
  } = useOnboarding();

  // Ensure user profile exists (for users created via Cloud dashboard)
  useEffect(() => {
    const ensureProfile = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.rpc('ensure_user_profile');
      }
    };
    ensureProfile();
  }, []);

  // Check if user still exists (handles deleted users)
  useEffect(() => {
    const checkUserExists = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      // Try to get user from auth - if deleted, this will fail
      const { error } = await supabase.auth.getUser();
      if (error) {
        // User was deleted - force logout
        await supabase.auth.signOut();
        window.location.href = "/auth";
      }
    };
    const interval = setInterval(checkUserExists, 30000); // Every 30s
    return () => clearInterval(interval);
  }, []);

  // Realtime listener for in-app notifications (popup)
  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const setupNotifications = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      channel = supabase
        .channel("user-notifications")
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "notifications",
            filter: `user_id=eq.${user.id}`,
          },
          (payload) => {
            const notification = payload.new as {
              title: string;
              message: string;
              type: string;
            };
            toast({
              title: notification.title,
              description: notification.message,
              duration: 8000,
            });
          }
        )
        .subscribe();
    };

    setupNotifications();

    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  return (
    <>
      <Routes>
        <Route path="/" element={<Index />} />
        <Route path="/auth" element={<Auth />} />
        <Route path="/time-tracking" element={<TimeTracking />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="/projects/:projectId" element={<ProjectOverview />} />
        <Route path="/projects/:projectId/:type" element={<ProjectDetail />} />
        <Route path="/my-hours" element={<MyHours />} />
        <Route path="/my-documents" element={<MyDocuments />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/construction-sites" element={<ConstructionSites />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/hours-report" element={<HoursReport />} />
        <Route path="/employees" element={<Employees />} />
        <Route path="/notepad" element={<Notepad />} />
        <Route path="/absence" element={<Absence />} />
        <Route path="/disturbances" element={<Disturbances />} />
        <Route path="/disturbances/:id" element={<DisturbanceDetail />} />
        <Route path="*" element={<NotFound />} />
      </Routes>

      {/* Install Prompt Dialog */}
      <InstallPromptDialog
        open={showInstallDialog}
        onClose={handleInstallDialogClose}
      />
    </>
  );
}

const App = () => (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <OnboardingProvider>
            <AppContent />
          </OnboardingProvider>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
