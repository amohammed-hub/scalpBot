import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import cookieParser from "cookie-parser";
import express from "express";
import jwt from "jsonwebtoken";
import superjson from "superjson";
import { createTRPCClient, httpLink, TRPCClientError } from "@trpc/client";
import { afterEach, describe, expect, it } from "vitest";
import {
  createTrpcAuthGate,
  getTrpcProcedurePaths,
} from "./_core/trpcAuthGate";

const JWT_SECRET = "test-secret-key";
const openServers = new Set<Server>();

async function startGateServer(): Promise<{ baseUrl: string; server: Server }> {
  const app = express();

  // This order intentionally matches production. The regression being protected
  // is that the gate must run only after cookie-parser populates req.cookies.
  app.use(cookieParser());
  app.use(
    "/api/trpc",
    createTrpcAuthGate({ getJwtSecret: () => JWT_SECRET }),
  );
  app.use("/api/trpc", (req, res) => {
    res.json({
      ok: true,
      path: req.path,
      authenticatedByCookie: typeof req.cookies?.scalpbot_auth === "string",
    });
  });

  const server = await new Promise<Server>(resolve => {
    const listeningServer = app.listen(0, "127.0.0.1", () => resolve(listeningServer));
  });
  openServers.add(server);

  const address = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${address.port}`, server };
}

async function closeServer(server: Server): Promise<void> {
  openServers.delete(server);
  await new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
}

function signValidToken(): string {
  return jwt.sign(
    { userId: 1, mobile: "9876543210", role: "admin" },
    JWT_SECRET,
    { expiresIn: "24h" },
  );
}

function deserializeTrpcError(responseBody: any): any {
  expect(responseBody).toHaveProperty("error.json");
  return superjson.deserialize(responseBody.error);
}

afterEach(async () => {
  await Promise.all([...openServers].map(server => closeServer(server)));
});

describe("tRPC auth gate", () => {
  it("allows whitelisted public procedures without a token", async () => {
    const { baseUrl, server } = await startGateServer();

    const response = await fetch(`${baseUrl}/api/trpc/mobileAuth.me`);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      path: "/mobileAuth.me",
    });
    await closeServer(server);
  });

  it("blocks sensitive procedures with a SuperJSON-compatible tRPC 401", async () => {
    const { baseUrl, server } = await startGateServer();

    const response = await fetch(`${baseUrl}/api/trpc/credentials.save`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ json: { apiKey: "inert", apiSecret: "inert" } }),
    });
    const body = await response.json();
    const error = deserializeTrpcError(body);

    expect(response.status).toBe(401);
    expect(error).toMatchObject({
      message: "Authentication required. Please log in.",
      code: -32001,
      data: {
        code: "UNAUTHORIZED",
        httpStatus: 401,
        path: "credentials.save",
      },
    });
    await closeServer(server);
  });

  it("surfaces a normal UNAUTHORIZED error through the real tRPC/SuperJSON client", async () => {
    const { baseUrl, server } = await startGateServer();
    const client = createTRPCClient<any>({
      links: [
        httpLink({
          url: `${baseUrl}/api/trpc`,
          transformer: superjson,
        }),
      ],
    });

    let caughtError: unknown;
    try {
      await client.credentials.save.mutate({
        apiKey: "inert",
        apiSecret: "inert",
      });
    } catch (error) {
      caughtError = error;
    }

    expect(caughtError).toBeInstanceOf(TRPCClientError);
    expect(caughtError).toMatchObject({
      message: "Authentication required. Please log in.",
      data: {
        code: "UNAUTHORIZED",
        httpStatus: 401,
        path: "credentials.save",
      },
    });
    expect((caughtError as Error).message).not.toContain(
      "Unable to transform response from server",
    );
    await closeServer(server);
  });

  it("recognizes a valid scalpbot_auth cookie after cookie parsing", async () => {
    const { baseUrl, server } = await startGateServer();
    const token = signValidToken();

    const response = await fetch(`${baseUrl}/api/trpc/credentials.save`, {
      headers: { cookie: `scalpbot_auth=${token}` },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      authenticatedByCookie: true,
    });
    await closeServer(server);
  });

  it("allows a sensitive procedure with a valid bearer JWT", async () => {
    const { baseUrl, server } = await startGateServer();

    const response = await fetch(`${baseUrl}/api/trpc/trades.list`, {
      headers: { authorization: `Bearer ${signValidToken()}` },
    });

    expect(response.status).toBe(200);
    await closeServer(server);
  });

  it("returns a transformable tRPC 401 for an invalid or expired JWT", async () => {
    const { baseUrl, server } = await startGateServer();
    const expiredToken = jwt.sign({ userId: 1 }, JWT_SECRET, { expiresIn: "-1h" });

    const response = await fetch(`${baseUrl}/api/trpc/multiBots.allStatus`, {
      headers: { authorization: `Bearer ${expiredToken}` },
    });
    const error = deserializeTrpcError(await response.json());

    expect(response.status).toBe(401);
    expect(error).toMatchObject({
      message: "Invalid or expired session. Please log in again.",
      code: -32001,
      data: {
        code: "UNAUTHORIZED",
        httpStatus: 401,
        path: "multiBots.allStatus",
      },
    });
    await closeServer(server);
  });

  it("blocks a mixed batch and returns one valid tRPC error per operation", async () => {
    const { baseUrl, server } = await startGateServer();

    const response = await fetch(
      `${baseUrl}/api/trpc/mobileAuth.me,credentials.get?batch=1`,
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toHaveLength(2);
    expect(body.map(deserializeTrpcError)).toEqual([
      expect.objectContaining({
        code: -32001,
        data: expect.objectContaining({ path: "mobileAuth.me" }),
      }),
      expect.objectContaining({
        code: -32001,
        data: expect.objectContaining({ path: "credentials.get" }),
      }),
    ]);
    await closeServer(server);
  });

  it("parses empty and comma-separated procedure paths deterministically", () => {
    expect(getTrpcProcedurePaths("")).toEqual([]);
    expect(getTrpcProcedurePaths("/")).toEqual([]);
    expect(getTrpcProcedurePaths("/mobileAuth.me, credentials.get")).toEqual([
      "mobileAuth.me",
      "credentials.get",
    ]);
  });
});
