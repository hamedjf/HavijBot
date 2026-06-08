import { RemnawaveClient } from "./remnawave-client.js";

export function getPublicRemnawaveMethods(): string[] {
  return Object.getOwnPropertyNames(RemnawaveClient.prototype)
    .filter((name) => name !== "constructor")
    .sort();
}

