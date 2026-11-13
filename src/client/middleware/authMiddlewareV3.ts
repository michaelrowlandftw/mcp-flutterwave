import { Middleware } from "openapi-fetch";
import { RateLimiter } from "../../utils/rate-limiter.js";
import { setUsageHeaders } from "../../config/userAgent.js";
import { assertSafePathParam } from "../../utils/safePath.js";

const rateLimiter = new RateLimiter(10, 1000);

export const authMiddlewareV3: Middleware = {
    async onRequest({ request, params }) {
      // The URL is already resolved here ("/x/.." is gone), so check the raw path
      // parameters instead (review N6).
      for (const value of Object.values(params?.path ?? {})) assertSafePathParam(value);
      await rateLimiter.throttle();
      request.headers.set("Authorization", "Bearer " + process.env.FLW_SECRET_KEY);
      setUsageHeaders(request.headers);
      return request;
    }
};

export default authMiddlewareV3;
