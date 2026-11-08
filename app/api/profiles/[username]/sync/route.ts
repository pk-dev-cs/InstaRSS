import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, profiles } from "@/lib/db";
import { normalizeUsername, syncProfile } from "@/lib/sync";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ username: string }> }) {
  const username = normalizeUsername((await context.params).username);
  if (!username) return new Response("Profile not found", { status: 404 });
  const profile = db.select().from(profiles).where(eq(profiles.username, username)).get();
  if (!profile) return new Response("Profile not found", { status: 404 });
  try { await syncProfile(profile); } catch { /* The profile error is shown on the dashboard. */ }
  return NextResponse.redirect(new URL("/", request.url), 303);
}
