import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDateBR(dateStr: string | Date | null | undefined, includeSeconds = true): string {
  if (!dateStr) return "-";
  try {
    const options: Intl.DateTimeFormatOptions = {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "America/Sao_Paulo",
    };
    if (includeSeconds) options.second = "2-digit";
    return new Date(dateStr).toLocaleString("pt-BR", options);
  } catch {
    return String(dateStr);
  }
}
