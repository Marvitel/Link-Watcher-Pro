import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BandwidthChart } from "./bandwidth-chart";
import { Link } from "wouter";
import { Layers, ArrowUpDown, Shield, Activity, AlertTriangle } from "lucide-react";
import type { Link as LinkType, Metric } from "@shared/schema";

interface LinkGroupMember {
  id: number;
  groupId: number;
  linkId: number;
  role: string;
  displayOrder: number;
  link?: LinkType;
}

interface LinkGroup {
  id: number;
  clientId: number;
  name: string;
  description: string | null;
  groupType: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  members?: LinkGroupMember[];
}

interface AggregatedMetrics {
  download: number;
  upload: number;
  latency: number;
  packetLoss: number;
  status: string;
  membersOnline: number;
  membersTotal: number;
}

interface LinkGroupCardProps {
  group: LinkGroup;
  metricsHistory?: Array<{
    timestamp: string;
    download: number;
    upload: number;
    status: string;
  }>;
  aggregatedMetrics?: AggregatedMetrics;
}

function formatBandwidth(bps: number): string {
  if (bps >= 1000000000) {
    return `${(bps / 1000000000).toFixed(2)} Gbps`;
  } else if (bps >= 1000000) {
    return `${(bps / 1000000).toFixed(2)} Mbps`;
  } else if (bps >= 1000) {
    return `${(bps / 1000).toFixed(2)} Kbps`;
  }
  return `${bps.toFixed(0)} bps`;
}

function getStatusBadge(status: string, membersOnline: number, membersTotal: number) {
  if (status === "operational") {
    if (membersOnline === membersTotal) {
      return <Badge className="bg-green-500/10 text-green-500 border-green-500/20">Online</Badge>;
    }
    return <Badge className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20">Degradado</Badge>;
  }
  if (status === "degraded") {
    return <Badge className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20">Degradado</Badge>;
  }
  return <Badge className="bg-red-500/10 text-red-500 border-red-500/20">Offline</Badge>;
}

export function LinkGroupCard({ group, metricsHistory, aggregatedMetrics }: LinkGroupCardProps) {
  const profileIcon = group.groupType === "redundancy" ? Shield : ArrowUpDown;
  const ProfileIcon = profileIcon;
  
  const membersOnline = aggregatedMetrics?.membersOnline ?? group.members?.filter(m => m.link?.status === "operational").length ?? 0;
  const membersTotal = aggregatedMetrics?.membersTotal ?? group.members?.length ?? 0;
  const status = aggregatedMetrics?.status ?? "unknown";

  const download = aggregatedMetrics?.download ?? 0;
  const upload = aggregatedMetrics?.upload ?? 0;
  const latency = aggregatedMetrics?.latency ?? 0;
  const packetLoss = aggregatedMetrics?.packetLoss ?? 0;

  const totalBandwidth = group.members?.reduce((sum, m) => sum + (m.link?.bandwidth || 0), 0) || 0;

  return (
    <Link href={`/link-groups/${group.id}`}>
      <Card className="hover-elevate cursor-pointer transition-all" data-testid={`card-link-group-${group.id}`}>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <div className="p-2 rounded-lg bg-primary/10">
                <Layers className="w-4 h-4 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <CardTitle className="text-base truncate">{group.name}</CardTitle>
                <div className="flex items-center gap-2 mt-1">
                  <ProfileIcon className="w-3 h-3 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">
                    {group.groupType === "redundancy" ? "Redundância" : "Agregação"}
                  </span>
                </div>
              </div>
            </div>
            {getStatusBadge(status, membersOnline, membersTotal)}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {metricsHistory && metricsHistory.length > 0 && (
            <BandwidthChart data={metricsHistory} height={80} showAxes={false} />
          )}
          
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Download</p>
              <p className="font-medium text-green-600">{formatBandwidth(download)}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Upload</p>
              <p className="font-medium text-blue-600">{formatBandwidth(upload)}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Latência</p>
              <p className="font-medium">{latency.toFixed(1)} ms</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Perda</p>
              <p className="font-medium">{packetLoss.toFixed(2)}%</p>
            </div>
          </div>

          <div className="pt-3 border-t">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-1 text-muted-foreground">
                <Activity className="w-3 h-3" />
                <span>{membersOnline}/{membersTotal} links ativos</span>
              </div>
              <span className="text-muted-foreground">
                {formatBandwidth(totalBandwidth)} contratados
              </span>
            </div>
            {group.members && group.members.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {group.members.slice(0, 3).map((m) => (
                  <Badge 
                    key={m.id} 
                    variant="outline" 
                    className="text-xs"
                  >
                    {m.link?.name || `Link ${m.linkId}`}
                    {m.role !== "member" && ` (${m.role})`}
                  </Badge>
                ))}
                {group.members.length > 3 && (
                  <Badge variant="outline" className="text-xs">
                    +{group.members.length - 3}
                  </Badge>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
