import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { 
  Network, 
  MapPin, 
  Ruler, 
  Zap, 
  Cable, 
  Box, 
  Split, 
  RefreshCw, 
  AlertTriangle,
  CheckCircle,
  Info
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import type { Link } from "@shared/schema";

interface OzmapPotencyElement {
  name: string;
  type: string;
  loss?: number;
  length?: number;
  splitterRatio?: string;
}

interface OzmapPotencyData {
  totalLength: number;
  totalLoss: number;
  elements: OzmapPotencyElement[];
  calculatedPower?: number;
  oltPower?: number;
}

interface OzmapRouteSectionProps {
  link: Link;
}

function getElementIcon(type: string) {
  switch (type.toLowerCase()) {
    case 'cable':
    case 'cabo':
      return Cable;
    case 'splitter':
      return Split;
    case 'box':
    case 'caixa':
    case 'cto':
      return Box;
    case 'dio':
    case 'olt':
      return Network;
    case 'fusion':
    case 'fusao':
    case 'emenda':
      return Zap;
    default:
      return MapPin;
  }
}

function formatLength(meters: number): string {
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(2)} km`;
  }
  return `${meters.toFixed(0)} m`;
}

function formatLoss(dB: number): string {
  return `${dB.toFixed(2)} dB`;
}

function getPowerStatus(power: number): { status: 'good' | 'warning' | 'critical', label: string } {
  if (power >= -25 && power <= -8) {
    return { status: 'good', label: 'Normal' };
  } else if (power < -25 && power >= -27) {
    return { status: 'warning', label: 'Atenção' };
  } else if (power > -8) {
    return { status: 'warning', label: 'Saturação' };
  } else {
    return { status: 'critical', label: 'Crítico' };
  }
}

export function OzmapRouteSection({ link }: OzmapRouteSectionProps) {
  // Usa a tag do contrato Voalle como identificador para OZmap
  const ozmapTag = (link as any).voalleContractTagServiceTag || (link as any).ozmapTag;

  const { data, isLoading, error, refetch, isFetching } = useQuery<{ 
    linkId: number; 
    ozmapTag: string; 
    potencyData: OzmapPotencyData 
  }>({
    queryKey: ['/api/links', link.id, 'ozmap-potency'],
    enabled: !!ozmapTag,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  if (!ozmapTag) {
    return null;
  }

  if (error) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <Network className="h-5 w-5" />
            Rota de Fibra (OZmap)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-4 w-4" />
            <span className="text-sm">Erro ao carregar dados do OZmap</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <Network className="h-5 w-5" />
            Rota de Fibra (OZmap)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-4">
            <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
            <span className="ml-2 text-sm text-muted-foreground">Carregando rota...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  const potencyData = data?.potencyData;

  if (!potencyData) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <Network className="h-5 w-5" />
            Rota de Fibra (OZmap)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-muted-foreground">
            <Info className="h-4 w-4" />
            <span className="text-sm">Nenhum dado disponível para etiqueta "{ozmapTag}"</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  const powerStatus = potencyData.calculatedPower 
    ? getPowerStatus(potencyData.calculatedPower) 
    : null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Network className="h-5 w-5" />
            Rota de Fibra (OZmap)
            <Badge variant="outline" className="ml-2 text-xs">
              {ozmapTag}
            </Badge>
          </CardTitle>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => refetch()}
            disabled={isFetching}
            data-testid="button-refresh-ozmap"
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4" data-testid="ozmap-stats-grid">
          <div className="flex items-center gap-2 p-3 rounded-md bg-muted/50" data-testid="ozmap-stat-length">
            <Ruler className="h-5 w-5 text-blue-500" />
            <div>
              <p className="text-xs text-muted-foreground">Comprimento Total</p>
              <p className="font-semibold" data-testid="text-ozmap-length">{formatLength(potencyData.totalLength || 0)}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 p-3 rounded-md bg-muted/50" data-testid="ozmap-stat-loss">
            <Zap className="h-5 w-5 text-orange-500" />
            <div>
              <p className="text-xs text-muted-foreground">Atenuação Total</p>
              <p className="font-semibold" data-testid="text-ozmap-loss">{formatLoss(potencyData.totalLoss || 0)}</p>
            </div>
          </div>

          {potencyData.oltPower && (
            <div className="flex items-center gap-2 p-3 rounded-md bg-muted/50" data-testid="ozmap-stat-olt-power">
              <Network className="h-5 w-5 text-purple-500" />
              <div>
                <p className="text-xs text-muted-foreground">Potência OLT</p>
                <p className="font-semibold" data-testid="text-ozmap-olt-power">{potencyData.oltPower.toFixed(2)} dBm</p>
              </div>
            </div>
          )}

          {potencyData.calculatedPower && powerStatus && (
            <div className="flex items-center gap-2 p-3 rounded-md bg-muted/50" data-testid="ozmap-stat-calculated-power">
              {powerStatus.status === 'good' ? (
                <CheckCircle className="h-5 w-5 text-green-500" />
              ) : powerStatus.status === 'warning' ? (
                <AlertTriangle className="h-5 w-5 text-yellow-500" />
              ) : (
                <AlertTriangle className="h-5 w-5 text-red-500" />
              )}
              <div>
                <p className="text-xs text-muted-foreground">Potência Calculada</p>
                <p className="font-semibold" data-testid="text-ozmap-calculated-power">{potencyData.calculatedPower.toFixed(2)} dBm</p>
                <Badge 
                  variant={powerStatus.status === 'good' ? 'default' : powerStatus.status === 'warning' ? 'secondary' : 'destructive'}
                  className="text-xs mt-1"
                  data-testid="badge-ozmap-power-status"
                >
                  {powerStatus.label}
                </Badge>
              </div>
            </div>
          )}
        </div>

        {potencyData.elements && potencyData.elements.length > 0 && (
          <div className="space-y-2" data-testid="ozmap-route-elements">
            <h4 className="text-sm font-medium text-muted-foreground">Elementos da Rota</h4>
            <div className="relative">
              <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-border" />
              <div className="space-y-3">
                {potencyData.elements.map((element, index) => {
                  const Icon = getElementIcon(element.type);
                  return (
                    <div key={index} className="relative flex items-start gap-3 pl-8" data-testid={`ozmap-route-element-${index}`}>
                      <div className="absolute left-2 p-1 bg-background rounded-full border">
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="flex-1 flex items-center justify-between gap-2 p-2 rounded-md bg-muted/30">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm" data-testid={`text-ozmap-element-name-${index}`}>{element.name}</span>
                          <Badge variant="outline" className="text-xs" data-testid={`badge-ozmap-element-type-${index}`}>
                            {element.type}
                          </Badge>
                          {element.splitterRatio && (
                            <Badge variant="secondary" className="text-xs" data-testid={`badge-ozmap-splitter-ratio-${index}`}>
                              {element.splitterRatio}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-4 text-sm text-muted-foreground">
                          {element.length !== undefined && element.length > 0 && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="flex items-center gap-1">
                                  <Ruler className="h-3 w-3" />
                                  {formatLength(element.length)}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>Comprimento</TooltipContent>
                            </Tooltip>
                          )}
                          {element.loss !== undefined && element.loss > 0 && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="flex items-center gap-1 text-orange-500">
                                  <Zap className="h-3 w-3" />
                                  {formatLoss(element.loss)}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>Atenuação</TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
