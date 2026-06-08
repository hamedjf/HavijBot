export function formatToman(value: number): string {
  return `${new Intl.NumberFormat("fa-IR").format(value)} toman`;
}

export function formatGb(value: number): string {
  return `${new Intl.NumberFormat("en-US").format(value)} GB`;
}

export function formatDays(value: number): string {
  return `${value} rooz`;
}

export function bytesToGb(bytes: number): number {
  return Math.max(0, Math.round((bytes / 1024 / 1024 / 1024) * 100) / 100);
}

