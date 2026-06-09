import { config } from "../config.js";
import { prisma } from "../db.js";

const CARD_TEXT_KEY = "setting.cardToCardText";

export async function getCardToCardText(): Promise<string> {
  const row = await prisma.botText.findUnique({ where: { key: CARD_TEXT_KEY } });
  return row?.value ?? config.CARD_TO_CARD_TEXT;
}

export async function setCardToCardText(value: string) {
  return prisma.botText.upsert({
    where: { key: CARD_TEXT_KEY },
    update: { value },
    create: { key: CARD_TEXT_KEY, value }
  });
}
