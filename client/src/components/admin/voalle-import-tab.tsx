import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { 
  Upload, 
  FileSpreadsheet, 
  CheckCircle, 
  XCircle, 
  AlertTriangle, 
  Loader2, 
  Trash2,
  Eye,
  Download,
  RefreshCw,
  FileCheck,
  Info
} from "lucide-react";
import type { Client } from "@shared/schema";

interface CsvFile {
  name: string;
  type: 'contratos_ativos' | 'conexoes' | 'contract_service_tags' | 'authentication_contracts' | 'authentication_concentrators' | 'authentication_access_points' | 'person_users' | 'people';
  data: any[];
  headers: string[];
  rowCount: number;
}

interface ParsedLink {
  id: string;
  serviceTag: string;
  title: string;
  linkName: string | null; // Nome do link extraído do equipment_user (prefixo antes de ===)
  clientName: string;
  clientVoalleId: number | null;
  clientCpfCnpj: string | null;
  clientPortalUser: string | null;
  clientPortalPassword: string | null;
  bandwidth: number | null;
  address: string;
  city: string;
  lat: string | null;
  lng: string | null;
  slotOlt: number | null;
  portOlt: number | null;
  equipmentSerial: string | null;
  concentratorId: string | null;
  concentratorIp: string | null;
  concentratorName: string | null;
  accessPointId: string | null;
  oltIp: string | null;
  oltName: string | null;
  cpeUser: string | null;
  cpePassword: string | null;
  // Dados PPPoE/VLAN/WiFi do authentication_contracts
  pppoeUser: string | null;
  pppoePassword: string | null;
  vlan: number | null;
  vlanInterface: string | null;
  validLanIp: string | null;
  validLanIpClass: string | null;
  wifiName: string | null;
  wifiPassword: string | null;
  addressComplement: string | null;
  ipAuthenticationId: string | null;
  monitoredIp: string | null; // IP direto do conexoes.csv (sem precisar de discovery)
  linkType: 'gpon' | 'ptp';
  authType: 'pppoe' | 'corporate';
  selected: boolean;
  status: 'new' | 'exists' | 'error';
  errorMessage?: string;
}

interface ImportResult {
  success: number;
  failed: number;
  errors: Array<{ serviceTag: string; error: string }>;
  pppoeIpsFound?: number;
}

const CSV_TYPES: Record<string, { label: string; description: string; requiredFields: string[] }> = {
  contratos_ativos: {
    label: "Contratos Ativos",
    description: "Lista de contratos com situação Normal - BASE DE VALIDAÇÃO",
    requiredFields: ["nº contrato"]
  },
  conexoes: {
    label: "Conexões (Dados Completos)",
    description: "Contém IP, usuário PPPoE, concentrador, OLT - DADOS PRINCIPAIS",
    requiredFields: ["código da conexão", "código do contrato"]
  },
  contract_service_tags: {
    label: "Etiquetas de Contrato",
    description: "Contém service_tag, title, client_id, contract_id",
    requiredFields: ["id", "service_tag", "title", "client_id", "contract_id"]
  },
  authentication_contracts: {
    label: "Contratos de Autenticação",
    description: "Contém endereço, slot/porta OLT, credenciais CPE",
    requiredFields: ["id", "contract_id"]
  },
  authentication_concentrators: {
    label: "Concentradores",
    description: "Contém IP e credenciais dos concentradores",
    requiredFields: ["id", "server_ip"]
  },
  authentication_access_points: {
    label: "Pontos de Acesso (OLTs)",
    description: "Contém IP e credenciais das OLTs",
    requiredFields: ["id", "ip"]
  },
  person_users: {
    label: "Usuários do Portal",
    description: "Contém hash de senha do portal Voalle",
    requiredFields: ["person_id", "username", "password"]
  },
  people: {
    label: "Pessoas/Clientes",
    description: "Contém nome, CNPJ/CPF e endereço dos clientes",
    requiredFields: ["id", "name"]
  }
};

function detectCsvTypeByHeaders(headers: string[]): string | null {
  const normalizedHeaders = headers.map(h => h.toLowerCase().trim().replace(/"/g, ''));
  const headerSet = new Set(normalizedHeaders);
  
  // contratos_ativos: has "nº contrato" or "situação" - lista de contratos ativos
  if ((headerSet.has("nº contrato") || headerSet.has("n contrato") || headerSet.has("numero contrato")) && 
      (headerSet.has("situação") || headerSet.has("situacao") || headerSet.has("status"))) {
    return "contratos_ativos";
  }
  // conexoes: has "código da conexão" and "código do contrato" - dados completos de conexão
  if ((headerSet.has("código da conexão") || headerSet.has("codigo da conexao")) && 
      (headerSet.has("código do contrato") || headerSet.has("codigo do contrato"))) {
    return "conexoes";
  }
  // contract_service_tags: has service_tag and title
  if (headerSet.has("service_tag") && headerSet.has("title")) {
    return "contract_service_tags";
  }
  // authentication_contracts: has slot/port OLT info or equipment serial
  if (headerSet.has("slot_olt") || headerSet.has("port_olt") || headerSet.has("equipment_serial_number")) {
    return "authentication_contracts";
  }
  // authentication_concentrators: has server_ip (concentrador IP)
  if (headerSet.has("server_ip")) {
    return "authentication_concentrators";
  }
  // authentication_access_points: has ip field AND authentication_concentrator_id (OLT/access point)
  if (headerSet.has("ip") && headerSet.has("authentication_concentrator_id")) {
    return "authentication_access_points";
  }
  // person_users: has person_id AND username (user portal data)
  if (headerSet.has("person_id") && headerSet.has("username")) {
    return "person_users";
  }
  // Fallback: person_users just by person_id
  if (headerSet.has("person_id") && headerSet.has("password")) {
    return "person_users";
  }
  // Fallback: access_points by ip + manufacturer_id
  if (headerSet.has("ip") && headerSet.has("manufacturer_id")) {
    return "authentication_access_points";
  }
  // people: has id, name, tx_id (CPF/CNPJ) - customer data
  if (headerSet.has("name") && headerSet.has("tx_id") && !headerSet.has("service_tag")) {
    return "people";
  }
  // Fallback: people by id + name + type_tx_id
  if (headerSet.has("name") && headerSet.has("type_tx_id")) {
    return "people";
  }
  
  return null;
}

function detectCsvTypeByFilename(filename: string): string | null {
  const lowerName = filename.toLowerCase();
  
  // Novos formatos de exportação amigável do Voalle
  if (lowerName.includes("contratos_ativos") || lowerName.includes("contratosativos") || lowerName.includes("contratos-ativos")) {
    return "contratos_ativos";
  }
  if (lowerName.includes("conexoes") || lowerName.includes("conexões")) {
    return "conexoes";
  }
  if (lowerName.includes("contract_service_tag") || lowerName.includes("service_tag")) {
    return "contract_service_tags";
  }
  if (lowerName.includes("authentication_contract") && !lowerName.includes("concentrator") && !lowerName.includes("access_point")) {
    return "authentication_contracts";
  }
  if (lowerName.includes("concentrator") || lowerName.includes("concentrador")) {
    return "authentication_concentrators";
  }
  if (lowerName.includes("access_point") || lowerName.includes("olt") || lowerName.includes("ponto_acesso")) {
    return "authentication_access_points";
  }
  if (lowerName.includes("person_user") || lowerName.includes("usuario") || lowerName.includes("portal")) {
    return "person_users";
  }
  if (lowerName.includes("people") || lowerName.includes("pessoa") || lowerName.includes("cliente")) {
    return "people";
  }
  
  return null;
}

function detectCsvType(headers: string[], filename?: string): string | null {
  // Try by headers first
  const byHeaders = detectCsvTypeByHeaders(headers);
  if (byHeaders) return byHeaders;
  
  // Fallback to filename detection
  if (filename) {
    return detectCsvTypeByFilename(filename);
  }
  
  return null;
}

function parseCsv(text: string): { headers: string[]; data: any[]; errors: string[] } {
  const errors: string[] = [];
  
  const normalizedText = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;
  let rowStartLine = 1;
  let currentLine = 1;
  
  for (let i = 0; i < normalizedText.length; i++) {
    const char = normalizedText[i];
    const nextChar = normalizedText[i + 1];
    
    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          currentField += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else if (char === '\n') {
        currentField += ' ';
        currentLine++;
      } else {
        currentField += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        currentRow.push(currentField.trim());
        currentField = '';
      } else if (char === '\n') {
        currentRow.push(currentField.trim());
        rows.push(currentRow);
        currentRow = [];
        currentField = '';
        currentLine++;
        rowStartLine = currentLine;
      } else {
        currentField += char;
      }
    }
  }
  
  if (currentField || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    rows.push(currentRow);
  }
  
  if (inQuotes) {
    errors.push('Arquivo CSV mal formado: aspas não fechadas');
  }
  
  if (rows.length === 0) return { headers: [], data: [], errors: ['Arquivo CSV vazio'] };
  
  const headers = rows[0].map(h => h.replace(/^"|"$/g, '').trim());
  const data: any[] = [];
  
  for (let i = 1; i < rows.length; i++) {
    const values = rows[i];
    
    if (values.length === 1 && values[0] === '') continue;
    
    if (values.length !== headers.length) {
      errors.push(`Registro ${i}: esperado ${headers.length} colunas, encontrado ${values.length}`);
      continue;
    }
    
    const row: any = {};
    headers.forEach((header, idx) => {
      let value: any = values[idx]?.replace(/^"|"$/g, '') || '';
      const lowerValue = typeof value === 'string' ? value.toLowerCase().trim() : '';
      if (lowerValue === 'true') value = true;
      else if (lowerValue === 'false') value = false;
      else if (value === '' || lowerValue === 'null') value = null;
      else if (typeof value === 'string') {
        // Remove separadores de milhar (vírgulas) para números
        const numericValue = value.replace(/,/g, '').trim();
        if (numericValue !== '' && !isNaN(Number(numericValue)) && /^-?\d+\.?\d*$/.test(numericValue)) {
          value = Number(numericValue);
        }
      }
      row[header] = value;
    });
    data.push(row);
  }
  
  return { headers, data, errors };
}

function extractBandwidth(title: string): number | null {
  const match = title.match(/(\d+)\s*(MB|Mbps|M|GB|Gbps|G)/i);
  if (match) {
    let value = parseInt(match[1]);
    if (match[2].toLowerCase().startsWith('g')) {
      value *= 1000;
    }
    return value;
  }
  return null;
}

function detectLinkType(accessPointName: string | null): 'gpon' | 'ptp' {
  // Se o ponto de acesso contém "OLT" no nome, é GPON, senão é PTP
  if (accessPointName && accessPointName.toLowerCase().includes('olt')) {
    return 'gpon';
  }
  return 'ptp';
}

export function VoalleImportTab() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [csvFiles, setCsvFiles] = useState<CsvFile[]>([]);
  const [parsedLinks, setParsedLinks] = useState<ParsedLink[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string>("auto");
  const [lookupPppoeIps, setLookupPppoeIps] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [step, setStep] = useState<'upload' | 'preview' | 'result'>('upload');

  const { data: clients } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
  });

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files) return;

    const newCsvFiles: CsvFile[] = [...csvFiles];
    
    for (const file of Array.from(files)) {
      if (!file.name.endsWith('.csv')) {
        toast({
          title: "Arquivo inválido",
          description: `${file.name} não é um arquivo CSV`,
          variant: "destructive",
        });
        continue;
      }

      const text = await file.text();
      const { headers, data, errors } = parseCsv(text);
      
      if (errors.length > 0) {
        toast({
          title: "Erros no arquivo CSV",
          description: `${file.name}: ${errors.slice(0, 3).join('; ')}${errors.length > 3 ? ` e mais ${errors.length - 3} erros` : ''}`,
          variant: "destructive",
        });
      }
      
      const detectedType = detectCsvType(headers, file.name);
      
      if (!detectedType) {
        toast({
          title: "Tipo não reconhecido",
          description: `Não foi possível identificar o tipo do arquivo ${file.name}. Cabeçalhos encontrados: ${headers.slice(0, 5).join(', ')}${headers.length > 5 ? '...' : ''}`,
          variant: "destructive",
        });
        continue;
      }

      const typeInfo = CSV_TYPES[detectedType];
      const missingFields = typeInfo.requiredFields.filter(
        field => !headers.some(h => h.toLowerCase() === field.toLowerCase())
      );
      
      if (missingFields.length > 0) {
        toast({
          title: "Campos obrigatórios faltando",
          description: `${file.name}: campos faltando: ${missingFields.join(', ')}`,
          variant: "destructive",
        });
        continue;
      }

      const existingIndex = newCsvFiles.findIndex(f => f.type === detectedType);
      if (existingIndex >= 0) {
        newCsvFiles[existingIndex] = {
          name: file.name,
          type: detectedType as CsvFile['type'],
          data,
          headers,
          rowCount: data.length,
        };
      } else {
        newCsvFiles.push({
          name: file.name,
          type: detectedType as CsvFile['type'],
          data,
          headers,
          rowCount: data.length,
        });
      }
    }

    setCsvFiles(newCsvFiles);
    
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const removeCsvFile = (type: string) => {
    setCsvFiles(csvFiles.filter(f => f.type !== type));
  };

  const processAndCombine = async () => {
    setIsProcessing(true);
    
    try {
      // Novos CSVs amigáveis do Voalle
      const contratosAtivos = csvFiles.find(f => f.type === 'contratos_ativos')?.data || [];
      const conexoes = csvFiles.find(f => f.type === 'conexoes')?.data || [];
      
      // CSVs antigos (para dados complementares)
      const contractTags = csvFiles.find(f => f.type === 'contract_service_tags')?.data || [];
      const authContracts = csvFiles.find(f => f.type === 'authentication_contracts')?.data || [];
      const concentrators = csvFiles.find(f => f.type === 'authentication_concentrators')?.data || [];
      const accessPoints = csvFiles.find(f => f.type === 'authentication_access_points')?.data || [];
      const personUsers = csvFiles.find(f => f.type === 'person_users')?.data || [];
      const people = csvFiles.find(f => f.type === 'people')?.data || [];

      // Validar: precisa de contract_service_tags OU conexoes
      if (contractTags.length === 0 && conexoes.length === 0) {
        toast({
          title: "Arquivo obrigatório faltando",
          description: "É necessário o arquivo de Etiquetas de Contrato (contract_service_tags) OU Conexões (conexoes.csv)",
          variant: "destructive",
        });
        setIsProcessing(false);
        return;
      }

      // Criar set de contratos ativos para filtro (normaliza números de contrato)
      const contratosAtivosSet = new Set<string>();
      for (const contrato of contratosAtivos) {
        // Pega o número do contrato (pode vir como "Nº Contrato", "nº contrato", etc)
        const numContrato = contrato['Nº Contrato'] || contrato['nº contrato'] || contrato['numero contrato'] || contrato['N Contrato'];
        if (numContrato) {
          // Normaliza: remove espaços, M-, pontos
          const normalizado = String(numContrato).trim().replace(/^M-/i, '').replace(/\./g, '');
          contratosAtivosSet.add(normalizado);
          // Também adiciona versão original para matching flexível
          contratosAtivosSet.add(String(numContrato).trim());
        }
      }
      const hasContratosAtivosFilter = contratosAtivosSet.size > 0;

      // Criar mapa de conexões por código do contrato (para enriquecer dados)
      const conexoesMap = new Map<string, any>();
      for (const conexao of conexoes) {
        const codigoContrato = conexao['Código do Contrato'] || conexao['codigo do contrato'];
        if (codigoContrato) {
          conexoesMap.set(String(codigoContrato), conexao);
        }
      }

      const authContractMap = new Map(authContracts.map(ac => [ac.contract_id, ac]));
      const concentratorMap = new Map(concentrators.map(c => [c.id, c]));
      const accessPointMap = new Map(accessPoints.map(ap => [ap.id, ap]));
      const peopleMap = new Map(people.map(p => [p.id, p]));
      const personUsersMap = new Map(personUsers.map(pu => [pu.person_id, pu]));

      const links: ParsedLink[] = [];

      for (const tag of contractTags) {
        if (!tag.active) continue;
        
        const title = tag.title?.toLowerCase() || '';
        if (!title.includes('dedicado') && !title.includes('scm') && !title.includes('fibra') && !title.includes('banda')) {
          continue;
        }

        // Filtrar por contratos ativos se houver planilha de contratos_ativos
        if (hasContratosAtivosFilter) {
          const contractId = String(tag.contract_id || '').trim();
          const normalizedId = contractId.replace(/^M-/i, '').replace(/\./g, '');
          if (!contratosAtivosSet.has(contractId) && !contratosAtivosSet.has(normalizedId)) {
            continue; // Pula contratos não ativos
          }
        }

        const authContract = authContractMap.get(tag.contract_id);
        const concentrator = authContract?.authentication_concentrator_id 
          ? concentratorMap.get(authContract.authentication_concentrator_id) 
          : null;
        const accessPoint = authContract?.authentication_access_point_id
          ? accessPointMap.get(authContract.authentication_access_point_id)
          : null;

        // Buscar dados enriquecidos do conexoes.csv se disponível
        const conexao = conexoesMap.get(String(tag.contract_id));
        
        // Extrair IP direto do conexoes.csv (campo "IP")
        const monitoredIpFromConexao = conexao?.['IP'] || conexao?.['ip'] || null;

        const address = authContract 
          ? [authContract.street, authContract.street_number, authContract.neighborhood].filter(Boolean).join(', ')
          : (conexao ? [conexao['Rua'], conexao['Número'], conexao['Bairro']].filter(Boolean).join(', ') : '');

        // Get client name and document (CPF/CNPJ) from people.csv using client_id
        const person = tag.client_id ? peopleMap.get(tag.client_id) : null;
        const personUser = tag.client_id ? personUsersMap.get(tag.client_id) : null;
        const clientDoc = person?.tx_id || '';
        const clientName = person?.name 
          ? `${person.name}${clientDoc ? ` (${clientDoc})` : ''}`
          : (conexao?.['Nome do Cliente'] || tag.client_name || `ID: ${tag.client_id}`);

        // Extrai nome do link - primeiro tenta conexao, depois authContract
        const complementoConexao = conexao?.['Complemento'] || '';
        const equipmentUser = authContract?.equipment_user || conexao?.['Usuário do Equipamento'] || '';
        const linkName = complementoConexao?.trim() || 
          (equipmentUser.includes('===') ? equipmentUser.split('===')[0].trim() : (equipmentUser.trim() || null));

        // Dados PPPoE do conexoes.csv (nomes amigáveis)
        const pppoeUserFromConexao = conexao?.['Usuário'] || null;
        const pppoePasswordFromConexao = conexao?.['Senha do Usuário'] || null;

        const link: ParsedLink = {
          id: `voalle-${tag.id}`,
          serviceTag: tag.service_tag || '',
          title: tag.title || (conexao?.['Etiqueta'] || ''),
          linkName,
          clientName,
          clientVoalleId: tag.client_id || null,
          clientCpfCnpj: clientDoc || null,
          // Usar CPF/CNPJ como usuário e senha do portal se não tiver person_users
          clientPortalUser: personUser?.username || clientDoc || null,
          clientPortalPassword: clientDoc || null,
          bandwidth: extractBandwidth(tag.title || conexao?.['Serviço'] || ''),
          address,
          city: authContract?.city || conexao?.['Cidade'] || '',
          lat: authContract?.lat?.toString() || conexao?.['Latitude'] || null,
          lng: authContract?.lng?.toString() || conexao?.['Longitude'] || null,
          slotOlt: authContract?.slot_olt || null,
          portOlt: authContract?.port_olt || null,
          equipmentSerial: authContract?.equipment_serial_number || null,
          concentratorId: authContract?.authentication_concentrator_id?.toString() || conexao?.['Código Concentrador'] || null,
          concentratorIp: concentrator?.server_ip || null,
          concentratorName: concentrator?.title || conexao?.['Concentrador'] || null,
          accessPointId: authContract?.authentication_access_point_id?.toString() || conexao?.['Código do Ponto de Acesso'] || null,
          oltIp: accessPoint?.ip || null,
          oltName: accessPoint?.title || conexao?.['Ponto de Acesso'] || null,
          cpeUser: authContract?.equipment_user || conexao?.['Usuário do Equipamento'] || null,
          cpePassword: authContract?.equipment_password || conexao?.['Senha do Equipamento'] || null,
          // Dados PPPoE/VLAN/WiFi - prioriza conexoes.csv
          pppoeUser: authContract?.user || pppoeUserFromConexao || null,
          pppoePassword: authContract?.password || pppoePasswordFromConexao || null,
          vlan: authContract?.vlan || null,
          vlanInterface: authContract?.vlan_interface || null,
          validLanIp: authContract?.valid_lan_ip || conexao?.['IP Válido LAN'] || null,
          validLanIpClass: authContract?.valid_lan_ip_class || conexao?.['Classe IP LAN'] || null,
          wifiName: authContract?.wifi_name || null,
          wifiPassword: authContract?.wifi_password || null,
          addressComplement: authContract?.complement || conexao?.['Complemento'] || null,
          ipAuthenticationId: authContract?.ip_authentication_id?.toString() || conexao?.['Código do IP'] || null,
          // IP monitorado direto do conexoes.csv (sem precisar de discovery)
          monitoredIp: monitoredIpFromConexao,
          // Detecta tipo de link: se ponto de acesso contém "OLT" é GPON, senão é PTP
          linkType: detectLinkType(accessPoint?.title || conexao?.['Ponto de Acesso'] || null),
          // Detecta tipo de autenticação: se tem usuário PPPoE é PPPoE, senão é Corporate
          authType: (authContract?.user || pppoeUserFromConexao) ? 'pppoe' : 'corporate',
          selected: true,
          status: 'new',
        };

        links.push(link);
      }

      setParsedLinks(links);
      setStep('preview');
      
      toast({
        title: "Processamento concluído",
        description: `${links.length} links encontrados para importação`,
      });

    } catch (error) {
      toast({
        title: "Erro no processamento",
        description: error instanceof Error ? error.message : "Erro desconhecido",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const importMutation = useMutation({
    mutationFn: async (links: ParsedLink[]) => {
      const response = await apiRequest("POST", "/api/admin/voalle-import", {
        links: links.filter(l => l.selected),
        targetClientId: selectedClientId === "auto" ? null : parseInt(selectedClientId),
        lookupPppoeIps,
      });
      return response.json();
    },
    onSuccess: (data: ImportResult) => {
      setImportResult(data);
      setStep('result');
      queryClient.invalidateQueries({ queryKey: ["/api/links"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      toast({
        title: "Importação concluída",
        description: `${data.success} links importados com sucesso`,
      });
    },
    onError: (error) => {
      toast({
        title: "Erro na importação",
        description: error instanceof Error ? error.message : "Erro desconhecido",
        variant: "destructive",
      });
    },
  });

  const toggleLinkSelection = (id: string) => {
    setParsedLinks(links => 
      links.map(l => l.id === id ? { ...l, selected: !l.selected } : l)
    );
  };

  const selectAll = (selected: boolean) => {
    setParsedLinks(links => links.map(l => ({ ...l, selected })));
  };

  const resetImport = () => {
    setCsvFiles([]);
    setParsedLinks([]);
    setImportResult(null);
    setStep('upload');
  };

  const selectedCount = parsedLinks.filter(l => l.selected).length;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Importar Links do Voalle
          </CardTitle>
          <CardDescription>
            Faça upload dos arquivos CSV exportados do Voalle para importar links em lote
          </CardDescription>
        </CardHeader>
        <CardContent>
          {step === 'upload' && (
            <div className="space-y-6">
              <Alert>
                <Info className="h-4 w-4" />
                <AlertTitle>Arquivos necessários</AlertTitle>
                <AlertDescription>
                  <p className="font-medium text-green-600 dark:text-green-400 mt-2">Exportação Amigável (Recomendado):</p>
                  <ul className="list-disc list-inside mt-1 space-y-1">
                    <li><strong>contratos_ativos.csv</strong> - Filtra apenas contratos ativos (situação Normal)</li>
                    <li><strong>conexoes.csv</strong> - Dados completos com IP do cliente (sem criptografia)</li>
                  </ul>
                  <p className="font-medium mt-3">Exportação Técnica:</p>
                  <ul className="list-disc list-inside mt-1 space-y-1">
                    <li><strong>contract_service_tags.csv</strong> - Obrigatório (etiquetas de contrato)</li>
                    <li><strong>authentication_contracts.csv</strong> - Recomendado (endereço, slot/porta OLT)</li>
                    <li><strong>authentication_concentrators.csv</strong> - Opcional (IPs dos concentradores)</li>
                    <li><strong>authentication_access_points.csv</strong> - Opcional (IPs das OLTs)</li>
                    <li><strong>person_users.csv</strong> - Opcional (senhas do portal)</li>
                  </ul>
                </AlertDescription>
              </Alert>

              <div className="border-2 border-dashed rounded-lg p-8 text-center">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  multiple
                  onChange={handleFileUpload}
                  className="hidden"
                  data-testid="input-csv-upload"
                />
                <FileSpreadsheet className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <Button
                  onClick={() => fileInputRef.current?.click()}
                  variant="outline"
                  className="mb-2"
                  data-testid="button-select-csv"
                >
                  <Upload className="h-4 w-4 mr-2" />
                  Selecionar Arquivos CSV
                </Button>
                <p className="text-sm text-muted-foreground">
                  Arraste os arquivos ou clique para selecionar
                </p>
              </div>

              {csvFiles.length > 0 && (
                <div className="space-y-4">
                  <h4 className="font-medium">Arquivos carregados:</h4>
                  <div className="grid gap-3">
                    {Object.entries(CSV_TYPES).map(([type, info]) => {
                      const file = csvFiles.find(f => f.type === type);
                      return (
                        <div 
                          key={type}
                          className={`flex items-center justify-between p-3 rounded-lg border ${
                            file ? 'bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800' : 'bg-muted/50'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            {file ? (
                              <CheckCircle className="h-5 w-5 text-green-600" />
                            ) : (
                              <XCircle className="h-5 w-5 text-muted-foreground" />
                            )}
                            <div>
                              <p className="font-medium">{info.label}</p>
                              <p className="text-sm text-muted-foreground">
                                {file ? `${file.name} - ${file.rowCount} registros` : info.description}
                              </p>
                            </div>
                          </div>
                          {file && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => removeCsvFile(type)}
                              data-testid={`button-remove-${type}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      onClick={resetImport}
                      data-testid="button-reset-import"
                    >
                      Limpar
                    </Button>
                    <Button
                      onClick={processAndCombine}
                      disabled={isProcessing || !csvFiles.some(f => f.type === 'contract_service_tags')}
                      data-testid="button-process-csv"
                    >
                      {isProcessing ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Eye className="h-4 w-4 mr-2" />
                      )}
                      Processar e Visualizar
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 'preview' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <Button
                    variant="outline"
                    onClick={() => setStep('upload')}
                    data-testid="button-back-upload"
                  >
                    Voltar
                  </Button>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={selectedCount === parsedLinks.length}
                      onCheckedChange={(checked) => selectAll(!!checked)}
                      data-testid="checkbox-select-all"
                    />
                    <span className="text-sm">
                      {selectedCount} de {parsedLinks.length} selecionados
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-4 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">Cliente destino:</span>
                    <Select value={selectedClientId} onValueChange={setSelectedClientId}>
                      <SelectTrigger className="w-[200px]" data-testid="select-target-client">
                        <SelectValue placeholder="Selecione..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">Criar automaticamente</SelectItem>
                        {clients?.map(client => (
                          <SelectItem key={client.id} value={client.id.toString()}>
                            {client.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex items-center gap-2">
                    <Checkbox 
                      id="lookupPppoeIps" 
                      checked={lookupPppoeIps}
                      onCheckedChange={(checked) => setLookupPppoeIps(checked === true)}
                      data-testid="checkbox-lookup-pppoe-ips"
                    />
                    <label 
                      htmlFor="lookupPppoeIps" 
                      className="text-sm cursor-pointer"
                      title="Busca o IP de monitoramento no concentrador consultando a sessão PPPoE ativa pelo username"
                    >
                      Buscar IP via PPPoE
                    </label>
                  </div>

                  <Button
                    onClick={() => importMutation.mutate(parsedLinks)}
                    disabled={importMutation.isPending || selectedCount === 0}
                    data-testid="button-import"
                  >
                    {importMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4 mr-2" />
                    )}
                    Importar {selectedCount} Links
                  </Button>
                </div>
              </div>

              <ScrollArea className="h-[600px] border rounded-lg">
                <div className="min-w-[1400px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[40px] sticky left-0 bg-background z-10"></TableHead>
                        <TableHead className="sticky left-10 bg-background z-10">Etiqueta</TableHead>
                        <TableHead>Nome Serviço</TableHead>
                        <TableHead>Nome Link</TableHead>
                        <TableHead>Cliente</TableHead>
                        <TableHead>ID Cliente</TableHead>
                        <TableHead>CPF/CNPJ</TableHead>
                        <TableHead>Tipo</TableHead>
                        <TableHead>Auth</TableHead>
                        <TableHead>Banda</TableHead>
                        <TableHead>Endereço</TableHead>
                        <TableHead>Cidade</TableHead>
                        <TableHead>Lat/Lng</TableHead>
                        <TableHead>Slot/Porta</TableHead>
                        <TableHead>Serial</TableHead>
                        <TableHead>ID Conc.</TableHead>
                        <TableHead>Concentrador</TableHead>
                        <TableHead>IP Conc.</TableHead>
                        <TableHead>ID OLT</TableHead>
                        <TableHead>Ponto de Acesso</TableHead>
                        <TableHead>PPPoE User</TableHead>
                        <TableHead>PPPoE Pass</TableHead>
                        <TableHead>VLAN</TableHead>
                        <TableHead>Interface VLAN</TableHead>
                        <TableHead>Bloco IP</TableHead>
                        <TableHead>WiFi SSID</TableHead>
                        <TableHead>WiFi Pass</TableHead>
                        <TableHead>CPE User</TableHead>
                        <TableHead>CPE Pass</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {parsedLinks.map((link) => (
                        <TableRow key={link.id} className={!link.selected ? 'opacity-50' : ''}>
                          <TableCell className="sticky left-0 bg-background z-10">
                            <Checkbox
                              checked={link.selected}
                              onCheckedChange={() => toggleLinkSelection(link.id)}
                              data-testid={`checkbox-link-${link.id}`}
                            />
                          </TableCell>
                          <TableCell className="font-mono text-sm sticky left-10 bg-background z-10">{link.serviceTag}</TableCell>
                          <TableCell className="max-w-[150px] truncate" title={link.title}>
                            {link.title}
                          </TableCell>
                          <TableCell className="max-w-[150px] truncate" title={link.linkName || ''}>
                            {link.linkName || '-'}
                          </TableCell>
                          <TableCell className="max-w-[150px] truncate" title={link.clientName}>
                            {link.clientName}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {link.clientVoalleId ? String(link.clientVoalleId) : '-'}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {link.clientCpfCnpj || '-'}
                          </TableCell>
                          <TableCell>
                            <Badge variant={link.linkType === 'ptp' ? 'default' : 'secondary'}>
                              {link.linkType === 'ptp' ? 'PTP' : 'GPON'}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant={link.authType === 'corporate' ? 'outline' : 'secondary'}>
                              {link.authType === 'corporate' ? 'Corp' : 'PPPoE'}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {link.bandwidth ? `${link.bandwidth} Mbps` : '-'}
                          </TableCell>
                          <TableCell className="max-w-[150px] truncate" title={link.address}>
                            {link.address || '-'}
                          </TableCell>
                          <TableCell>{link.city || '-'}</TableCell>
                          <TableCell className="text-xs font-mono">
                            {link.lat && link.lng ? `${link.lat}, ${link.lng}` : '-'}
                          </TableCell>
                          <TableCell>
                            {link.slotOlt && link.portOlt 
                              ? `${link.slotOlt}/${link.portOlt}` 
                              : '-'}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {link.equipmentSerial || '-'}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {link.concentratorId || '-'}
                          </TableCell>
                          <TableCell className="font-mono text-xs" title={link.concentratorName || ''}>
                            {link.concentratorName || '-'}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {link.concentratorIp || '-'}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {link.accessPointId || '-'}
                          </TableCell>
                          <TableCell className="font-mono text-xs" title={link.oltName || ''}>
                            {link.oltName || '-'}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {link.pppoeUser || '-'}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {link.pppoePassword || '-'}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {link.vlan || '-'}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {link.vlanInterface || '-'}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {link.validLanIp && link.validLanIpClass 
                              ? `${link.validLanIp}/${link.validLanIpClass}` 
                              : (link.validLanIp || '-')}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {link.wifiName || '-'}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {link.wifiPassword || '-'}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {link.cpeUser || '-'}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {link.cpePassword || '-'}
                          </TableCell>
                          <TableCell>
                            {link.status === 'new' && (
                              <Badge variant="outline" className="bg-blue-50 dark:bg-blue-950">
                                Novo
                              </Badge>
                            )}
                            {link.status === 'exists' && (
                              <Badge variant="outline" className="bg-yellow-50 dark:bg-yellow-950">
                                Existe
                              </Badge>
                            )}
                            {link.status === 'error' && (
                              <Badge variant="destructive">
                                Erro
                              </Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <ScrollBar orientation="horizontal" />
              </ScrollArea>
            </div>
          )}

          {step === 'result' && importResult && (
            <div className="space-y-6">
              <div className="grid gap-4 md:grid-cols-3">
                <Card className="bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800">
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-4">
                      <CheckCircle className="h-10 w-10 text-green-600" />
                      <div>
                        <p className="text-2xl font-bold">{importResult.success}</p>
                        <p className="text-sm text-muted-foreground">Links importados</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card className={`${importResult.failed > 0 ? 'bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800' : ''}`}>
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-4">
                      {importResult.failed > 0 ? (
                        <XCircle className="h-10 w-10 text-red-600" />
                      ) : (
                        <CheckCircle className="h-10 w-10 text-green-600" />
                      )}
                      <div>
                        <p className="text-2xl font-bold">{importResult.failed}</p>
                        <p className="text-sm text-muted-foreground">Falhas</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {importResult.pppoeIpsFound !== undefined && (
                  <Card className={`${importResult.pppoeIpsFound > 0 ? 'bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800' : ''}`}>
                    <CardContent className="pt-6">
                      <div className="flex items-center gap-4">
                        <CheckCircle className={`h-10 w-10 ${importResult.pppoeIpsFound > 0 ? 'text-blue-600' : 'text-muted-foreground'}`} />
                        <div>
                          <p className="text-2xl font-bold">{importResult.pppoeIpsFound}</p>
                          <p className="text-sm text-muted-foreground">IPs via PPPoE</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>

              {importResult.errors.length > 0 && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>Erros encontrados</AlertTitle>
                  <AlertDescription>
                    <ScrollArea className="h-[200px] mt-2">
                      <ul className="space-y-1">
                        {importResult.errors.map((err, idx) => (
                          <li key={idx} className="text-sm">
                            <strong>{err.serviceTag}:</strong> {err.error}
                          </li>
                        ))}
                      </ul>
                    </ScrollArea>
                  </AlertDescription>
                </Alert>
              )}

              <div className="flex justify-center">
                <Button onClick={resetImport} data-testid="button-new-import">
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Nova Importação
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
