import { NextRequest, NextResponse } from "next/server";
import { getScanProgress } from "../scan-state";
import { normalizeRegion, scanKey } from "../../../lib/regions";
export async function GET(request: NextRequest) {
    const rawId = request.nextUrl.searchParams.get("id");
    const id = rawId?.split("#").map((part) => part.trim()).join("#").toLowerCase();
    const region = normalizeRegion(request.nextUrl.searchParams.get("region"));
    if (!region)
        return NextResponse.json({ error: "Unsupported region" }, { status: 400 });
    return NextResponse.json(await getScanProgress(scanKey(region, id ?? "")) ?? { phase: "SEARCHING SUMMONER", completed: 0, total: 0 }, { headers: { "Cache-Control": "no-store" } });
}
