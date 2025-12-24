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

export function exportToCSV(data: ReportData): void {
  const lines: string[] = [];
  
  lines.push("RELATÓRIO DE MONITORAMENTO DE LINKS");
  lines.push(`Cliente: ${data.clientName}`);
  lines.push(`Gerado em: ${formatDate(data.generatedAt)}`);
  lines.push("");
  
  lines.push("INDICADORES SLA/ANS");
  lines.push("Indicador,Valor Atual,Meta,Status");
  data.slaIndicators.forEach((indicator) => {
    lines.push(`"${indicator.name}","${indicator.current}","${indicator.target}","${getStatusText(indicator.status)}"`);
  });
  lines.push("");
  
  lines.push("ESTATÍSTICAS GERAIS");
  lines.push("Métrica,Valor");
  lines.push(`"Total de Links","${data.stats.totalLinks}"`);
  lines.push(`"Links Operacionais","${data.stats.operationalLinks}"`);
  lines.push(`"Uptime Médio","${data.stats.averageUptime?.toFixed(2) || 0}%"`);
  lines.push(`"Latência Média","${data.stats.averageLatency?.toFixed(1) || 0} ms"`);
  lines.push(`"Banda Total","${formatBandwidth(data.stats.totalBandwidth || 0)}"`);
  lines.push("");
  
  lines.push("LINKS MONITORADOS");
  lines.push("Nome,Localização,Velocidade,Status,Uptime");
  data.links.forEach((link) => {
    lines.push(`"${link.name}","${link.location}","${link.bandwidth} Mbps","${link.status}","${link.uptime}%"`);
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
  doc.text("Relatório de Monitoramento de Links", pageWidth / 2, yPos, { align: "center" });
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
    String(indicator.current),
    indicator.target,
    getStatusText(indicator.status),
  ]);

  autoTable(doc, {
    startY: yPos,
    head: [["Indicador", "Valor Atual", "Meta", "Status"]],
    body: slaRows,
    theme: "striped",
    headStyles: { fillColor: [41, 128, 185] },
    styles: { fontSize: 10 },
  });

  yPos = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 15;

  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text("Estatísticas Gerais", 14, yPos);
  yPos += 5;

  const statsRows = [
    ["Total de Links", String(data.stats.totalLinks)],
    ["Links Operacionais", String(data.stats.operationalLinks)],
    ["Uptime Médio", `${data.stats.averageUptime?.toFixed(2) || 0}%`],
    ["Latência Média", `${data.stats.averageLatency?.toFixed(1) || 0} ms`],
    ["Banda Total", formatBandwidth(data.stats.totalBandwidth || 0)],
  ];

  autoTable(doc, {
    startY: yPos,
    head: [["Métrica", "Valor"]],
    body: statsRows,
    theme: "striped",
    headStyles: { fillColor: [41, 128, 185] },
    styles: { fontSize: 10 },
  });

  yPos = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 15;

  if (yPos > 240) {
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
    `${link.bandwidth} Mbps`,
    getStatusTextLink(link.status),
    `${link.uptime}%`,
  ]);

  autoTable(doc, {
    startY: yPos,
    head: [["Nome", "Localização", "Velocidade", "Status", "Uptime"]],
    body: linkRows,
    theme: "striped",
    headStyles: { fillColor: [41, 128, 185] },
    styles: { fontSize: 9 },
  });

  doc.setFontSize(8);
  doc.setFont("helvetica", "italic");
  doc.setTextColor(128, 128, 128);
  doc.text("Link Monitor - Sistema de Monitoramento de Links by Marvitel Telecomunicações", pageWidth / 2, 285, { align: "center" });

  doc.save(`relatorio-links-${formatDateFile(data.generatedAt)}.pdf`);
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

function formatBandwidth(mbps: number): string {
  if (mbps >= 1000) {
    return `${(mbps / 1000).toFixed(1)} Gbps`;
  }
  return `${mbps} Mbps`;
}

function getStatusText(status: string): string {
  switch (status) {
    case "compliant": return "Conforme";
    case "warning": return "Atenção";
    case "non_compliant": return "Não Conforme";
    default: return status;
  }
}

function getStatusTextLink(status: string): string {
  switch (status) {
    case "online": return "Online";
    case "degraded": return "Degradado";
    case "offline": return "Offline";
    default: return status;
  }
}

function downloadFile(content: string, filename: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
