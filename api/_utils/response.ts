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

export function error(res: ServerResponse, message: string, status = 400) {
  setSecurityHeaders(res);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ error: message, status }));
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
    const timer = setTimeout(() => {
      try {
        resolve(body ? JSON.parse(body) : ({} as T));
      } catch {
        resolve({} as T);
      }
    }, 2000);

    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      clearTimeout(timer);
      try {
        resolve(body ? JSON.parse(body) : ({} as T));
      } catch {
        resolve({} as T);
      }
    });
    req.on("error", () => {
      clearTimeout(timer);
      resolve({} as T);
    });
  });
}
