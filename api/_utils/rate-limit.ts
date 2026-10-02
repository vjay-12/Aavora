import type { IncomingMessage, ServerResponse } from "http";
import { error } from "./response";
import fs from "fs";
import path from "path";
import os from "os";

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

const RATE_LIMIT_FILE = path.join(os.tmpdir(), "aavora-rate-limit.json");
const memoryStore = new Map<string, RateLimitRecord>();

function readStore(): Record<string, RateLimitRecord> {
  try {
    if (fs.existsSync(RATE_LIMIT_FILE)) {
      const data = fs.readFileSync(RATE_LIMIT_FILE, "utf-8");
      return JSON.parse(data);
    }
  } catch {
    // Fallback to memory
  }
  return Object.fromEntries(memoryStore.entries());
}

function writeStore(store: Record<string, RateLimitRecord>) {
  try {
    fs.writeFileSync(RATE_LIMIT_FILE, JSON.stringify(store));
  } catch {
    for (const [k, v] of Object.entries(store)) {
      memoryStore.set(k, v);
    }
  }
}

export function getClientIp(req: IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    return forwarded.split(",")[0].trim();
  }
  return req.socket?.remoteAddress || "127.0.0.1";
}

/**
 * Sliding window rate limiter persisted across serverless worker processes
 */
export function checkRateLimit(
  req: IncomingMessage,
  res: ServerResponse,
  maxRequests = 20,
  windowMs = 60000
): boolean {
  const ip = getClientIp(req);
  const now = Date.now();
  const store = readStore();
  const record = store[ip];

  if (!record || now > record.resetAt) {
    store[ip] = {
      count: 1,
      resetAt: now + windowMs,
    };
    writeStore(store);
    return true;
  }

  if (record.count >= maxRequests) {
    const retryAfter = Math.ceil((record.resetAt - now) / 1000);
    res.setHeader("Retry-After", retryAfter.toString());
    error(res, "Too many requests. Please try again later.", 429);
    return false;
  }

  record.count += 1;
  store[ip] = record;
  writeStore(store);
  return true;
}

export function resetRateLimits() {
  try {
    if (fs.existsSync(RATE_LIMIT_FILE)) {
      fs.unlinkSync(RATE_LIMIT_FILE);
    }
  } catch {}
  memoryStore.clear();
}
