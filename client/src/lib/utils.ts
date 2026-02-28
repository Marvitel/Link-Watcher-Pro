import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

function ensureUtc(dateStr: string | Date): Date {
  if (dateStr instanceof Date) return dateStr;
  const str = String(dateStr).trim();
  if (str.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(str)) {
    return new Date(str);
  }
  return new Date(str + "Z");
}

export function formatDateBR(dateStr: string | Date | null | undefined, includeSeconds = true): string {
  if (!dateStr) return "-";
  try {
    const date = ensureUtc(dateStr);
    if (isNaN(date.getTime())) return String(dateStr);
    const options: Intl.DateTimeFormatOptions = {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "America/Sao_Paulo",
    };
    if (includeSeconds) options.second = "2-digit";
    return date.toLocaleString("pt-BR", options);
  } catch {
    return String(dateStr);
  }
}
