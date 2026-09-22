import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Proof that a request comes from the device a judge session was bound to.
 * Issued only to callers that already presented the matching `X-Device-Id`
 * header, so it can safely be placed in image URLs that cannot carry headers.
 */
export function deviceToken(sessionId: string, deviceId: string, secret: string): string {
  return createHmac("sha256", secret).update(`${sessionId}:${deviceId}`).digest("base64url");
}

export function verifyDeviceToken(
  sessionId: string,
  deviceId: string,
  secret: string,
  token: string
): boolean {
  const expected = Buffer.from(deviceToken(sessionId, deviceId, secret));
  const actual = Buffer.from(token);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}