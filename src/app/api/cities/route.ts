import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import cities from "@/data/cities.json";
import { DEFAULT_CITY_LIMIT, searchCities, type City } from "@/domain/cities/search";
import { createRequestServices } from "@/server";

const querySchema = z.string().trim().max(60);
const CITIES = cities as City[];

// City search for the plan flow. The proxy already redirects signed-out visitors; the session
// is checked again here so the route is safe on its own.
export async function GET(request: NextRequest) {
  const { store } = await createRequestServices();
  if (!(await store.currentUserId())) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const parsed = querySchema.safeParse(request.nextUrl.searchParams.get("q") ?? "");
  if (!parsed.success) return NextResponse.json({ error: "invalid_query" }, { status: 400 });

  const results = searchCities(CITIES, parsed.data, DEFAULT_CITY_LIMIT).map(({ id, name, country }) => ({
    id,
    name,
    country,
  }));
  return NextResponse.json({ results });
}
