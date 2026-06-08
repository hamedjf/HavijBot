export function sanitizeUsername(input: string): string {
  const sanitized = input
    .trim()
    .replace(/^@/, "")
    .replace(/[^A-Za-z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 28);

  return sanitized.length >= 3 ? sanitized : `user_${Date.now().toString().slice(-6)}`;
}

export function withRandomSuffix(username: string, suffix = randomFourDigits()): string {
  const base = username.slice(0, 24);
  return `${base}_${suffix}`;
}

export function randomFourDigits(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

