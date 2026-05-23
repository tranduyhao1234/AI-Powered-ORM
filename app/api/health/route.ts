import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    checks: {
      supabaseUrlConfigured: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
      supabasePublishableKeyConfigured: Boolean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
      googlePlacesKeyConfigured: Boolean(process.env.GOOGLE_PLACES_API_KEY),
      longcatKeyConfigured: Boolean(process.env.LONGCAT_API_KEY),
    },
  });
}
