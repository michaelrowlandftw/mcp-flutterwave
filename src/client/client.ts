import createClient, { Middleware } from "openapi-fetch";
import type { paths } from "./types/v3.js";
import authMiddlewareV3 from "./middleware/authMiddlewareV3.js";
import { USER_AGENT } from "../config/userAgent.js";

const FLW_API_VERSION = process.env.FLW_VERSION || 'v3';
const FLW_API_BASE = "https://api.flutterwave.com/" + FLW_API_VERSION;
 
/** Every v3 call times out, so a hung create becomes "unknown", not a silent wait (review L3). */
const timedFetch = (input: Request) => fetch(input, { signal: AbortSignal.timeout(Number(process.env.FLW_TIMEOUT_MS) || 60_000) });
const client = createClient<paths>({ baseUrl: FLW_API_BASE, headers: { "User-Agent": USER_AGENT }, fetch: timedFetch });
client.use(authMiddlewareV3);

export default client