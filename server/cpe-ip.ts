import type { LinkCpe, Cpe, Link } from "@shared/schema";

/**
 * Resolve o IP efetivo para acessar uma CPE associada a um link.
 *
 * Regras (em ordem de prioridade):
 *  1. Se a associação tem `useDynamicIp=true`, usa o IP atual do link
 *     (`links.monitoredIp`, atualizado pela coleta de PPPoE/RADIUS).
 *  2. Senão, usa `link_cpes.ipOverride` se presente.
 *  3. Senão, usa o IP fixo do `cpes.ipAddress`.
 *  4. Retorna `null` se nada for resolvido.
 */
export function resolveCpeIp(
  assoc: Pick<LinkCpe, "useDynamicIp" | "ipOverride"> | null | undefined,
  cpe: Pick<Cpe, "ipAddress"> | null | undefined,
  link: Pick<Link, "monitoredIp"> | null | undefined,
): string | null {
  if (assoc?.useDynamicIp) {
    const dyn = link?.monitoredIp;
    return dyn ? dyn.trim() || null : null;
  }
  const override = assoc?.ipOverride;
  if (override && override.trim()) return override.trim();
  const fixed = cpe?.ipAddress;
  if (fixed && fixed.trim()) return fixed.trim();
  return null;
}
