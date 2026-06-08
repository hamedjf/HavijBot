export function makeReferralCode(telegramId: number | bigint): string {
  return `HV${telegramId.toString(36).toUpperCase()}`;
}

export function parseReferralPayload(payload?: string): string | null {
  if (!payload) return null;
  const normalized = payload.trim();
  if (!normalized.startsWith("ref_")) return null;
  const code = normalized.slice(4).trim().toUpperCase();
  return code.length > 0 ? code : null;
}

