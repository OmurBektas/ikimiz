export const DAILY_SESSION_MS = 24 * 60 * 60 * 1000;
export function sessionExpiry(authTime) {
  const signedIn = Date.parse(authTime);
  return Number.isFinite(signedIn) ? signedIn + DAILY_SESSION_MS : 0;
}
export function dailySessionExpired(expiresAt, now = Date.now()) {
  return !Number.isFinite(expiresAt) || expiresAt <= now;
}
