import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
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
  Info,
  Radio,
  CircleDot,
  ArrowRight,
  ChevronDown,
  ChevronUp
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { Link } from "@shared/schema";

interface OzmapRouteElement {
  element: {
    id: string;
    name: string;
    kind: string;
    observation?: string | null;
    label?: string | null;
    tray?: string | null;
    port?: string | null;
    connectables?: any | null;
    shelf?: string | null;
  };
  parent: {
    id: string;
    name: string;
    kind?: string;
    length?: number;
  };
  attenuation: number;
  distance: number;
  _convertedValues?: {
    distance: {
      m: number;
      km: number;
      ft: number;
      mi: number;
    };
  };
}

interface OzmapPotencyData {
  id: string;
  potency: number | null;
  pon_reached: boolean;
  distance: number;
  attenuation: number;
  box_id: string | null;
  arriving_potency: number;
  elements: OzmapRouteElement[];
  olt_id?: string;
  olt_name?: string;
  slot?: number;
  port?: number;
}

interface OzmapRouteSectionProps {
  link: Link;
}

function getElementIcon(kind: string) {
  switch (kind.toLowerCase()) {
    case 'fiber':
    case 'fibra':
      return Cable;
    case 'cable':
    case 'cabo':
      return Cable;
    case 'splitter':
      return Split;
    case 'passing':
      return CircleDot;
    case 'box':
    case 'caixa':
    case 'cto':
    case 'ceo':
      return Box;
    case 'dio':
      return Network;
    case 'olt':
      return Radio;
    case 'fusion':
    case 'fusao':
    case 'emenda':
      return Zap;
    case 'connector':
    case 'conector':
      return CircleDot;
    default:
      return MapPin;
  }
}

function getElementColor(kind: string): string {
  switch (kind.toLowerCase()) {
    case 'fiber':
    case 'fibra':
      return 'text-yellow-500';
    case 'cable':
    case 'cabo':
      return 'text-blue-500';
    case 'splitter':
      return 'text-purple-500';
    case 'passing':
      return 'text-gray-500';
    case 'box':
    case 'caixa':
    case 'cto':
    case 'ceo':
      return 'text-green-500';
    case 'dio':
      return 'text-indigo-500';
    case 'olt':
      return 'text-red-500';
    case 'fusion':
    case 'fusao':
    case 'emenda':
      return 'text-orange-500';
    default:
      return 'text-muted-foreground';
  }
}

function formatDistance(km: number): string {
  if (km < 1) {
    return `${(km * 1000).toFixed(0)} m`;
  }
  return `${km.toFixed(2)} km`;
}

function formatAttenuation(dB: number): string {
  if (dB === 0) return '-';
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

function getKindLabel(kind: string): string {
  switch (kind.toLowerCase()) {
    case 'fiber': return 'Fibra';
    case 'cable': return 'Cabo';
    case 'splitter': return 'Splitter';
    case 'passing': return 'Passagem';
    case 'box': return 'Caixa';
    case 'fusion': return 'Fusão';
    case 'connector': return 'Conector';
    case 'dio': return 'DIO';
    case 'olt': return 'OLT';
    default: return kind;
  }
}

export function OzmapRouteSection({ link }: OzmapRouteSectionProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const ozmapTag = (link as any).voalleContractTagServiceTag || link.identifier || (link as any).ozmapTag;

  const { data, isLoading, error, refetch, isFetching } = useQuery<{ 
    linkId: number; 
    ozmapTag: string; 
    potencyData: OzmapPotencyData[];
    routeData?: any;
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

  const rawPotencyData = data?.potencyData;

  if (!rawPotencyData || (Array.isArray(rawPotencyData) && rawPotencyData.length === 0)) {
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

  const potencyItem = Array.isArray(rawPotencyData) ? rawPotencyData[0] : null;
  
  if (!potencyItem) {
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
            <span className="text-sm">Dados incompletos para etiqueta "{ozmapTag}"</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  const totalDistance = potencyItem.distance;
  const totalAttenuation = potencyItem.attenuation;
  const arrivingPotency = potencyItem.arriving_potency;
  const ponReached = potencyItem.pon_reached;
  const elements = potencyItem.elements || [];

  const powerStatus = arrivingPotency ? getPowerStatus(arrivingPotency) : null;

  const groupedElements = elements.reduce((acc: any[], element, index) => {
    if (element.element.kind === 'Fiber' && element.parent.kind === 'Cable') {
      const existingCable = acc.find(g => g.type === 'cable' && g.id === element.parent.id);
      if (!existingCable) {
        acc.push({
          type: 'cable',
          id: element.parent.id,
          name: element.parent.name,
          length: element.parent.length,
          fiber: element.element.name,
          attenuation: element.attenuation,
          distance: element.distance,
        });
      }
    } else if (element.element.kind === 'Passing' || element.element.kind === 'Splitter' || element.element.kind === 'Fusion' || element.element.kind === 'Connector') {
      acc.push({
        type: element.element.kind.toLowerCase(),
        id: element.element.id,
        name: element.parent.name || element.element.name || 'Elemento',
        elementName: element.element.name,
        attenuation: element.attenuation,
        distance: element.distance,
        port: element.element.port,
        label: element.element.label,
      });
    }
    return acc;
  }, []);

  const cableCount = groupedElements.filter(e => e.type === 'cable').length;
  const boxCount = groupedElements.filter(e => e.type === 'passing').length;
  const splitterCount = groupedElements.filter(e => e.type === 'splitter').length;

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
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsExpanded(!isExpanded)}
              data-testid="button-expand-route"
            >
              {isExpanded ? (
                <>
                  <ChevronUp className="h-4 w-4 mr-1" />
                  Recolher
                </>
              ) : (
                <>
                  <ChevronDown className="h-4 w-4 mr-1" />
                  Expandir Rota
                </>
              )}
            </Button>
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
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="ozmap-stats-grid">
          <div className="flex items-center gap-2 p-3 rounded-md bg-muted/50" data-testid="ozmap-stat-length">
            <Ruler className="h-5 w-5 text-blue-500" />
            <div>
              <p className="text-xs text-muted-foreground">Distância Total</p>
              <p className="font-semibold" data-testid="text-ozmap-length">{formatDistance(totalDistance)}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 p-3 rounded-md bg-muted/50" data-testid="ozmap-stat-attenuation">
            <Zap className="h-5 w-5 text-orange-500" />
            <div>
              <p className="text-xs text-muted-foreground">Atenuação Total</p>
              <p className="font-semibold" data-testid="text-ozmap-attenuation">{formatAttenuation(totalAttenuation)}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 p-3 rounded-md bg-muted/50" data-testid="ozmap-stat-pon">
            {ponReached ? (
              <CheckCircle className="h-5 w-5 text-green-500" />
            ) : (
              <AlertTriangle className="h-5 w-5 text-yellow-500" />
            )}
            <div>
              <p className="text-xs text-muted-foreground">PON Alcançada</p>
              <p className="font-semibold" data-testid="text-ozmap-pon">{ponReached ? "Sim" : "Não"}</p>
            </div>
          </div>

          {arrivingPotency && powerStatus && (
            <div className="flex items-center gap-2 p-3 rounded-md bg-muted/50" data-testid="ozmap-stat-power">
              {powerStatus.status === 'good' ? (
                <CheckCircle className="h-5 w-5 text-green-500" />
              ) : powerStatus.status === 'warning' ? (
                <AlertTriangle className="h-5 w-5 text-yellow-500" />
              ) : (
                <AlertTriangle className="h-5 w-5 text-red-500" />
              )}
              <div>
                <p className="text-xs text-muted-foreground">Potência de Chegada</p>
                <p className="font-semibold" data-testid="text-ozmap-power">{arrivingPotency.toFixed(2)} dBm</p>
                <Badge 
                  variant={powerStatus.status === 'good' ? 'default' : powerStatus.status === 'warning' ? 'secondary' : 'destructive'}
                  className="text-xs mt-1"
                >
                  {powerStatus.label}
                </Badge>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-1">
            <Cable className="h-4 w-4 text-blue-500" />
            <span>{cableCount} cabos</span>
          </div>
          <div className="flex items-center gap-1">
            <Box className="h-4 w-4 text-green-500" />
            <span>{boxCount} caixas</span>
          </div>
          {splitterCount > 0 && (
            <div className="flex items-center gap-1">
              <Split className="h-4 w-4 text-purple-500" />
              <span>{splitterCount} splitters</span>
            </div>
          )}
        </div>

        {isExpanded && groupedElements.length > 0 && (
          <div className="space-y-2" data-testid="ozmap-route-elements">
            <h4 className="text-sm font-medium text-muted-foreground">Elementos da Rota (Cliente → OLT)</h4>
            <ScrollArea className="h-[400px] rounded-md border p-2">
              <div className="space-y-1">
                {groupedElements.map((item, index) => {
                  const Icon = item.type === 'cable' ? Cable : 
                               item.type === 'passing' ? Box : 
                               item.type === 'splitter' ? Split :
                               item.type === 'fusion' ? Zap :
                               item.type === 'connector' ? CircleDot : MapPin;
                  
                  const colorClass = item.type === 'cable' ? 'text-blue-500' : 
                                     item.type === 'passing' ? 'text-green-500' : 
                                     item.type === 'splitter' ? 'text-purple-500' :
                                     item.type === 'fusion' ? 'text-orange-500' : 'text-gray-500';

                  return (
                    <div 
                      key={`${item.type}-${item.id}-${index}`}
                      className="flex items-center gap-3 p-2 rounded-md hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-muted">
                        <Icon className={`h-4 w-4 ${colorClass}`} />
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium truncate">{item.name}</p>
                          {item.type === 'cable' && item.fiber && (
                            <Badge variant="outline" className="text-xs shrink-0">
                              {item.fiber}
                            </Badge>
                          )}
                          {item.type === 'splitter' && item.port && (
                            <Badge variant="secondary" className="text-xs shrink-0">
                              Porta {item.port}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          <span>{getKindLabel(item.type)}</span>
                          {item.type === 'cable' && item.length && (
                            <span>• {formatDistance(item.length)}</span>
                          )}
                          {item.attenuation > 0 && (
                            <span>• {formatAttenuation(item.attenuation)}</span>
                          )}
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <p className="text-xs text-muted-foreground">Distância</p>
                        <p className="text-sm font-medium">{formatDistance(item.distance)}</p>
                      </div>

                      {index < groupedElements.length - 1 && (
                        <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
                      )}
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </div>
        )}

        {potencyItem.olt_name && (
          <div className="flex items-center gap-2 p-2 rounded-md bg-muted/30">
            <Radio className="h-4 w-4 text-red-500" />
            <div>
              <p className="text-xs text-muted-foreground">OLT de Origem</p>
              <p className="text-sm font-medium">{potencyItem.olt_name}</p>
              {potencyItem.slot !== undefined && potencyItem.port !== undefined && (
                <p className="text-xs text-muted-foreground">Slot {potencyItem.slot} / Porta {potencyItem.port}</p>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
