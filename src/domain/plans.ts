export function gbToBytes(volumeGb: number): number {
  return volumeGb * 1024 * 1024 * 1024;
}

export function expirationFromNow(durationDays: number, now = new Date()): Date {
  const expiresAt = new Date(now);
  expiresAt.setDate(expiresAt.getDate() + durationDays);
  return expiresAt;
}

