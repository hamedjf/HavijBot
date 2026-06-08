import type { WalletTransaction } from "@prisma/client";

export function calculateWalletBalance(transactions: Pick<WalletTransaction, "amountToman" | "status">[]): number {
  return transactions
    .filter((transaction) => transaction.status === "POSTED")
    .reduce((total, transaction) => total + transaction.amountToman, 0);
}

export function assertEnoughBalance(balance: number, amount: number): void {
  if (balance < amount) {
    throw new Error("Mojoodi kafi nist.");
  }
}

