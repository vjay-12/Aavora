import type { IncomingMessage, ServerResponse } from "http";
import logoutHandler from "./auth/logout.js";

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  return logoutHandler(req, res);
}
