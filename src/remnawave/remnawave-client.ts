import axios, { type AxiosInstance } from "axios";
import QRCode from "qrcode";
import { config } from "../config.js";
import { logger } from "../logger.js";

export type CreateUserInput = {
  username: string;
  telegramId: number;
  trafficLimitBytes: number;
  expiresAt: Date;
  squadUuid: string;
  orderId: string;
};

export type RemnawaveUser = {
  uuid: string;
  username: string;
  shortUuid?: string;
  subscriptionUrl?: string;
  usedTrafficBytes?: number;
  trafficLimitBytes?: number;
  expiresAt?: Date;
};

export type RemnawaveUsage = {
  usedTrafficBytes: number;
  trafficLimitBytes: number;
  expiresAt?: Date;
  isActive?: boolean;
};

export type ExtendUserInput = {
  userUuid: string;
  addTrafficBytes: number;
  addDays: number;
  fallbackTrafficLimitBytes: number;
  fallbackExpiresAt: Date;
  orderId: string;
  telegramId: number;
};

type RemnawaveRawUser = Record<string, unknown>;

export class RemnawaveClient {
  private readonly http: AxiosInstance;

  constructor(baseURL = config.REMNAWAVE_BASE_URL, token = config.REMNAWAVE_API_TOKEN) {
    this.http = axios.create({
      baseURL,
      timeout: 15_000,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      }
    });
  }

  async createUser(input: CreateUserInput): Promise<RemnawaveUser> {
    const payload = {
      username: input.username,
      status: "ACTIVE",
      trafficLimitBytes: input.trafficLimitBytes,
      trafficLimitStrategy: "NO_RESET",
      expireAt: input.expiresAt.toISOString(),
      expiresAt: input.expiresAt.toISOString(),
      telegramId: input.telegramId,
      activeInternalSquads: [input.squadUuid],
      internalSquads: [input.squadUuid],
      description: `HavijBot order ${input.orderId}`
    };

    logger.info(
      {
        action: "remnawave.createUser",
        orderId: input.orderId,
        telegramId: input.telegramId,
        username: input.username
      },
      "Creating Remnawave user"
    );

    const response = await this.#safeRequest(() => this.http.post("/api/users", payload), "create user");
    return normalizeUser(response.data);
  }

  async getUser(usernameOrUuid: string): Promise<RemnawaveUser | null> {
    const encoded = encodeURIComponent(usernameOrUuid);
    const candidates = isUuid(usernameOrUuid)
      ? [`/api/users/${encoded}`]
      : [`/api/users/by-username/${encoded}`];

    for (const endpoint of candidates) {
      try {
        const response = await this.http.get(endpoint);
        return normalizeUser(response.data);
      } catch (error: unknown) {
        if (!isNotFound(error)) {
          throw formatAxiosError(error, `get user via ${endpoint}`);
        }
      }
    }

    return null;
  }

  async getUserUsage(usernameOrUuid: string): Promise<RemnawaveUsage> {
    const user = await this.getUser(usernameOrUuid);
    if (!user) {
      throw new Error("Remnawave user peyda nashod.");
    }

    return {
      usedTrafficBytes: user.usedTrafficBytes ?? 0,
      trafficLimitBytes: user.trafficLimitBytes ?? 0,
      expiresAt: user.expiresAt,
      isActive: true
    };
  }

  async getSubscriptionUrl(usernameOrUuid: string): Promise<string> {
    const user = await this.getUser(usernameOrUuid);
    if (!user) {
      throw new Error("Remnawave user peyda nashod.");
    }

    if (user.subscriptionUrl) {
      return user.subscriptionUrl;
    }

    if (user.shortUuid) {
      return `${config.REMNAWAVE_BASE_URL.replace(/\/$/, "")}/sub/${user.shortUuid}`;
    }

    throw new Error("Subscription URL az Remnawave response peyda nashod.");
  }

  async getSubscriptionQr(usernameOrUuid: string): Promise<Buffer> {
    const subscriptionUrl = await this.getSubscriptionUrl(usernameOrUuid);
    return QRCode.toBuffer(subscriptionUrl, { type: "png", margin: 1, width: 512 });
  }

  async extendUserTrafficAndExpiry(input: ExtendUserInput): Promise<RemnawaveUser> {
    const user = await this.getUser(input.userUuid);
    if (!user) {
      throw new Error("Remnawave user peyda nashod.");
    }

    const currentLimit = user.trafficLimitBytes ?? input.fallbackTrafficLimitBytes;
    const currentExpiry = user.expiresAt ?? input.fallbackExpiresAt;
    const nextExpiryBase = currentExpiry.getTime() > Date.now() ? currentExpiry : new Date();
    const nextExpiresAt = new Date(nextExpiryBase);
    nextExpiresAt.setDate(nextExpiresAt.getDate() + input.addDays);

    const nextTrafficLimitBytes = currentLimit + input.addTrafficBytes;

    logger.info(
      {
        action: "remnawave.extendUserTrafficAndExpiry",
        orderId: input.orderId,
        telegramId: input.telegramId,
        remnawaveUserUuid: input.userUuid
      },
      "Extending Remnawave user traffic and expiry"
    );

    const payload = {
      trafficLimitBytes: nextTrafficLimitBytes,
      trafficLimitStrategy: "NO_RESET",
      expireAt: nextExpiresAt.toISOString(),
      expiresAt: nextExpiresAt.toISOString()
    };

    const response = await this.#safeRequest(() => this.http.patch(`/api/users/${encodeURIComponent(input.userUuid)}`, payload), "extend user");
    return normalizeUser(response.data);
  }

  async #safeRequest<T>(request: () => Promise<T>, action: string): Promise<T> {
    try {
      return await request();
    } catch (error) {
      throw formatAxiosError(error, action);
    }
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export const remnawaveClient = new RemnawaveClient();

function normalizeUser(raw: unknown): RemnawaveUser {
  const data = unwrapData(raw);
  const uuid = firstString(data, ["uuid", "id"]);
  const username = firstString(data, ["username", "name"]);

  if (!uuid || !username) {
    throw new Error("Remnawave user response invalid ast.");
  }

  return {
    uuid,
    username,
    shortUuid: firstString(data, ["shortUuid", "short_uuid", "subscriptionUuid"]),
    subscriptionUrl: firstString(data, ["subscriptionUrl", "subscription_url", "subUrl"]),
    usedTrafficBytes: firstNumber(data, ["usedTrafficBytes", "usedTraffic", "usedTrafficBytesTotal"]),
    trafficLimitBytes: firstNumber(data, ["trafficLimitBytes", "trafficLimit", "totalTrafficBytes"]),
    expiresAt: firstDate(data, ["expiresAt", "expireAt", "expiredAt"])
  };
}

function unwrapData(raw: unknown): RemnawaveRawUser {
  if (!raw || typeof raw !== "object") {
    return {};
  }

  const object = raw as Record<string, unknown>;
  const nested = object.response ?? object.data ?? object.user;
  if (nested && typeof nested === "object") {
    return nested as RemnawaveRawUser;
  }

  return object;
}

function firstString(data: RemnawaveRawUser, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

function firstNumber(data: RemnawaveRawUser, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "number") {
      return value;
    }
    if (typeof value === "string" && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return undefined;
}

function firstDate(data: RemnawaveRawUser, keys: string[]): Date | undefined {
  const value = firstString(data, keys);
  return value ? new Date(value) : undefined;
}

function isNotFound(error: unknown): boolean {
  return axios.isAxiosError(error) && error.response?.status === 404;
}

function summarizeResponseData(data: unknown): string {
  if (typeof data === "string") {
    return data.slice(0, 500);
  }
  if (!data) {
    return "no response body";
  }
  try {
    return JSON.stringify(data).slice(0, 500);
  } catch {
    return "unserializable response body";
  }
}

function formatAxiosError(error: unknown, action: string): Error {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const responseData = summarizeResponseData(error.response?.data);
    logger.error(
      {
        action: `remnawave.${action}`,
        status,
        responseData
      },
      "Remnawave request failed"
    );
    return new Error(`Remnawave ${action} failed${status ? ` (${status})` : ""}: ${responseData}`);
  }
  return error instanceof Error ? error : new Error(String(error));
}
