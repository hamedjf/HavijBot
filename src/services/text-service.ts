import { prisma } from "../db.js";
import { BOT_TEXT_DEFINITIONS } from "../config/bot-texts.js";

export const TEXT_DEFINITIONS = BOT_TEXT_DEFINITIONS;

const fallbackMap = new Map(TEXT_DEFINITIONS.map((definition) => [definition.key, definition.fallback]));

export type TextKey = (typeof TEXT_DEFINITIONS)[number]["key"];

export async function getText(key: TextKey, variables: Record<string, string | number> = {}): Promise<string> {
  const row = await prisma.botText.findUnique({ where: { key } });
  return renderTemplate(row?.value ?? fallbackMap.get(key) ?? key, variables);
}

export async function getTextSyncFallback(key: TextKey): Promise<string> {
  return getText(key);
}

export async function setText(key: string, value: string) {
  return prisma.botText.upsert({
    where: { key },
    update: { value },
    create: { key, value }
  });
}

export async function resetText(key: string) {
  return prisma.botText.delete({ where: { key } }).catch(() => null);
}

export function getTextDefinition(key: string) {
  return TEXT_DEFINITIONS.find((definition) => definition.key === key);
}

function renderTemplate(template: string, variables: Record<string, string | number>): string {
  return Object.entries(variables).reduce((result, [key, value]) => result.replaceAll(`{{${key}}}`, String(value)), template);
}
