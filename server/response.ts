import type { ServerResponse } from "http";

export function setSecurityHeaders(res: ServerResponse) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Content-Security-Policy", "frame-ancestors 'none'");
}

export function json(res: ServerResponse, data: unknown, status = 200) {
  setSecurityHeaders(res);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
}

export function error(res: ServerResponse, message: string, status = 400, extra?: Record<string, unknown>) {
  setSecurityHeaders(res);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ error: message, status, ...extra }));
}

export async function parseJsonBody<T = unknown>(req: any): Promise<T> {
  if (req.body) {
    if (typeof req.body === "object") return req.body as T;
    if (typeof req.body === "string") {
      try {
        return JSON.parse(req.body) as T;
      } catch {
        return {} as T;
      }
    }
  }

  if (req.readableEnded || req.complete) {
    return {} as T;
  }

  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk: any) => {
      body += chunk;
      if (body.length > 5 * 1024 * 1024) {
        // Guard against overly large JSON payloads
        req.destroy();
        resolve({} as T);
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? (JSON.parse(body) as T) : ({} as T));
      } catch {
        resolve({} as T);
      }
    });
    req.on("error", () => resolve({} as T));
  });
}
