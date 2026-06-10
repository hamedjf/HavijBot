import axios, { type AxiosInstance } from "axios";
import { existsSync } from "node:fs";
import path from "node:path";
import QRCode from "qrcode";
import sharp from "sharp";
import { config } from "../config.js";
import { logger } from "../logger.js";

export type CreateUserInput = {
  username: string;
  telegramId: number;
  trafficLimitBytes: number;
  expiresAt: Date;
  squadUuids: string[];
  orderId: string;
};

export type CreateTrialUserInput = Omit<CreateUserInput, "username">;

export type RemnawaveUser = {
  uuid: string;
  remnawaveId?: number;
  username: string;
  shortUuid?: string;
  subscriptionUrl?: string;
  usedTrafficBytes?: number;
  trafficLimitBytes?: number;
  expiresAt?: Date;
  status?: string;
  isActive?: boolean;
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
      isActive: true,
      enabled: true,
      trafficLimitBytes: input.trafficLimitBytes,
      trafficLimitStrategy: "NO_RESET",
      expireAt: input.expiresAt.toISOString(),
      expiresAt: input.expiresAt.toISOString(),
      telegramId: input.telegramId,
      tag: "BOT",
      activeInternalSquads: input.squadUuids,
      internalSquads: input.squadUuids,
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
    const user = normalizeUser(response.data);
    logger.info(
      {
        action: "remnawave.createUser.response",
        orderId: input.orderId,
        telegramId: input.telegramId,
        remnawaveUserUuid: user.uuid,
        username: user.username,
        status: user.status,
        isActive: user.isActive,
        trafficLimitBytes: user.trafficLimitBytes,
        expiresAt: user.expiresAt?.toISOString(),
        hasShortUuid: Boolean(user.shortUuid),
        squadCount: input.squadUuids.length
      },
      "Remnawave user created"
    );
    return user;
  }

  async createTrialUser(input: CreateTrialUserInput): Promise<RemnawaveUser> {
    const tempUsername = `test_${input.telegramId}_${Date.now()}`;
    const payload = {
      username: tempUsername,
      status: "ACTIVE",
      isActive: true,
      enabled: true,
      trafficLimitBytes: input.trafficLimitBytes,
      trafficLimitStrategy: "NO_RESET",
      expireAt: input.expiresAt.toISOString(),
      expiresAt: input.expiresAt.toISOString(),
      telegramId: input.telegramId,
      tag: "BOTTEST",
      activeInternalSquads: input.squadUuids,
      internalSquads: input.squadUuids,
      description: `HavijBot free trial ${input.orderId}`
    };

    logger.info(
      {
        action: "remnawave.createTrialUser",
        orderId: input.orderId,
        telegramId: input.telegramId
      },
      "Creating Remnawave trial user"
    );

    const createResponse = await this.#safeRequest(() => this.http.post("/api/users", payload), "create trial user");
    const createdUser = normalizeUser(createResponse.data);
    if (!createdUser.remnawaveId) {
      return createdUser;
    }

    const finalUsername = `test${createdUser.remnawaveId}`;
    const updateResponse = await this.#safeRequest(
      () =>
        this.http.patch("/api/users", {
          uuid: createdUser.uuid,
          username: finalUsername,
          tag: "BOTTEST"
        }),
      "rename trial user"
    );

    return normalizeUser(updateResponse.data);
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
      throw new Error("کاربر در Remnawave پیدا نشد.");
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
      throw new Error("کاربر در Remnawave پیدا نشد.");
    }

    if (user.subscriptionUrl) {
      return user.subscriptionUrl;
    }

    if (user.shortUuid) {
      return `${config.REMNAWAVE_BASE_URL.replace(/\/$/, "")}/sub/${user.shortUuid}`;
    }

    throw new Error("لینک ساب از پاسخ Remnawave پیدا نشد.");
  }

  async getSubscriptionQr(usernameOrUuid: string): Promise<Buffer> {
    const subscriptionUrl = await this.getSubscriptionUrl(usernameOrUuid);
    return generateBrandedQr(subscriptionUrl);
  }

  async getSubscriptionConfigs(usernameOrUuid: string): Promise<string[]> {
    const subscriptionUrl = await this.getSubscriptionUrl(usernameOrUuid);
    const response = await this.#safeRequest(
      () =>
        axios.get<string>(subscriptionUrl, {
          timeout: 15_000,
          responseType: "text",
          transformResponse: (data) => data
        }),
      "get subscription configs"
    );

    if (typeof response.data !== "string") {
      return [];
    }

    return parseSubscriptionConfigLines(response.data);
  }

  async extendUserTrafficAndExpiry(input: ExtendUserInput): Promise<RemnawaveUser> {
    const user = await this.getUser(input.userUuid);
    if (!user) {
      throw new Error("کاربر در Remnawave پیدا نشد.");
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

    const response = await this.#safeRequest(() => this.http.patch("/api/users", { uuid: input.userUuid, ...payload }), "extend user");
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

async function generateBrandedQr(value: string): Promise<Buffer> {
  const size = 512;
  const logoSize = 110;
  const logoPadding = 16;
  const logoPath = path.join(process.cwd(), "assets", "havijnet.png");
  const qr = await QRCode.toBuffer(value, {
    type: "png",
    margin: 1,
    width: size,
    errorCorrectionLevel: "H",
    color: {
      dark: "#111827",
      light: "#ffffff"
    }
  });

  if (!existsSync(logoPath)) {
    return qr;
  }

  try {
    const badgeSize = logoSize + logoPadding * 2;
    const badgeBackground = Buffer.from(
      `<svg width="${badgeSize}" height="${badgeSize}" viewBox="0 0 ${badgeSize} ${badgeSize}">
        <rect x="0" y="0" width="${badgeSize}" height="${badgeSize}" rx="24" fill="#ffffff"/>
      </svg>`
    );
    const badge = await sharp(badgeBackground)
      .composite([
        {
          input: await sharp(logoPath)
            .resize(logoSize, logoSize, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 } })
            .png()
            .toBuffer(),
          left: logoPadding,
          top: logoPadding
        }
      ])
      .png()
      .toBuffer();

    return sharp(qr)
      .composite([{ input: badge, left: Math.round((size - badgeSize) / 2), top: Math.round((size - badgeSize) / 2) }])
      .png()
      .toBuffer();
  } catch (error) {
    logger.warn({ err: error, logoPath }, "Branded QR generation failed; falling back to plain QR");
    return qr;
  }
}

function parseSubscriptionConfigLines(body: string): string[] {
  const directLines = splitConfigLines(body);
  if (directLines.some((line) => /^[a-z][a-z0-9+.-]*:\/\//i.test(line))) {
    return directLines;
  }

  try {
    return splitConfigLines(Buffer.from(body.trim(), "base64").toString("utf8"));
  } catch {
    return directLines;
  }
}

function splitConfigLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function normalizeUser(raw: unknown): RemnawaveUser {
  const data = unwrapData(raw);
  const uuid = firstString(data, ["uuid", "id"]);
  const username = firstString(data, ["username", "name"]);

  if (!uuid || !username) {
    throw new Error("پاسخ کاربر Remnawave نامعتبر است.");
  }

  return {
    uuid,
    remnawaveId: firstNumber(data, ["id"]),
    username,
    shortUuid: firstString(data, ["shortUuid", "short_uuid", "subscriptionUuid"]),
    subscriptionUrl: firstString(data, ["subscriptionUrl", "subscription_url", "subUrl"]),
    usedTrafficBytes: firstNumber(data, [
      "usedTrafficBytes",
      "usedTraffic",
      "usedBytes",
      "usedTrafficBytesTotal",
      "trafficUsedBytes",
      "trafficUsed",
      "usedTrafficTotal"
    ]),
    trafficLimitBytes: firstNumber(data, [
      "trafficLimitBytes",
      "trafficLimit",
      "totalTrafficBytes",
      "totalTraffic",
      "limitBytes",
      "dataLimit",
      "trafficLimitBytesTotal"
    ]),
    expiresAt: firstDate(data, ["expiresAt", "expireAt", "expiredAt", "expires_at", "expire_at", "expiryTime", "expiryDate"]),
    status: firstString(data, ["status", "state"]),
    isActive: firstBoolean(data, ["isActive", "active", "enabled"])
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
    const value = findNestedValue(data, key);
    if (typeof value === "number") {
      return value;
    }
    if (typeof value === "string" && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return undefined;
}

function findNestedValue(data: RemnawaveRawUser, key: string, depth = 0): unknown {
  if (Object.prototype.hasOwnProperty.call(data, key)) {
    return data[key];
  }
  if (depth >= 2) {
    return undefined;
  }

  for (const value of Object.values(data)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }
    const nested = findNestedValue(value as RemnawaveRawUser, key, depth + 1);
    if (nested !== undefined) {
      return nested;
    }
  }

  return undefined;
}

function firstBoolean(data: RemnawaveRawUser, keys: string[]): boolean | undefined {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "boolean") {
      return value;
    }
    if (typeof value === "string" && ["true", "false"].includes(value.toLowerCase())) {
      return value.toLowerCase() === "true";
    }
  }
  return undefined;
}

function firstDate(data: RemnawaveRawUser, keys: string[]): Date | undefined {
  const value = firstString(data, keys);
  if (!value) {
    return undefined;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
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
    return new Error(`درخواست Remnawave ناموفق بود${status ? ` (${status})` : ""}: ${responseData}`);
  }
  return error instanceof Error ? error : new Error(String(error));
}
