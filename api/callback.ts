import type { IncomingMessage, ServerResponse } from "http";
import callbackHandler from "./auth/callback.js";

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  return callbackHandler(req, res);
}
