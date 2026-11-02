import { NextResponse } from "next/server";
import { detectorStats } from "../scan-state";
export async function GET() {
    return NextResponse.json(await detectorStats(), { headers: { "Cache-Control": "no-store, max-age=0" } });
}
