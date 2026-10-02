import type { IncomingMessage, ServerResponse } from "http";
import meHandler from "./auth/me.js";

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  return meHandler(req, res);
}
