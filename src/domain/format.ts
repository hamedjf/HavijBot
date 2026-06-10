export function formatToman(value: number): string {
  return `${new Intl.NumberFormat("en-US").format(value)} تومان`;
}

export function formatGb(value: number): string {
  return `${new Intl.NumberFormat("en-US").format(value)} گیگ`;
}

export function formatDays(value: number): string {
  return `${new Intl.NumberFormat("en-US").format(value)} روز`;
}

export function bytesToGb(bytes: number): number {
  return Math.max(0, Math.round((bytes / 1024 / 1024 / 1024) * 100) / 100);
}
