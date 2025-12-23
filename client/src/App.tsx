import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeProvider } from "@/lib/theme";
import { ThemeToggle } from "@/components/theme-toggle";
import { AuthProvider, useAuth } from "@/lib/auth";
import { ClientProvider } from "@/lib/client-context";
import { ClientSelector } from "@/components/client-selector";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/dashboard";
import Links from "@/pages/links";
import LinkDetail from "@/pages/link-detail";
import Security from "@/pages/security";
import Events from "@/pages/events";
import Reports from "@/pages/reports";
import Settings from "@/pages/settings";
import Admin from "@/pages/admin";
import ClientUsers from "@/pages/client-users";
import Login from "@/pages/login";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/links" component={Links} />
      <Route path="/link/:id" component={LinkDetail} />
      <Route path="/security" component={Security} />
      <Route path="/events" component={Events} />
      <Route path="/reports" component={Reports} />
      <Route path="/settings" component={Settings} />
      <Route path="/users" component={ClientUsers} />
      <Route path="/admin" component={Admin} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AppContent() {
  const { user, isSuperAdmin, isLoading } = useAuth();
  const sidebarStyle = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  return (
    <ClientProvider>
      <SidebarProvider style={sidebarStyle as React.CSSProperties}>
        <div className="flex h-screen w-full">
          <AppSidebar />
          <div className="flex flex-col flex-1 overflow-hidden">
            <header className="flex items-center justify-between gap-2 px-4 py-2 border-b border-border bg-background sticky top-0 z-50">
              <div className="flex items-center gap-3">
                <SidebarTrigger data-testid="button-sidebar-toggle" />
                {isSuperAdmin ? (
                  <ClientSelector />
                ) : (
                  user.clientName && (
                    <span className="text-sm font-medium text-muted-foreground hidden sm:inline">
                      {user.clientName}
                    </span>
                  )
                )}
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground hidden sm:inline">
                  {user.name}
                </span>
                <ThemeToggle />
              </div>
            </header>
            <main className="flex-1 overflow-auto p-6">
              <Router />
            </main>
          </div>
        </div>
      </SidebarProvider>
    </ClientProvider>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <AuthProvider>
            <AppContent />
          </AuthProvider>
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
