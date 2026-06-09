import { describe, expect, it } from "vitest";
import { getPublicRemnawaveMethods } from "../src/remnawave/safety.test-helper.js";

describe("Remnawave safety boundary", () => {
  it("exposes only user/subscription read-create methods", () => {
    expect(getPublicRemnawaveMethods()).toEqual([
      "createUser",
      "extendUserTrafficAndExpiry",
      "getSubscriptionConfigs",
      "getSubscriptionQr",
      "getSubscriptionUrl",
      "getUser",
      "getUserUsage"
    ]);
  });
});
