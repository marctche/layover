import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import airports from "@/data/airports.json";
import { DEFAULT_AIRPORT_LIMIT, searchAirports, type Airport } from "@/domain/airports/search";
import { createRequestServices } from "@/server";

const querySchema = z.string().trim().max(60);
const AIRPORTS = airports as Airport[];

// Airport search for the plan flow. The proxy already redirects signed-out visitors; the session
// is checked again here so the route is safe on its own.
export async function GET(request: NextRequest) {
  const { store } = await createRequestServices();
  if (!(await store.currentUserId())) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const parsed = querySchema.safeParse(request.nextUrl.searchParams.get("q") ?? "");
  if (!parsed.success) return NextResponse.json({ error: "invalid_query" }, { status: 400 });

  const results = searchAirports(AIRPORTS, parsed.data, DEFAULT_AIRPORT_LIMIT).map(({ iata, name, city, country }) => ({
    iata,
    name,
    city,
    country,
  }));
  return NextResponse.json({ results });
}
