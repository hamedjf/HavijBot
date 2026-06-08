export function payableAmount(amountToman: number, discountAmountToman: number, walletAppliedToman: number): number {
  return Math.max(0, amountToman - discountAmountToman - walletAppliedToman);
}

export function clampDiscount(amountToman: number, discountAmountToman: number): number {
  return Math.max(0, Math.min(amountToman, discountAmountToman));
}

export function calculateDiscountAmount(amountToman: number, discount: { percentOff?: number | null; amountOffToman?: number | null }): number {
  const byPercent = discount.percentOff ? Math.floor((amountToman * discount.percentOff) / 100) : 0;
  const byAmount = discount.amountOffToman ?? 0;
  return clampDiscount(amountToman, Math.max(byPercent, byAmount));
}

export function walletOffsetForOrder(payableBeforeWallet: number, walletBalance: number): number {
  return Math.max(0, Math.min(payableBeforeWallet, walletBalance));
}

