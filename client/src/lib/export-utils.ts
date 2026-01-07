import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { SLAIndicator, DashboardStats, Link } from "@shared/schema";

interface ReportData {
  clientName: string;
  slaIndicators: SLAIndicator[];
  stats: DashboardStats;
  links: Link[];
  generatedAt: Date;
}

function escapeCSV(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (str.includes(";") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function formatNumberPtBR(value: number | null | undefined, decimals: number = 2): string {
  if (value === null || value === undefined || isNaN(value)) return "0";
  return value.toLocaleString("pt-BR", { 
    minimumFractionDigits: decimals, 
    maximumFractionDigits: decimals 
  });
}

export function formatBandwidth(mbps: number | null | undefined): string {
  if (!mbps || isNaN(mbps)) return "0 Mbps";
  if (mbps >= 1000) {
    return `${formatNumberPtBR(mbps / 1000, 1)} Gbps`;
  }
  return `${mbps} Mbps`;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDateFile(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function getStatusText(status: string): string {
  switch (status) {
    case "compliant": return "Conforme";
    case "warning": return "Atencao";
    case "non_compliant": return "Nao Conforme";
    default: return status;
  }
}

function getStatusTextLink(status: string): string {
  switch (status) {
    case "online": return "Online";
    case "operational": return "Operacional";
    case "degraded": return "Degradado";
    case "offline": return "Offline";
    default: return status;
  }
}

function downloadFile(content: string, filename: string, type: string): void {
  const BOM = "\uFEFF";
  const blob = new Blob([BOM + content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function exportToCSV(data: ReportData): void {
  const lines: string[] = [];
  const sep = ";";
  
  lines.push("RELATORIO DE MONITORAMENTO DE LINKS");
  lines.push(`Cliente${sep}${escapeCSV(data.clientName)}`);
  lines.push(`Gerado em${sep}${formatDate(data.generatedAt)}`);
  lines.push("");
  
  lines.push("INDICADORES SLA/ANS");
  lines.push(`Indicador${sep}Descricao${sep}Formula${sep}Periodicidade${sep}Meta${sep}Valor Atual${sep}Status`);
  data.slaIndicators.forEach((indicator) => {
    lines.push([
      escapeCSV(indicator.name),
      escapeCSV(indicator.description),
      escapeCSV(indicator.formula),
      escapeCSV(indicator.periodicity),
      escapeCSV(indicator.target),
      escapeCSV(formatNumberPtBR(indicator.current)),
      escapeCSV(getStatusText(indicator.status)),
    ].join(sep));
  });
  lines.push("");
  
  lines.push("ESTATISTICAS GERAIS");
  lines.push(`Metrica${sep}Valor`);
  lines.push(`Total de Links${sep}${data.stats.totalLinks}`);
  lines.push(`Links Operacionais${sep}${data.stats.operationalLinks}`);
  lines.push(`Uptime Medio${sep}${formatNumberPtBR(data.stats.averageUptime)}%`);
  lines.push(`Latencia Media${sep}${formatNumberPtBR(data.stats.averageLatency, 1)} ms`);
  lines.push(`Banda Total${sep}${formatBandwidth(data.stats.totalBandwidth)}`);
  lines.push(`Alertas Ativos${sep}${data.stats.activeAlerts}`);
  lines.push(`Incidentes Abertos${sep}${data.stats.openIncidents}`);
  lines.push(`Eventos DDoS Hoje${sep}${data.stats.ddosEventsToday}`);
  lines.push("");
  
  lines.push("LINKS MONITORADOS");
  lines.push(`Nome${sep}Localizacao${sep}Endereco${sep}Velocidade${sep}Status${sep}Uptime (%)${sep}Latencia (ms)${sep}Perda de Pacotes (%)`);
  data.links.forEach((link) => {
    lines.push([
      escapeCSV(link.name),
      escapeCSV(link.location),
      escapeCSV(link.address),
      formatBandwidth(link.bandwidth),
      getStatusTextLink(link.status),
      formatNumberPtBR(link.uptime ?? 0),
      formatNumberPtBR(link.latency ?? 0, 1),
      formatNumberPtBR(link.packetLoss ?? 0, 2),
    ].join(sep));
  });
  
  const csvContent = lines.join("\n");
  downloadFile(csvContent, `relatorio-links-${formatDateFile(data.generatedAt)}.csv`, "text/csv;charset=utf-8;");
}

export function exportToPDF(data: ReportData): void {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  let yPos = 20;

  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.text("Relatorio de Monitoramento de Links", pageWidth / 2, yPos, { align: "center" });
  yPos += 10;
  
  doc.setFontSize(12);
  doc.setFont("helvetica", "normal");
  doc.text(`Cliente: ${data.clientName}`, pageWidth / 2, yPos, { align: "center" });
  yPos += 6;
  doc.text(`Gerado em: ${formatDate(data.generatedAt)}`, pageWidth / 2, yPos, { align: "center" });
  yPos += 15;

  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text("Indicadores SLA/ANS", 14, yPos);
  yPos += 5;

  const slaRows = data.slaIndicators.map((indicator) => [
    indicator.name,
    indicator.description.length > 30 ? indicator.description.substring(0, 30) + "..." : indicator.description,
    indicator.target,
    formatNumberPtBR(indicator.current),
    getStatusText(indicator.status),
  ]);

  autoTable(doc, {
    startY: yPos,
    head: [["Indicador", "Descricao", "Meta", "Atual", "Status"]],
    body: slaRows,
    theme: "striped",
    headStyles: { fillColor: [41, 128, 185] },
    styles: { fontSize: 9, cellPadding: 2 },
    columnStyles: {
      0: { cellWidth: 40 },
      1: { cellWidth: 50 },
      2: { cellWidth: 25 },
      3: { cellWidth: 25 },
      4: { cellWidth: 30 },
    }
  });

  yPos = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 15;

  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text("Estatisticas Gerais", 14, yPos);
  yPos += 5;

  const statsRows = [
    ["Total de Links", String(data.stats.totalLinks)],
    ["Links Operacionais", String(data.stats.operationalLinks)],
    ["Uptime Medio", `${formatNumberPtBR(data.stats.averageUptime)}%`],
    ["Latencia Media", `${formatNumberPtBR(data.stats.averageLatency, 1)} ms`],
    ["Banda Total", formatBandwidth(data.stats.totalBandwidth)],
    ["Alertas Ativos", String(data.stats.activeAlerts)],
    ["Incidentes Abertos", String(data.stats.openIncidents)],
  ];

  autoTable(doc, {
    startY: yPos,
    head: [["Metrica", "Valor"]],
    body: statsRows,
    theme: "striped",
    headStyles: { fillColor: [41, 128, 185] },
    styles: { fontSize: 10 },
  });

  yPos = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 15;

  if (yPos > 200) {
    doc.addPage();
    yPos = 20;
  }

  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text("Links Monitorados", 14, yPos);
  yPos += 5;

  const linkRows = data.links.map((link) => [
    link.name,
    link.location,
    formatBandwidth(link.bandwidth),
    getStatusTextLink(link.status),
    `${formatNumberPtBR(link.uptime ?? 0)}%`,
    `${formatNumberPtBR(link.latency ?? 0, 1)} ms`,
    `${formatNumberPtBR(link.packetLoss ?? 0, 2)}%`,
  ]);

  autoTable(doc, {
    startY: yPos,
    head: [["Nome", "Localizacao", "Velocidade", "Status", "Uptime", "Latencia", "Perda Pkt"]],
    body: linkRows,
    theme: "striped",
    headStyles: { fillColor: [41, 128, 185] },
    styles: { fontSize: 8, cellPadding: 2 },
  });

  doc.setFontSize(8);
  doc.setFont("helvetica", "italic");
  doc.setTextColor(128, 128, 128);
  doc.text("Link Monitor - Sistema de Monitoramento de Links by Marvitel Telecomunicacoes", pageWidth / 2, 285, { align: "center" });

  doc.save(`relatorio-links-${formatDateFile(data.generatedAt)}.pdf`);
}
