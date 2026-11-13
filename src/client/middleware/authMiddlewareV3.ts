import { Middleware } from "openapi-fetch";
import { RateLimiter } from "../../utils/rate-limiter.js";
import { setUsageHeaders } from "../../config/userAgent.js";
import { assertSafePathParam } from "../../utils/safePath.js";
import { V3Rejected } from "../../utils/reference.js";

const rateLimiter = new RateLimiter(10, 1000);

export const authMiddlewareV3: Middleware = {
    async onRequest({ request, params }) {
      // The URL is already resolved here ("/x/.." is gone), so check the raw path
      // parameters instead (review N6).
      try {
        for (const value of Object.values(params?.path ?? {})) assertSafePathParam(value);
      } catch (error) {
        // A refusal before sending: nothing was created, so no lookup or retry (third review, issue 5).
        throw new V3Rejected(error instanceof Error ? error.message : String(error));
      }
      await rateLimiter.throttle();
      request.headers.set("Authorization", "Bearer " + process.env.FLW_SECRET_KEY);
      setUsageHeaders(request.headers);
      return request;
    }
};

export default authMiddlewareV3;
