import { twMerge } from "tailwind-merge";

export function cn(...inputs: Array<string | false | null | undefined>) {
  return twMerge(inputs.filter(Boolean).join(" "));
}

export function uid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `id_${Math.random().toString(36).slice(2)}_${Date.now()}`;
}

export function formatClock(ts: number) {
  return new Date(ts).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function isApprovePhrase(text: string) {
  return /^(approve|yes|go)\b/i.test(text.trim());
}

export function isRejectPhrase(text: string) {
  return /^(reject|no|deny|hold|stop|cancel)\b/i.test(text.trim());
}
