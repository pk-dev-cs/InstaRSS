import { addProfile } from "@/lib/sync";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const form = await request.formData();
  try {
    addProfile(String(form.get("username") || ""));
  } catch (error) {
    return new Response(String(error), { status: 400 });
  }
  return new Response(null, { status: 303, headers: { Location: "/" } });
}
