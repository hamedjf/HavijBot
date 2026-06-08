import { describe, expect, it } from "vitest";
import { calculateDiscountAmount, payableAmount, walletOffsetForOrder } from "../src/domain/checkout.js";
import { expirationFromNow, gbToBytes } from "../src/domain/plans.js";
import { makeReferralCode, parseReferralPayload } from "../src/domain/referral.js";
import { sanitizeUsername, withRandomSuffix } from "../src/domain/username.js";
import { calculateWalletBalance } from "../src/domain/wallet.js";

describe("domain helpers", () => {
  it("sanitizes usernames", () => {
    expect(sanitizeUsername("@Ha med!*")).toBe("Ha_med_");
    expect(sanitizeUsername("ab")).toMatch(/^user_/);
  });

  it("adds a four digit suffix without growing too long", () => {
    expect(withRandomSuffix("averyveryveryverylongusername", "1234")).toBe("averyveryveryverylonguse_1234");
  });

  it("calculates wallet balance from posted ledger items only", () => {
    expect(
      calculateWalletBalance([
        { amountToman: 100_000, status: "POSTED" },
        { amountToman: -40_000, status: "POSTED" },
        { amountToman: 10_000, status: "PENDING" }
      ])
    ).toBe(60_000);
  });

  it("converts plans to Remnawave units", () => {
    expect(gbToBytes(20)).toBe(21_474_836_480);
    expect(expirationFromNow(30, new Date("2026-01-01T00:00:00Z")).toISOString()).toBe("2026-01-31T00:00:00.000Z");
  });

  it("calculates checkout payable amount with discount and wallet", () => {
    expect(calculateDiscountAmount(140_000, { percentOff: 20 })).toBe(28_000);
    expect(calculateDiscountAmount(140_000, { amountOffToman: 50_000 })).toBe(50_000);
    expect(walletOffsetForOrder(140_000, 30_000)).toBe(30_000);
    expect(payableAmount(140_000, 10_000, 30_000)).toBe(100_000);
  });

  it("parses referral payloads", () => {
    expect(makeReferralCode(12345)).toBe("HV9IX");
    expect(parseReferralPayload("ref_HV9IX")).toBe("HV9IX");
    expect(parseReferralPayload("bad_HV9IX")).toBeNull();
  });
});
