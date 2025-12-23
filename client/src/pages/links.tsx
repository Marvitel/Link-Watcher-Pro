import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { LinkCard } from "@/components/link-card";
import { Network } from "lucide-react";
import type { Link as LinkType, Metric } from "@shared/schema";

export default function Links() {
  const { data: links, isLoading: linksLoading } = useQuery<LinkType[]>({
    queryKey: ["/api/links"],
    refetchInterval: 5000,
  });

  const { data: sedeMetrics } = useQuery<Metric[]>({
    queryKey: ["/api/links", "sede", "metrics"],
    refetchInterval: 5000,
  });

  const { data: centralMetrics } = useQuery<Metric[]>({
    queryKey: ["/api/links", "central", "metrics"],
    refetchInterval: 5000,
  });

  const sedeLink = links?.find((l) => l.id === "sede");
  const centralLink = links?.find((l) => l.id === "central");

  const sedeHistory = sedeMetrics?.map((m) => ({
    timestamp: m.timestamp,
    download: m.download,
    upload: m.upload,
  })) || [];

  const centralHistory = centralMetrics?.map((m) => ({
    timestamp: m.timestamp,
    download: m.download,
    upload: m.upload,
  })) || [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Links Dedicados</h1>
        <p className="text-muted-foreground">
          Visão geral dos links IP dedicados contratados
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Network className="w-5 h-5" />
            Especificações do Serviço
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-4 rounded-md bg-muted/50">
              <p className="text-sm text-muted-foreground">Velocidade</p>
              <p className="text-lg font-semibold font-mono">200 Mbps</p>
              <p className="text-xs text-muted-foreground">Simétrico (upload = download)</p>
            </div>
            <div className="p-4 rounded-md bg-muted/50">
              <p className="text-sm text-muted-foreground">Garantia de Banda</p>
              <p className="text-lg font-semibold font-mono">100%</p>
              <p className="text-xs text-muted-foreground">Banda mínima garantida</p>
            </div>
            <div className="p-4 rounded-md bg-muted/50">
              <p className="text-sm text-muted-foreground">Disponibilidade</p>
              <p className="text-lg font-semibold font-mono">20h x 7 x 365</p>
              <p className="text-xs text-muted-foreground">Meta SLA ≥ 99%</p>
            </div>
            <div className="p-4 rounded-md bg-muted/50">
              <p className="text-sm text-muted-foreground">Tecnologia</p>
              <p className="text-lg font-semibold">Fibra Óptica</p>
              <p className="text-xs text-muted-foreground">Dedicado, determinístico</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {linksLoading ? (
          <>
            {[1, 2].map((i) => (
              <Card key={i}>
                <CardHeader>
                  <Skeleton className="h-6 w-48" />
                </CardHeader>
                <CardContent className="space-y-4">
                  <Skeleton className="h-24 w-full" />
                  <div className="grid grid-cols-2 gap-4">
                    <Skeleton className="h-16 w-full" />
                    <Skeleton className="h-16 w-full" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </>
        ) : (
          <>
            {sedeLink && <LinkCard link={sedeLink} metricsHistory={sedeHistory} />}
            {centralLink && <LinkCard link={centralLink} metricsHistory={centralHistory} />}
          </>
        )}
      </div>
    </div>
  );
}
