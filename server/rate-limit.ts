import type { IncomingMessage, ServerResponse } from "http";
import { error } from "./response.js";

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateLimitRecord>();

// Clean up stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of rateLimitStore.entries()) {
    if (record.resetAt <= now) {
      rateLimitStore.delete(key);
    }
  }
}, 5 * 60 * 1000).unref();

export function resetRateLimits() {
  rateLimitStore.clear();
}

export function getClientIp(req: IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    return forwarded.split(",")[0].trim();
  }
  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return forwarded[0].trim();
  }
  return req.socket.remoteAddress || "127.0.0.1";
}

/**
 * In-memory sliding rate limiter for serverless environment.
 */
export function checkRateLimit(
  req: IncomingMessage,
  res: ServerResponse,
  maxRequests = 60,
  windowMs = 60000
): boolean {
  const ip = getClientIp(req);
  const now = Date.now();

  let record = rateLimitStore.get(ip);
  if (!record || record.resetAt <= now) {
    record = { count: 1, resetAt: now + windowMs };
    rateLimitStore.set(ip, record);
    return true;
  }

  record.count += 1;
  if (record.count > maxRequests) {
    const retryAfter = Math.ceil((record.resetAt - now) / 1000);
    res.setHeader("Retry-After", String(retryAfter));
    error(res, "Too many requests. Please slow down.", 429);
    return false;
  }

  return true;
}
