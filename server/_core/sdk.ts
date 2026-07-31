import { ForbiddenError } from "../../shared/_core/errors.js";
import { jwtVerify } from "jose";
import type { Request } from "express";
import type { User } from "../../drizzle/schema";
import * as db from "../db";
import { ENV } from "./env";

class SDKServer {
  async authenticateRequest(req: Request): Promise<User> {
    // Extract Bearer token from Authorization header
    const authHeader = req.headers.authorization || req.headers.Authorization;
    let token: string | undefined;
    if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
      token = authHeader.slice("Bearer ".length).trim();
    }

    if (!token) {
      throw ForbiddenError("Missing authorization token");
    }

    // Validate Supabase JWT using the project JWT secret
    const jwtSecret = ENV.supabaseJwtSecret;
    if (!jwtSecret) {
      throw ForbiddenError("Server auth not configured (missing SUPABASE_JWT_SECRET)");
    }

    let supabaseUserId: string;
    let supabaseEmail: string | null = null;
    let supabaseName: string | null = null;
    let loginMethod = "email";

    try {
      const secretKey = new TextEncoder().encode(jwtSecret);
      const { payload } = await jwtVerify(token, secretKey, { algorithms: ["HS256"] });
      supabaseUserId = payload.sub as string;
      supabaseEmail = (payload.email as string) ?? null;
      const meta = ((payload as any).user_metadata as Record<string, unknown>) ?? {};
      supabaseName = ((meta.full_name ?? meta.name) as string) ?? null;
      // Detect Apple Sign In from app_metadata.providers
      const appMeta = ((payload as any).app_metadata as Record<string, unknown>) ?? {};
      const providers = (appMeta.providers as string[]) ?? [];
      if (providers.includes("apple")) loginMethod = "apple";
    } catch (error) {
      console.warn("[Auth] Supabase JWT verification failed:", String(error));
      throw ForbiddenError("Invalid or expired token");
    }

    if (!supabaseUserId) {
      throw ForbiddenError("Token missing user ID");
    }

    const signedInAt = new Date();
    let user = await db.getUserByOpenId(supabaseUserId);

    // Auto-provision user in DB on first login
    if (!user) {
      try {
        await db.upsertUser({
          openId: supabaseUserId,
          name: supabaseName,
          email: supabaseEmail,
          loginMethod,
          lastSignedIn: signedInAt,
        });
        user = await db.getUserByOpenId(supabaseUserId);
      } catch (error) {
        console.error("[Auth] Failed to provision user:", error);
        throw ForbiddenError("Failed to create user record");
      }
    }

    if (!user) {
      throw ForbiddenError("User not found after provisioning");
    }

    // Update last sign-in timestamp
    await db.upsertUser({ openId: user.openId, lastSignedIn: signedInAt });
    return user;
  }
}

export const sdk = new SDKServer();
