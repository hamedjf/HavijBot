import { prisma } from "../db.js";
import { calculateWalletBalance } from "../domain/wallet.js";

export async function getWalletBalance(userId: string): Promise<number> {
  const transactions = await prisma.walletTransaction.findMany({
    where: { userId, status: "POSTED" },
    select: { amountToman: true, status: true }
  });

  return calculateWalletBalance(transactions);
}

