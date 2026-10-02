import type { IncomingMessage, ServerResponse } from "http";
import { clearSessionCookie } from "../_utils/auth";
import { checkRateLimit } from "../_utils/rate-limit";
import { json } from "../_utils/response";

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (!checkRateLimit(req, res, 30, 60000)) return;
  clearSessionCookie(res);
  return json(res, { success: true });
}
