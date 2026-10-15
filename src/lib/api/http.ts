import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ApprovalRequiredError, DecisionError, ForbiddenError } from "../orchestrator/approvals";
import { RunConflictError } from "../orchestrator/runner";
import { boot } from "../boot";

export interface ApiEnvelope<T> {
  success: boolean;
  data: T | null;
  error: string | null;
}

export function ok<T>(data: T, status = 200): NextResponse<ApiEnvelope<T>> {
  return NextResponse.json({ success: true, data, error: null }, { status });
}

export function fail(error: string, status: number): NextResponse<ApiEnvelope<never>> {
  return NextResponse.json({ success: false, data: null, error }, { status });
}

/** Wraps a route handler: boots the app, maps domain errors to HTTP codes, never leaks stack traces. */
export async function handle<T>(fn: () => Promise<NextResponse<ApiEnvelope<T>>> | NextResponse<ApiEnvelope<T>>) {
  try {
    boot();
    return await fn();
  } catch (err) {
    if (err instanceof ZodError) return fail(err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "), 400);
    if (err instanceof ForbiddenError) return fail(err.message, 403);
    if (err instanceof RunConflictError || err instanceof DecisionError) return fail(err.message, 409);
    if (err instanceof ApprovalRequiredError) return fail(err.message, 412);
    console.error("[api] unhandled error", err);
    return fail("Internal server error", 500);
  }
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return {};
  }
}
