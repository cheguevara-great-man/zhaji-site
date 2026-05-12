import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

export async function hashPassword(password) {
  const salt = randomToken(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt:${salt}:${hash.toString("base64url")}`;
}

export async function verifyPassword(password, stored) {
  const [scheme, salt, hashValue] = String(stored).split(":");
  if (scheme !== "scrypt" || !salt || !hashValue) return false;

  const expected = Buffer.from(hashValue, "base64url");
  const actual = await scrypt(password, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function parseCookies(header = "") {
  const cookies = new Map();
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (!key) continue;
    cookies.set(key, decodeURIComponent(rest.join("=")));
  }
  return cookies;
}

export function sessionCookie(token) {
  return `sid=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`;
}

export function clearSessionCookie() {
  return "sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0";
}
