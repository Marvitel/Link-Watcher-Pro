/**
 * Utilitários de timeline compartilhados entre os gráficos de métrica
 * (BandwidthChart, LatencyChart, PacketLossChart, UnifiedMetricsChart, MultiTrafficChart).
 *
 * Padrão de eixo X seguindo Cacti/MRTG/Grafana: ticks alinhados a marcas
 * humanas (00:00 do dia ou hora cheia), sem deixar o Recharts decidir
 * sozinho — o que costuma poluir o eixo com rótulos sub-horários repetidos.
 */

/**
 * Escolhe o formato de tick do eixo X de acordo com a duração da janela.
 * - até 36h → "HH:mm"   (1h, 6h, 24h)
 * - >36h    → "dd/MM"   (7d, 30d, personalizados longos)
 *
 * O detalhe de hora em janelas multi-dia só polui o eixo — o usuário pega
 * a hora exata pelo tooltip ao passar o mouse.
 */
export function pickTickFormat(spanMs: number): string {
  if (spanMs <= 36 * 3600_000) return "HH:mm";
  return "dd/MM";
}

/** Formato do tooltip — sempre mais detalhado que o tick. */
export function pickTooltipFormat(spanMs: number): string {
  if (spanMs <= 36 * 3600_000) return "dd/MM HH:mm";
  return "dd/MM/yy HH:mm";
}

/** Span em ms entre o primeiro e o último ponto da série. */
export function getSpanMs(items: Array<{ tsNum?: number; timestamp?: string }>): number {
  if (!items.length) return 0;
  const first = items[0];
  const last = items[items.length - 1];
  const a = first.tsNum ?? (first.timestamp ? new Date(first.timestamp).getTime() : 0);
  const b = last.tsNum ?? (last.timestamp ? new Date(last.timestamp).getTime() : 0);
  return Math.max(b - a, 0);
}

/**
 * Gera ticks "redondos" no tempo (00:00 do dia, ou hora cheia).
 * Esse array é passado direto ao XAxis via `ticks={...}` + `interval={0}` para
 * evitar que o Recharts gere muitos rótulos sub-horários quando a escala é tempo.
 *
 * - até 36h → ticks a cada 0,25 / 1 / 2 / 3 / 6 horas
 * - >36h    → ticks alinhados a 00:00 do dia (1, 2, 4, 7 ou 14 dias de passo)
 */
export function generateTimeTicks(spanMs: number, firstTs: number, lastTs: number): number[] {
  if (lastTs <= firstTs) return [firstTs];
  const ticks: number[] = [];
  const ONE_HOUR = 3600_000;
  const ONE_DAY = 24 * ONE_HOUR;

  if (spanMs <= 36 * ONE_HOUR) {
    const stepHours =
      spanMs <= 1 * ONE_HOUR ? 0.25
      : spanMs <= 6 * ONE_HOUR ? 1
      : spanMs <= 12 * ONE_HOUR ? 2
      : spanMs <= 24 * ONE_HOUR ? 3
      : 6;
    const stepMs = stepHours * ONE_HOUR;
    const d = new Date(firstTs);
    d.setMinutes(0, 0, 0);
    let t = d.getTime();
    while (t < firstTs) t += stepMs;
    while (t <= lastTs) {
      ticks.push(t);
      t += stepMs;
    }
  } else {
    const days = spanMs / ONE_DAY;
    const stepDays =
      days <= 8 ? 1
      : days <= 16 ? 2
      : days <= 32 ? 4
      : days <= 64 ? 7
      : 14;
    const d = new Date(firstTs);
    d.setHours(0, 0, 0, 0);
    let t = d.getTime();
    const stepMs = stepDays * ONE_DAY;
    while (t < firstTs) t += ONE_DAY;
    while (t <= lastTs) {
      ticks.push(t);
      t += stepMs;
    }
  }
  return ticks.length ? ticks : [firstTs, lastTs];
}

/** Retorna a mediana dos gaps entre timestamps consecutivos (em ms). */
export function getExpectedGapMs(items: Array<{ timestamp: string }>): number {
  if (items.length < 2) return 60_000;
  const gaps: number[] = [];
  for (let i = 1; i < Math.min(items.length, 40); i++) {
    const g = new Date(items[i].timestamp).getTime() - new Date(items[i - 1].timestamp).getTime();
    if (g > 0) gaps.push(g);
  }
  if (!gaps.length) return 60_000;
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}
