import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard,
  Network,
  Building2,
  Shield,
  FileText,
  Settings,
  Activity,
  Server,
  Users,
} from "lucide-react";
import type { Link as LinkType } from "@shared/schema";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { useAuth } from "@/lib/auth";
import { useClientContext } from "@/lib/client-context";

export function AppSidebar() {
  const [location] = useLocation();
  const { user, isSuperAdmin, isClientAdmin } = useAuth();
  const { selectedClientId, selectedClientName, isViewingAsClient } = useClientContext();

  const { data: links } = useQuery<LinkType[]>({
    queryKey: ["/api/links", selectedClientId],
    queryFn: async () => {
      const url = selectedClientId ? `/api/links?clientId=${selectedClientId}` : "/api/links";
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch links");
      return res.json();
    },
    refetchInterval: 30000,
  });

  const navigationItems = [
    { title: "Dashboard", url: "/", icon: LayoutDashboard },
    { title: "Links", url: "/links", icon: Network },
  ];

  const securityItems = [
    { title: "Segurança", url: "/security", icon: Shield },
    { title: "Eventos", url: "/events", icon: Activity },
    { title: "Relatórios", url: "/reports", icon: FileText },
  ];

  const clientConfigItems = [
    ...(isClientAdmin || isSuperAdmin ? [{ title: "Usuários", url: "/users", icon: Users }] : []),
    { title: "Configurações", url: "/settings", icon: Settings },
  ];

  const superAdminItems = isSuperAdmin ? [
    { title: "Administração", url: "/admin", icon: Server },
  ] : [];

  return (
    <Sidebar>
      <SidebarHeader className="p-4 border-b border-sidebar-border">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-md bg-primary flex items-center justify-center">
            <Network className="w-5 h-5 text-primary-foreground" />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-sidebar-foreground">Link Monitor</span>
            <span className="text-xs text-muted-foreground">by Marvitel</span>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Principal</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navigationItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={location === item.url}
                  >
                    <Link href={item.url} data-testid={`link-nav-${item.title.toLowerCase()}`}>
                      <item.icon className="w-4 h-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>
            {isViewingAsClient && selectedClientName ? `Links - ${selectedClientName}` : "Localidades"}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {links?.map((link) => (
                <SidebarMenuItem key={link.id}>
                  <SidebarMenuButton
                    asChild
                    isActive={location === `/link/${link.id}`}
                  >
                    <Link href={`/link/${link.id}`} data-testid={`link-nav-link-${link.id}`}>
                      <Building2 className="w-4 h-4" />
                      <span>{link.name}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
              {(!links || links.length === 0) && (
                <SidebarMenuItem>
                  <span className="text-xs text-muted-foreground px-2">Nenhum link cadastrado</span>
                </SidebarMenuItem>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Monitoramento</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {securityItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={location === item.url}
                  >
                    <Link href={item.url} data-testid={`link-nav-${item.title.toLowerCase()}`}>
                      <item.icon className="w-4 h-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Sistema</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {clientConfigItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={location === item.url}
                  >
                    <Link href={item.url} data-testid={`link-nav-${item.title.toLowerCase()}`}>
                      <item.icon className="w-4 h-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {superAdminItems.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>Super Admin</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {superAdminItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      isActive={location === item.url}
                    >
                      <Link href={item.url} data-testid={`link-nav-${item.title.toLowerCase()}`}>
                        <item.icon className="w-4 h-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>
      <SidebarFooter className="p-4 border-t border-sidebar-border">
        <div className="text-xs text-muted-foreground">
          Marvitel Telecomunicações
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
