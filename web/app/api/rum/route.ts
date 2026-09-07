import { NextResponse } from "next/server";

type RumPayload = {
  name?: unknown;
  value?: unknown;
  id?: unknown;
  rating?: unknown;
  navigationType?: unknown;
  attribution?: unknown;
};

export async function POST(request: Request) {
  let payload: RumPayload;
  try {
    // Parse the text explicitly so an empty beacon body is handled locally
    // without relying on the framework's request.json() parser.
    const text = await request.text();
    if (!text.trim()) throw new Error("empty payload");
    payload = JSON.parse(text) as RumPayload;
  } catch {
    return NextResponse.json({ message: "Invalid RUM payload" }, { status: 400 });
  }

  if (typeof payload.name !== "string" || typeof payload.value !== "number" || !Number.isFinite(payload.value)) {
    return NextResponse.json({ message: "Invalid RUM metric" }, { status: 400 });
  }

  if (process.env.RUM_LOG_METRICS === "true") {
    console.info("[rum]", JSON.stringify({
      name: payload.name,
      value: payload.value,
      id: typeof payload.id === "string" ? payload.id : undefined,
      rating: typeof payload.rating === "string" ? payload.rating : undefined,
      navigationType: typeof payload.navigationType === "string" ? payload.navigationType : undefined,
      attribution: payload.attribution,
    }));
  }
  return new NextResponse(null, { status: 204 });
}
