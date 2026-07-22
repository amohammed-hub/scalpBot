import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import jwt from "jsonwebtoken";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = t.procedure.use(requireUser);

export const adminProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== 'admin') {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
);

// ── Mobile Auth Middleware ──────────────────────────────────────────────────
// Verifies the scalpbot_auth JWT (from cookie or Authorization header).
// This is independent of Manus OAuth — used for the mobile OTP login system.
const requireMobileAuth = t.middleware(async opts => {
  const { ctx, next } = opts;
  const token: string | undefined =
    ctx.req?.cookies?.scalpbot_auth
    || ctx.req?.headers?.authorization?.replace("Bearer ", "")
    || (ctx.req?.headers?.["x-auth-token"] as string | undefined);

  if (!token) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Authentication required. Please log in." });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "fallback-secret") as {
      userId: number;
      mobile: string;
      role: string;
    };
    return next({
      ctx: {
        ...ctx,
        mobileUser: decoded,
      },
    });
  } catch {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid or expired session. Please log in again." });
  }
});

export const authenticatedProcedure = t.procedure.use(requireMobileAuth);
