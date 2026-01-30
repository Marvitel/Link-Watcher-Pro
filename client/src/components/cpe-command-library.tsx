import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { 
  Terminal, 
  ChevronDown, 
  ChevronRight, 
  Copy, 
  Play, 
  History, 
  Clock, 
  Search,
  Loader2,
  BookOpen
} from "lucide-react";
import type { EquipmentVendor } from "@shared/schema";

interface CpeCommandTemplate {
  id: number;
  vendorId: number | null;
  model: string | null;
  name: string;
  command: string;
  description: string | null;
  category: string;
  isActive: boolean;
  parameters: string | null;
  sortOrder: number;
}

interface CommandParameter {
  name: string;
  type?: string;
  required?: boolean;
  label?: string;
  defaultValue?: string;
}

interface CpeInfo {
  id: number;
  cpeId: number;
  linkCpeId?: number;
  vendorId?: number | null;
  model?: string | null;
  name?: string;
}

interface CpeCommandLibraryProps {
  linkId: number;
  cpe: CpeInfo | null;
  onExecuteCommand?: (command: string) => void;
}

const COMMAND_CATEGORIES = [
  { value: "logs", label: "Logs", color: "bg-blue-500" },
  { value: "hardware", label: "Hardware", color: "bg-orange-500" },
  { value: "network", label: "Rede", color: "bg-green-500" },
  { value: "diagnostic", label: "Diagnóstico", color: "bg-purple-500" },
  { value: "backup", label: "Backup", color: "bg-yellow-500" },
  { value: "config", label: "Configuração", color: "bg-red-500" },
  { value: "interface", label: "Interfaces", color: "bg-cyan-500" },
  { value: "routing", label: "Roteamento", color: "bg-pink-500" },
  { value: "other", label: "Outros", color: "bg-gray-500" },
];

export function CpeCommandLibrary({ linkId, cpe, onExecuteCommand }: CpeCommandLibraryProps) {
  const { toast } = useToast();
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(["diagnostic", "logs"]));
  const [searchTerm, setSearchTerm] = useState("");
  const [paramDialogOpen, setParamDialogOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<CpeCommandTemplate | null>(null);
  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  
  const vendorId = cpe?.vendorId;
  const model = cpe?.model;

  const { data: templates, isLoading } = useQuery<CpeCommandTemplate[]>({
    queryKey: ["/api/cpe-command-templates", { vendorId, model }],
    queryFn: async () => {
      let url = "/api/cpe-command-templates";
      const params = new URLSearchParams();
      if (vendorId) params.append("vendorId", vendorId.toString());
      if (model) params.append("model", model);
      if (params.toString()) url += `?${params.toString()}`;
      
      const response = await fetch(url, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch templates");
      return response.json();
    },
  });

  const { data: diagnosticTargets } = useQuery<Array<{ id: number; name: string; ipAddress: string; category: string }>>({
    queryKey: ["/api/diagnostic-targets"],
  });

  const logCommandMutation = useMutation({
    mutationFn: async (data: { command: string; templateId?: number }) => {
      if (!cpe?.cpeId) return;
      return apiRequest("POST", `/api/cpe/${cpe.cpeId}/command-history`, {
        linkId,
        linkCpeId: cpe.linkCpeId,
        templateId: data.templateId,
        command: data.command,
        status: "executed",
      });
    },
  });

  const parseParameters = (parametersJson: string | null): CommandParameter[] => {
    if (!parametersJson) return [];
    try {
      return JSON.parse(parametersJson);
    } catch {
      return [];
    }
  };

  const extractPlaceholders = (command: string): string[] => {
    const matches = command.match(/\{([^}]+)\}/g);
    return matches ? matches.map(m => m.slice(1, -1)) : [];
  };

  const hasPlaceholders = (command: string): boolean => {
    return /\{[^}]+\}/.test(command);
  };

  const substituteParams = (command: string, values: Record<string, string>): string => {
    let result = command;
    Object.entries(values).forEach(([key, value]) => {
      result = result.replace(new RegExp(`\\{${key}\\}`, "g"), value);
    });
    return result;
  };

  const handleCommandClick = (template: CpeCommandTemplate) => {
    const placeholders = extractPlaceholders(template.command);
    const parameters = parseParameters(template.parameters);
    
    if (placeholders.length > 0 || parameters.length > 0) {
      setSelectedTemplate(template);
      const initialValues: Record<string, string> = {};
      
      placeholders.forEach(p => {
        const param = parameters.find(pr => pr.name === p);
        initialValues[p] = param?.defaultValue || "";
      });
      
      parameters.forEach(p => {
        if (!initialValues[p.name]) {
          initialValues[p.name] = p.defaultValue || "";
        }
      });
      
      setParamValues(initialValues);
      setParamDialogOpen(true);
    } else {
      executeCommand(template.command, template.id);
    }
  };

  const executeCommand = (command: string, templateId?: number) => {
    if (onExecuteCommand) {
      onExecuteCommand(command);
      logCommandMutation.mutate({ command, templateId });
      toast({ title: "Comando enviado ao terminal" });
    } else {
      navigator.clipboard.writeText(command);
      logCommandMutation.mutate({ command, templateId });
      toast({ 
        title: "Comando copiado!", 
        description: "Cole no terminal SSH ativo (Ctrl+Shift+V)" 
      });
    }
  };

  const handleParamSubmit = () => {
    if (!selectedTemplate) return;
    
    const command = substituteParams(selectedTemplate.command, paramValues);
    executeCommand(command, selectedTemplate.id);
    setParamDialogOpen(false);
    setSelectedTemplate(null);
    setParamValues({});
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copiado!" });
  };

  const toggleCategory = (category: string) => {
    const newExpanded = new Set(expandedCategories);
    if (newExpanded.has(category)) {
      newExpanded.delete(category);
    } else {
      newExpanded.add(category);
    }
    setExpandedCategories(newExpanded);
  };

  const getCategoryInfo = (category: string) => {
    return COMMAND_CATEGORIES.find(c => c.value === category) || COMMAND_CATEGORIES[COMMAND_CATEGORIES.length - 1];
  };

  const filteredTemplates = templates?.filter(t => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return t.name.toLowerCase().includes(term) ||
           t.command.toLowerCase().includes(term) ||
           (t.description && t.description.toLowerCase().includes(term));
  }) || [];

  const groupedTemplates = filteredTemplates.reduce((acc, template) => {
    const category = template.category;
    if (!acc[category]) acc[category] = [];
    acc[category].push(template);
    return acc;
  }, {} as Record<string, CpeCommandTemplate[]>);

  if (!cpe) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <BookOpen className="w-4 h-4" />
            Biblioteca de Comandos
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Nenhum CPE configurado para este link.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <BookOpen className="w-4 h-4" />
                Biblioteca de Comandos
              </CardTitle>
              <CardDescription className="text-xs">
                Clique para copiar o comando e cole no terminal SSH ativo
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="mb-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar comando..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-8 h-8 text-sm"
                data-testid="input-search-commands"
              />
            </div>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : Object.keys(groupedTemplates).length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              Nenhum comando disponível para este equipamento.
            </p>
          ) : (
            <ScrollArea className="h-[280px] pr-3">
              <div className="space-y-1">
                {COMMAND_CATEGORIES.map((category) => {
                  const categoryTemplates = groupedTemplates[category.value];
                  if (!categoryTemplates || categoryTemplates.length === 0) return null;
                  
                  const isExpanded = expandedCategories.has(category.value);
                  
                  return (
                    <Collapsible key={category.value} open={isExpanded} onOpenChange={() => toggleCategory(category.value)}>
                      <CollapsibleTrigger asChild>
                        <div 
                          className="flex items-center gap-2 p-2 rounded cursor-pointer hover-elevate text-sm"
                          data-testid={`collapsible-cmd-${category.value}`}
                        >
                          {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                          <Badge className={`${category.color} text-white text-xs px-1.5 py-0`}>{category.label}</Badge>
                          <span className="text-xs text-muted-foreground">
                            ({categoryTemplates.length})
                          </span>
                        </div>
                      </CollapsibleTrigger>
                      <CollapsibleContent className="pl-5 space-y-1">
                        {categoryTemplates.sort((a, b) => a.sortOrder - b.sortOrder).map((template) => (
                          <div
                            key={template.id}
                            className="flex items-center justify-between gap-2 p-2 rounded bg-muted/30 hover-elevate group"
                            data-testid={`cmd-template-${template.id}`}
                          >
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <Terminal className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                                <span className="text-sm font-medium truncate">{template.name}</span>
                                {hasPlaceholders(template.command) && (
                                  <Badge variant="outline" className="text-[10px] px-1 py-0">
                                    params
                                  </Badge>
                                )}
                              </div>
                              <code className="text-[10px] text-muted-foreground font-mono block truncate mt-0.5">
                                {template.command}
                              </code>
                            </div>
                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-6 w-6"
                                onClick={() => copyToClipboard(template.command)}
                                title="Copiar"
                                data-testid={`button-copy-cmd-${template.id}`}
                              >
                                <Copy className="h-3 w-3" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-6 w-6"
                                onClick={() => handleCommandClick(template)}
                                title="Executar"
                                data-testid={`button-exec-cmd-${template.id}`}
                              >
                                <Play className="h-3 w-3" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </CollapsibleContent>
                    </Collapsible>
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      <Dialog open={paramDialogOpen} onOpenChange={setParamDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Parâmetros do Comando</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="text-sm">
              <span className="text-muted-foreground">Comando: </span>
              <code className="bg-muted px-2 py-1 rounded font-mono text-xs">
                {selectedTemplate?.name}
              </code>
            </div>
            
            {selectedTemplate && extractPlaceholders(selectedTemplate.command).map((placeholder) => {
              const parameters = parseParameters(selectedTemplate.parameters);
              const param = parameters.find(p => p.name === placeholder);
              const isIpParam = param?.type === "ip" || placeholder.toLowerCase().includes("ip");
              
              return (
                <div key={placeholder} className="space-y-2">
                  <Label htmlFor={placeholder}>
                    {param?.label || placeholder}
                    {param?.required && <span className="text-destructive ml-1">*</span>}
                  </Label>
                  
                  {isIpParam && diagnosticTargets && diagnosticTargets.length > 0 ? (
                    <div className="space-y-2">
                      <Input
                        id={placeholder}
                        value={paramValues[placeholder] || ""}
                        onChange={(e) => setParamValues({ ...paramValues, [placeholder]: e.target.value })}
                        placeholder={`Digite o ${placeholder}`}
                        data-testid={`input-param-${placeholder}`}
                      />
                      <div className="flex flex-wrap gap-1">
                        {diagnosticTargets.map((target) => (
                          <Button
                            key={target.id}
                            size="sm"
                            variant="outline"
                            className="h-6 text-xs"
                            onClick={() => setParamValues({ ...paramValues, [placeholder]: target.ipAddress })}
                            data-testid={`button-target-${target.id}`}
                          >
                            {target.name}
                          </Button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <Input
                      id={placeholder}
                      value={paramValues[placeholder] || ""}
                      onChange={(e) => setParamValues({ ...paramValues, [placeholder]: e.target.value })}
                      placeholder={`Digite o ${placeholder}`}
                      data-testid={`input-param-${placeholder}`}
                    />
                  )}
                </div>
              );
            })}
            
            <div className="p-3 bg-muted rounded-md">
              <p className="text-xs text-muted-foreground mb-1">Comando final:</p>
              <code className="text-sm font-mono break-all">
                {selectedTemplate ? substituteParams(selectedTemplate.command, paramValues) : ""}
              </code>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setParamDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleParamSubmit} data-testid="button-execute-param-cmd">
              <Play className="h-4 w-4 mr-2" />
              Executar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
