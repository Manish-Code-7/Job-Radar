"use client";
import { createAuthClient } from "@neon/auth/next";

// Talks to our same-origin /api/auth proxy. Takes no options by design.
export const authClient = createAuthClient();
