import { randomBytes, scryptSync, timingSafeEqual, createHash, createHmac } from "node:crypto";
import jwt from "jsonwebtoken";
import type { TokenPayload } from "@ke/types";

const SCRYPT_KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN);
  return `scrypt:${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split(":");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, salt, SCRYPT_KEYLEN);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function hashDeviceId(deviceId: string, secret: string): string {
  return createHmac("sha256", secret).update(deviceId).digest("hex");
}

export function signToken(payload: Omit<TokenPayload, "iat" | "exp">, secret: string, ttlHours: number): string {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    { ...payload, iat: now, exp: now + ttlHours * 3600 } as TokenPayload,
    secret,
    { algorithm: "HS256" }
  );
}

export function verifyToken(token: string, secret: string): TokenPayload {
  const decoded = jwt.verify(token, secret, { algorithms: ["HS256"] }) as TokenPayload;
  return decoded;
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function pinCode(length = 4): string {
  let pin = "";
  for (let i = 0; i < length; i++) {
    pin += Math.floor(Math.random() * 10).toString();
  }
  return pin;
}