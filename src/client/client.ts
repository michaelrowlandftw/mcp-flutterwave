import createClient, { Middleware } from "openapi-fetch";
import type { paths } from "./types/v3.js";
import authMiddlewareV3 from "./middleware/authMiddlewareV3.js";
import { USER_AGENT } from "../config/userAgent.js";

const FLW_API_VERSION = process.env.FLW_VERSION || 'v3';
const FLW_API_BASE = "https://api.flutterwave.com/" + FLW_API_VERSION;
 
const client = createClient<paths>({ baseUrl: FLW_API_BASE, headers: { "User-Agent": USER_AGENT } });
client.use(authMiddlewareV3);

export default client