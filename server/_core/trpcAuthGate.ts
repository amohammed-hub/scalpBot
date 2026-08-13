import type { Request, RequestHandler } from "express";
import jwt from "jsonwebtoken";
import superjson from "superjson";
import { getJwtSecret as getPersistentJwtSecret } from "../authSession";

const UNAUTHORIZED_TRPC_CODE = -32001;

export const PUBLIC_TRPC_PROCEDURES = new Set([
  // Auth flows (must be public for login/signup)
  "mobileAuth.sendOtp",
  "mobileAuth.verifyOtp",
  "mobileAuth.me",
  "mobileAuth.updateName",
  "mobileAuth.logout",
  // Legacy auth stub
  "auth.me",
  "auth.logout",
  // Admin login (has its own password check)
  "admin.login",
  "admin.verify",
  // Subscription (needed for paywall before full access)
  "subscription.checkAccess",
  "subscription.startTrial",
  "subscription.createOrder",
  "subscription.verifyPayment",
  // Referral (public for signup flow)
  "referral.applyCode",
  "referral.myReferral",
  // System health
  "system.health",
  // D23: Post-deploy smoke probes — secret-gated and non-destructive
  // (throwaway test tokens; never touch users, bots, or orders)
  "smoke.flagState",
  "smoke.roundTrip",
  "smoke.egress",
  "smoke.startGuard",
]);

type AuthenticatedRequestParts = Pick<Request, "cookies" | "headers">;

type CreateTrpcAuthGateOptions = {
  getJwtSecret?: () => string;
};

function getFirstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function getTrpcProcedurePaths(path: string): string[] {
  const procedurePath = path.replace(/^\//, "");
  if (!procedurePath) return [];

  return procedurePath
    .split(",")
    .map(procedure => procedure.trim())
    .filter(Boolean);
}

export function getMobileAuthToken(req: AuthenticatedRequestParts): string | undefined {
  const cookieToken = req.cookies?.scalpbot_auth;
  if (typeof cookieToken === "string" && cookieToken.length > 0) {
    return cookieToken;
  }

  const authorization = getFirstHeaderValue(req.headers.authorization);
  if (authorization?.startsWith("Bearer ")) {
    const bearerToken = authorization.slice("Bearer ".length);
    if (bearerToken.length > 0) return bearerToken;
  }

  const headerToken = getFirstHeaderValue(req.headers["x-auth-token"]);
  return headerToken && headerToken.length > 0 ? headerToken : undefined;
}

export function createTrpcUnauthorizedResponse(
  procedurePaths: string[],
  message: string,
): object | object[] {
  const paths = procedurePaths.length > 0 ? procedurePaths : [undefined];
  const responses = paths.map(path => ({
    error: superjson.serialize({
      message,
      code: UNAUTHORIZED_TRPC_CODE,
      data: {
        code: "UNAUTHORIZED",
        httpStatus: 401,
        ...(path ? { path } : {}),
      },
    }),
  }));

  return responses.length === 1 ? responses[0] : responses;
}

export function createTrpcAuthGate(
  options: CreateTrpcAuthGateOptions = {},
): RequestHandler {
  const resolveJwtSecret = options.getJwtSecret ?? getPersistentJwtSecret;

  return (req, res, next) => {
    const procedures = getTrpcProcedurePaths(req.path);
    if (procedures.length === 0) {
      next();
      return;
    }

    const allPublic = procedures.every(procedure => PUBLIC_TRPC_PROCEDURES.has(procedure));
    if (allPublic) {
      next();
      return;
    }

    const token = getMobileAuthToken(req);
    if (!token) {
      res
        .status(401)
        .json(createTrpcUnauthorizedResponse(
          procedures,
          "Authentication required. Please log in.",
        ));
      return;
    }

    try {
      jwt.verify(token, resolveJwtSecret());
      next();
    } catch {
      res
        .status(401)
        .json(createTrpcUnauthorizedResponse(
          procedures,
          "Invalid or expired session. Please log in again.",
        ));
    }
  };
}
