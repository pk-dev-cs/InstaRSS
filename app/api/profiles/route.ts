import { NextResponse } from "next/server";
import { addProfile } from "@/lib/sync";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const form = await request.formData();
  try {
    addProfile(String(form.get("username") || ""));
  } catch (error) {
    return new Response(String(error), { status: 400 });
  }
  return NextResponse.redirect(new URL("/", request.url), 303);
}
