import type { IncomingMessage, ServerResponse } from "http";
import { authenticateRequest } from "../_utils/auth";
import { checkRateLimit } from "../_utils/rate-limit";
import { json, error } from "../_utils/response";

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (!checkRateLimit(req, res, 60, 60000)) return;

  try {
    const user = await authenticateRequest(req, res);
    if (!user) {
      return error(res, "Not authenticated", 401);
    }

    return json(res, {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    });
  } catch (err: any) {
    return error(res, err.message || "Failed to get user session", 500);
  }
}
