import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge, StatusDot } from "./status-badge";
import { Activity, ArrowDownToLine, ArrowUpFromLine, Clock, Gauge, Percent } from "lucide-react";
import { Link as RouterLink } from "wouter";
import type { Link } from "@shared/schema";
import { BandwidthChart } from "./bandwidth-chart";

interface LinkCardProps {
  link: Link;
  metricsHistory?: Array<{ timestamp: string; download: number; upload: number }>;
}

export function LinkCard({ link, metricsHistory = [] }: LinkCardProps) {
  const detailUrl = `/link/${link.id}`;
  
  // Proteção contra valores nulos/undefined
  const currentDownload = link.currentDownload ?? 0;
  const currentUpload = link.currentUpload ?? 0;
  const latency = link.latency ?? 0;
  const packetLoss = link.packetLoss ?? 0;
  const uptime = link.uptime ?? 0;

  return (
    <Card className="overflow-visible" data-testid={`card-link-${link.id}`}>
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 pb-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <StatusDot status={link.status} size="md" />
            <CardTitle className="text-lg font-semibold">{link.name}</CardTitle>
          </div>
          <p className="text-sm text-muted-foreground">{link.location}</p>
        </div>
        <StatusBadge status={link.status} />
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="h-24">
          <BandwidthChart data={metricsHistory} height={96} />
        </div>
        
        <div className="grid grid-cols-2 gap-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-md bg-blue-500/10 flex items-center justify-center">
              <ArrowDownToLine className="w-4 h-4 text-blue-500" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Download</p>
              <p className="text-sm font-mono font-medium" data-testid={`text-download-${link.id}`}>
                {currentDownload.toFixed(1)} Mbps
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-md bg-green-500/10 flex items-center justify-center">
              <ArrowUpFromLine className="w-4 h-4 text-green-500" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Upload</p>
              <p className="text-sm font-mono font-medium" data-testid={`text-upload-${link.id}`}>
                {currentUpload.toFixed(1)} Mbps
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 pt-2 border-t border-border">
          <div className="text-center">
            <div className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
              <Clock className="w-3 h-3" />
              <span className="text-xs">Latência</span>
            </div>
            <p className="text-sm font-mono font-medium" data-testid={`text-latency-${link.id}`}>
              {latency.toFixed(0)} ms
            </p>
          </div>
          <div className="text-center">
            <div className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
              <Percent className="w-3 h-3" />
              <span className="text-xs">Perda</span>
            </div>
            <p className="text-sm font-mono font-medium" data-testid={`text-packetloss-${link.id}`}>
              {packetLoss.toFixed(2)}%
            </p>
          </div>
          <div className="text-center">
            <div className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
              <Activity className="w-3 h-3" />
              <span className="text-xs">Uptime</span>
            </div>
            <p className="text-sm font-mono font-medium" data-testid={`text-uptime-${link.id}`}>
              {uptime.toFixed(2)}%
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 pt-2 border-t border-border">
          <div className="text-xs text-muted-foreground">
            <span className="font-medium">IP:</span> {link.ipBlock}
          </div>
          <RouterLink href={detailUrl}>
            <Button variant="outline" size="sm" data-testid={`button-details-${link.id}`}>
              Detalhes
            </Button>
          </RouterLink>
        </div>
      </CardContent>
    </Card>
  );
}
