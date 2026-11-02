import { NextRequest, NextResponse } from "next/server";
import { riotJson } from "../../../lib/riot";
import { flashLabel, inventorySlots } from "../../../lib/match-utils";
import { regionForMatchId } from "../../../lib/regions";
type MatchPayload = {
    info: {
        queueId: number;
        gameCreation: number;
        gameDuration: number;
        participants: Array<{
            championName: string;
            riotIdGameName?: string;
            riotIdTagline?: string;
            win: boolean;
            summoner1Id: number;
            summoner2Id: number;
            item0: number;
            item1: number;
            item2: number;
            item3: number;
            item4: number;
            item5: number;
        }>;
    };
};
export async function GET(request: NextRequest) {
    const id = request.nextUrl.searchParams.get("id");
    const region = id ? regionForMatchId(id) : null;
    if (!id || !region || !new RegExp(`^${region.code}_\\d+$`).test(id))
        return NextResponse.json({ error: "Invalid or unsupported match ID" }, { status: 400 });
    try {
        const match = await riotJson<MatchPayload>(`https://${region.routing}.api.riotgames.com/lol/match/v5/matches/${id}`);
        return NextResponse.json({
            id,
            queue: match.info.queueId === 420 ? "SOLO/DUO RANKED" : match.info.queueId === 440 ? "FLEX RANKED" : `QUEUE ${match.info.queueId}`,
            date: new Date(match.info.gameCreation).toISOString(),
            duration: Math.round(match.info.gameDuration / 60),
            players: match.info.participants.map((player) => ({
                champion: player.championName,
                riotId: player.riotIdGameName ? `${player.riotIdGameName}#${player.riotIdTagline ?? ""}` : "Riot ID unavailable",
                championImage: `/riot/img/champion/${player.championName === "FiddleSticks" ? "Fiddlesticks" : player.championName}.png`,
                result: player.win ? "WIN" : "LOSS",
                flash: flashLabel(player),
                items: inventorySlots(player),
            })),
        }, { headers: { "Cache-Control": "no-store" } });
    }
    catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : "Riot request failed" }, { status: 502 });
    }
}
