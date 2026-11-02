import { NextRequest, NextResponse } from "next/server";
import { claimScanSlot, incrementDetectedAccounts, scanProgress, setScanProgress } from "../scan-state";
import { riotJson } from "../../../lib/riot";
import runeAssets from "../../../lib/runes.json";
import { flashSlot as slot, flashLabel, flashStats, inventorySlots, normalizeRiotId, seasonSlices } from "../../../lib/match-utils";
import { runs, median, sustainedKdaChange, sustainedWinChange } from "../../../lib/detection-rules";
import { normalizeRegion, REGION_CONFIGS, scanKey, type RegionCode, type RegionConfig } from "../../../lib/regions";
const cache = new Map<string, {
    expires: number;
    value: unknown;
}>();
const matchDetailCache = new Map<string, {
    expires: number;
    value: Match;
}>();
const pendingScans = new Map<string, Promise<NextResponse>>();
type Player = {
    puuid: string;
    teamId: number;
    riotIdGameName?: string;
    riotIdTagline?: string;
    summonerName?: string;
    summoner1Id: number;
    summoner2Id: number;
    win: boolean;
    championName: string;
    teamPosition: string;
    perks: {
        styles: Array<{
            style: number;
            selections: Array<{
                perk: number;
            }>;
        }>;
        statPerks?: {
            offense: number;
            flex: number;
            defense: number;
        };
    };
    challenges?: {
        teamDamagePercentage?: number;
        goldPerMinute?: number;
        visionScorePerMinute?: number;
    };
    item0: number;
    item1: number;
    item2: number;
    item3: number;
    item4: number;
    item5: number;
    kills: number;
    deaths: number;
    assists: number;
};
type Match = {
    metadata: {
        matchId: string;
    };
    info: {
        gameCreation: number;
        gameDuration: number;
        gameVersion: string;
        queueId: number;
        participants: Player[];
    };
};
type GameRow = {
    match: Match;
    player: Player;
    ownerPuuid: string;
};
type InternalGroup = {
    label: string;
    detail: string;
    rows: GameRow[];
};
type InternalEvidence = {
    score: number;
    title: string;
    detail: string;
    date: string;
    gameId: string;
    tone: string;
    comparison?: {
        baseline: InternalGroup;
        changed: InternalGroup;
    };
};
type Slice = {
    label: string;
    start: number;
    end: number;
};
type RiotAccount = {
    puuid: string;
};
type RankedEntry = {
    queueType: string;
    wins: number;
    losses: number;
    tier?: string;
    rank?: string;
    leaguePoints?: number;
};
type HistoricalTier = {
    tier: string;
    lp?: number;
};
type RewindMode = {
    qid?: number;
    g?: number;
};
type RewindYear = {
    stats?: {
        games?: number;
        wins?: number;
        losses?: number;
        modes?: RewindMode[];
    };
};
type RewindArchive = {
    soloGames: number;
    flexGames: number;
    games: number;
};
type RuneAsset = {
    name: string;
    icon: string;
};
type RuneManifest = {
    styles: Record<string, RuneAsset>;
    perks: Record<string, RuneAsset>;
    shards: Record<string, RuneAsset>;
};
const localRunes = runeAssets as RuneManifest;
const shardFallbacks: Record<number, RuneAsset> = {
    5001: { name: "Health Scaling", icon: "/riot/img/rune/shard-5001.png" },
    5002: { name: "Armor", icon: "/riot/img/rune/shard-5002.png" },
    5003: { name: "Magic Resist", icon: "/riot/img/rune/shard-5003.png" },
    5005: { name: "Attack Speed", icon: "/riot/img/rune/shard-5005.png" },
    5007: { name: "Ability Haste", icon: "/riot/img/rune/shard-5007.png" },
    5008: { name: "Adaptive Force", icon: "/riot/img/rune/shard-5008.png" },
    5010: { name: "Move Speed", icon: "/riot/img/rune/shard-5010.png" },
    5011: { name: "Health", icon: "/riot/img/rune/shard-5011.png" },
    5012: { name: "Resist Scaling", icon: "/riot/img/rune/shard-5012.png" },
    5013: { name: "Tenacity and Slow Resist", icon: "/riot/img/rune/shard-5013.png" },
};
const analysisCacheKey = (id: string, region: RegionCode) => `${region}:${id.toLowerCase()}:v34`;
const apiJson = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { "Cache-Control": "no-store, max-age=0" } });
const date = (time: number) => new Date(time).toISOString().slice(0, 10);
function compactId(id: string) {
    return id.replace("#", "-");
}
function decodeHtml(value: string) {
    return value.replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}
async function opggHistoricalTiers(id: string, region: RegionConfig) {
    const response = await fetch(`https://op.gg/lol/summoners/${region.opgg}/${encodeURIComponent(compactId(id))}`, {
        headers: { "User-Agent": "DrewLevin-Detector/1.0 (historical-rank-backfill)" },
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
    });
    if (!response.ok)
        return new Map<string, HistoricalTier>();
    const html = decodeHtml(await response.text());
    const soloStart = html.indexOf("<caption>Ranked Solo/Duo</caption>");
    if (soloStart < 0)
        return new Map<string, HistoricalTier>();
    const soloTable = html.slice(soloStart, html.indexOf("</table>", soloStart) + 8);
    const tiers = new Map<string, HistoricalTier>();
    const rowPattern = /S(20\d{2})(?:\s+S\d)?\s*<\/strong>[\s\S]{0,1500}?<span[^>]*>([^<]+)<\/span>[\s\S]{0,700}?<td[^>]*>(\d+)<\/td>/g;
    for (const match of soloTable.matchAll(rowPattern)) {
        const year = match[1];
        if (!tiers.has(year))
            tiers.set(year, { tier: match[2].trim(), lp: Number(match[3]) });
    }
    return tiers;
}
async function rewindHistoricalRanked(id: string, region: RegionConfig) {
    if (region.code !== "NA1")
        return new Map<string, RewindArchive>();
    for (const profileYear of [2025, 2024]) {
        const url = "https://rewind.lol/" + profileYear + "/get_data/NA/" + encodeURIComponent(id) + "/yoy";
        const response = await fetch(url, {
            headers: { "User-Agent": "DrewLevin-Detector/1.0 (historical-aggregate-backfill)" },
            cache: "no-store",
            signal: AbortSignal.timeout(10000),
        });
        if (!response.ok)
            continue;
        const payload = await response.json() as {
            years?: Record<string, RewindYear>;
        };
        if (!payload.years)
            continue;
        const archive = new Map<string, RewindArchive>();
        for (const [year, value] of Object.entries(payload.years)) {
            if (!/^(2024|2025)$/.test(year))
                continue;
            const modes = value.stats?.modes ?? [];
            const soloGames = modes.filter((mode) => Number(mode.qid) === 420).reduce((sum, mode) => sum + Number(mode.g ?? 0), 0);
            const flexGames = modes.filter((mode) => Number(mode.qid) === 440).reduce((sum, mode) => sum + Number(mode.g ?? 0), 0);
            if (soloGames || flexGames)
                archive.set(year, { soloGames, flexGames, games: soloGames + flexGames });
        }
        if (archive.size)
            return archive;
    }
    return new Map<string, RewindArchive>();
}
async function allIdsForSeason(puuid: string, season: Slice, region: RegionConfig, queue?: string, onPage?: () => void) {
    const ids = new Set<string>();
    const routing = `https://${region.routing}.api.riotgames.com`;
    for (let start = 0;;) {
        const queueParam = queue ? `&queue=${queue}` : "";
        const page: string[] = await riotJson(`${routing}/lol/match/v5/matches/by-puuid/${puuid}/ids?startTime=${season.start}&endTime=${season.end}&start=${start}&count=100${queueParam}`);
        onPage?.();
        if (!Array.isArray(page) || page.some((id) => typeof id !== "string"))
            throw new Error("Invalid match history response");
        if (page.length && page.every((id) => ids.has(id)))
            throw new Error("Match history pagination repeated a page. Retry the scan.");
        page.forEach((id) => ids.add(id));
        if (!page.length)
            break;
        start += page.length;
    }
    const matchIdPattern = new RegExp(`^${region.code}_\\d+$`);
    return [...ids].filter((id) => matchIdPattern.test(id));
}
function rune(player: Player) { return player.perks?.styles?.map((style, index) => { const perks = style.selections.map((item) => item.perk); return `${style.style}:${(index ? perks.sort((a, b) => a - b) : perks).join("-")}`; }).join("/") || "unknown"; }
function runeNames(signature: string) { return signature.split("/").map((tree) => { const [style, perks] = tree.split(":"); return `${styleAsset(Number(style)).name}: ${(perks ?? "").split("-").map((id) => runeAsset(Number(id)).name).join(", ")}`; }).join(" / "); }
function roleName(role: string) { return ({ TOP: "TOP", JUNGLE: "JUNGLE", MIDDLE: "MID", BOTTOM: "ADC", UTILITY: "SUPPORT" } as Record<string, string>)[role] ?? "UNKNOWN"; }
function runeAsset(id: number) { return localRunes.perks[String(id)] ?? { name: `Rune ${id}`, icon: "" }; }
function styleAsset(id: number) { return localRunes.styles[String(id)] ?? { name: "Unknown path", icon: "" }; }
function shardAsset(id: number) { const asset = localRunes.shards[String(id)] ?? shardFallbacks[id]; return { id, name: asset?.name ?? `Stat Shard ${id}`, icon: asset?.icon ?? `/riot/img/rune/shard-${id}.png` }; }
function runeLoadout(player: Player) {
    const [primary, secondary] = player.perks?.styles ?? [];
    return {
        primary: { ...styleAsset(primary?.style ?? 0), selections: (primary?.selections ?? []).map((selection) => runeAsset(selection.perk)) },
        secondary: { ...styleAsset(secondary?.style ?? 0), selections: (secondary?.selections ?? []).map((selection) => runeAsset(selection.perk)) },
        shards: player.perks?.statPerks ? [shardAsset(player.perks.statPerks.offense), shardAsset(player.perks.statPerks.flex), shardAsset(player.perks.statPerks.defense)] : [],
    };
}
function itemSlotProfile(rows: GameRow[], itemId: number) {
    const slots = rows.flatMap(({ player }) => { const items = inventorySlots(player); return items.filter((id) => id === itemId).length === 1 ? [items.indexOf(itemId) + 1] : []; });
    const mode = dominant(slots);
    return { games: slots.length, slot: Number(mode.value), pct: mode.pct };
}
function dominant(values: string[] | number[]) { const tally = new Map<string | number, number>(); values.forEach((value) => tally.set(value, (tally.get(value) ?? 0) + 1)); const [value, count] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0] ?? ["—", 0]; return { value, pct: values.length ? Math.round(count / values.length * 100) : 0 }; }
function patch(match: Match) { return match.info.gameVersion.split(".").slice(0, 2).join("."); }
function winRate(rows: GameRow[]) { return rows.length ? Math.round(rows.filter(({ player }) => player.win).length / rows.length * 100) : 0; }
function kdaValues(rows: GameRow[]) { return rows.map(({ player }) => (player.kills + player.assists) / Math.max(1, player.deaths)); }
function medianKda(rows: GameRow[]) { return Math.round(median(kdaValues(rows)) * 100) / 100; }
function queueName(row: GameRow) { return row.match.info.queueId === 420 ? "SOLO/DUO" : "FLEX"; }
function summary(rows: GameRow[]) { return `${rows.length} reviewed games · ${winRate(rows)}% wins`; }
function comparisonWindows(rows: GameRow[], size: number) {
    const windows: Array<{
        rows: GameRow[];
        priorRows: GameRow[];
        label: string;
    }> = [];
    for (let start = size; start + size <= rows.length; start++) {
        const priorRows = rows.slice(start - size, start), current = rows.slice(start, start + size);
        if (current[current.length - 1].match.info.gameCreation - priorRows[0].match.info.gameCreation > 90 * 86400000)
            continue;
        windows.push({ rows: current, priorRows, label: `${date(current[0].match.info.gameCreation)} → ${date(current[current.length - 1].match.info.gameCreation)}` });
    }
    return windows;
}
async function matchDetail(matchId: string, region: RegionConfig) {
    const cached = matchDetailCache.get(matchId);
    if (cached && cached.expires > Date.now())
        return cached.value;
    const routing = `https://${region.routing}.api.riotgames.com`;
    const value = await riotJson<Match>(`${routing}/lol/match/v5/matches/${matchId}`);
    matchDetailCache.set(matchId, { expires: Date.now() + 24 * 60 * 60000, value });
    return value;
}
function receiptMatch(match: Match, player: Player, ownerPuuid: string, ownerId: string) {
    return {
        gameId: match.metadata.matchId,
        date: new Date(match.info.gameCreation).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC"),
        queue: match.info.queueId === 420 ? "SOLO/DUO" : "FLEX",
        duration: Math.round(match.info.gameDuration / 60),
        flash: flashLabel(player),
        runes: runeLoadout(player),
        role: roleName(player.teamPosition),
        kda: `${player.kills}/${player.deaths}/${player.assists}`,
        players: match.info.participants.map((participant) => ({
            riotId: participant.puuid === ownerPuuid ? ownerId : participant.riotIdGameName ? `${participant.riotIdGameName}${participant.riotIdTagline ? `#${participant.riotIdTagline}` : ""}` : participant.summonerName || "Riot ID unavailable",
            isTarget: participant.puuid === ownerPuuid,
            teamId: participant.teamId,
            champion: participant.championName,
            championImage: `/riot/img/champion/${participant.championName === "FiddleSticks" ? "Fiddlesticks" : participant.championName}.png`,
            result: participant.win ? "WIN" : "LOSS",
            flash: flashLabel(participant),
            kda: `${participant.kills}/${participant.deaths}/${participant.assists}`,
            items: inventorySlots(participant),
        })),
    };
}
export async function GET(request: NextRequest) {
    const id = normalizeRiotId(request.nextUrl.searchParams.get("id"));
    if (!id)
        return apiJson({ error: "Use RiotID#Tag" }, 400);
    const regionCode = normalizeRegion(request.nextUrl.searchParams.get("region"));
    if (!regionCode)
        return apiJson({ error: "Unsupported region" }, 400);
    const region = REGION_CONFIGS[regionCode];
    const key = scanKey(regionCode, id);
    const pending = pendingScans.get(key);
    if (pending)
        return apiJson({ running: true, progress: scanProgress.get(key) }, 202);
    const claim = claimScanSlot(key);
    if (claim.status === "running")
        return apiJson({ running: true, progress: scanProgress.get(key) }, 202);
    if (claim.status === "queued")
        return apiJson({ queued: true, queueAhead: claim.queueAhead, queueSize: claim.queueSize }, 202);
    const task = runClaimedAnalysis(id, region, claim.release);
    pendingScans.set(key, task);
    try {
        return (await task).clone();
    }
    finally {
        if (pendingScans.get(key) === task)
            pendingScans.delete(key);
    }
}
async function runClaimedAnalysis(id: string, region: RegionConfig, release: () => void) {
    try {
        const response = await analyzeRequest(id, region);
        if (response.ok)
            await incrementDetectedAccounts();
        return response;
    }
    finally {
        release();
    }
}
async function analyzeRequest(id: string, region: RegionConfig) {
    const slices = seasonSlices();
    const cacheKey = analysisCacheKey(id, region.code);
    const progressKey = scanKey(region.code, id);
    const routing = `https://${region.routing}.api.riotgames.com`;
    const platform = `https://${region.platform}.api.riotgames.com`;
    const cached = cache.get(cacheKey);
    if (cached && cached.expires > Date.now()) {
        const result = cached.value as {
            analyzedGames: number;
        };
        setScanProgress(progressKey, { phase: "PULLING THE RECEIPTS", completed: result.analyzedGames, total: result.analyzedGames });
        return apiJson(cached.value);
    }
    setScanProgress(progressKey, { phase: "SEARCHING SUMMONER", completed: 0, total: 0 });
    const [gameName, tagLine] = id.split("#");
    if (!gameName || !tagLine)
        return apiJson({ error: "Use gameName#TAG" }, 400);
    try {
        const accountPath = `${routing}/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;
        const account = await riotJson<RiotAccount>(accountPath);
        let preparationCompleted = 1;
        const preparationStep = () => {
            preparationCompleted += 1;
            setScanProgress(progressKey, { phase: "CHECKING MOOD", completed: preparationCompleted, total: 0 });
        };
        setScanProgress(progressKey, { phase: "CHECKING MOOD", completed: preparationCompleted, total: 0 });
        const rankedEntries = await riotJson<RankedEntry[]>(`${platform}/lol/league/v4/entries/by-puuid/${account.puuid}`);
        preparationStep();
        const soloEntry: RankedEntry = rankedEntries.find((entry) => entry.queueType === "RANKED_SOLO_5x5") ?? { queueType: "RANKED_SOLO_5x5", wins: 0, losses: 0 };
        const flexEntry: RankedEntry = rankedEntries.find((entry) => entry.queueType === "RANKED_FLEX_SR") ?? { queueType: "RANKED_FLEX_SR", wins: 0, losses: 0 };
        const [historicalTiers, rewindArchive, idsBySeason] = await Promise.all([
            opggHistoricalTiers(id, region).catch(() => new Map<string, HistoricalTier>()).finally(preparationStep),
            rewindHistoricalRanked(id, region).catch(() => new Map<string, RewindArchive>()).finally(preparationStep),
            Promise.all(slices.map(async (season) => {
                const [soloIds, flexIds] = await Promise.all([
                    allIdsForSeason(account.puuid, season, region, "420", preparationStep),
                    allIdsForSeason(account.puuid, season, region, "440", preparationStep),
                ]);
                return { season, soloIds, flexIds, ids: [...new Set([...soloIds, ...flexIds])] };
            }))
        ]);
        const detailIds = [...new Set(idsBySeason.flatMap(({ ids }) => ids))];
        let completed = 0;
        setScanProgress(progressKey, { phase: "REVIEWING", completed, total: detailIds.length });
        const targetGameName = gameName.trim().toLocaleLowerCase();
        const targetTagLine = tagLine.trim().toLocaleLowerCase();
        const findOwner = (match: Match) => {
            return match.info.participants.find((participant) => participant.puuid === account.puuid)
                ?? match.info.participants.find((participant) => participant.riotIdGameName?.trim().toLocaleLowerCase() === targetGameName
                    && participant.riotIdTagline?.trim().toLocaleLowerCase() === targetTagLine)
                ?? match.info.participants.find((participant) => participant.summonerName?.trim().toLocaleLowerCase() === targetGameName);
        };
        const matches: GameRow[] = [];
        for (const matchId of detailIds) {
            try {
                const match = await matchDetail(matchId, region);
                const player = findOwner(match);
                if (!player) {
                    console.warn(`Skipped unreadable target participant in ${matchId}`);
                    continue;
                }
                matches.push({ match, player, ownerPuuid: player.puuid });
            }
            finally {
                completed += 1;
                setScanProgress(progressKey, { phase: "REVIEWING", completed, total: detailIds.length });
            }
        }
        const games = matches
            .filter(({ match }) => [420, 440].includes(match.info.queueId) && slices.some((season) => match.info.gameCreation / 1000 >= season.start && match.info.gameCreation / 1000 < season.end))
            .sort((a, b) => a.match.info.gameCreation - b.match.info.gameCreation || a.match.metadata.matchId.localeCompare(b.match.metadata.matchId));
        if (!games.length)
            throw new Error(`No readable ${region.label} Solo/Duo or Flex matches found for this account.`);
        const seasons = slices.map(({ label }) => {
            const season = slices.find((item) => item.label === label)!;
            const rows = games.filter(({ match }) => match.info.gameCreation / 1000 >= season.start && match.info.gameCreation / 1000 < season.end);
            const allSeasonIds = idsBySeason.find((item) => item.season.label === label);
            const isCurrentSeason = label === slices[slices.length - 1].label;
            const hasRawIds = (allSeasonIds?.ids.length ?? 0) > 0;
            const archive = rewindArchive.get(label);
            const rawSoloGames = allSeasonIds?.soloIds.length ?? 0;
            const rawFlexGames = allSeasonIds?.flexIds.length ?? 0;
            const currentSplitSoloGames = soloEntry.wins + soloEntry.losses;
            const currentSplitFlexGames = flexEntry.wins + flexEntry.losses;
            const soloGames = Math.max(rawSoloGames, archive?.soloGames ?? 0, isCurrentSeason ? currentSplitSoloGames : 0);
            const flexGames = Math.max(rawFlexGames, archive?.flexGames ?? 0, isCurrentSeason ? currentSplitFlexGames : 0);
            const totalGames = soloGames + flexGames;
            const flash = dominant(rows.map(({ player }) => slot(player)).filter(Boolean));
            const flashDistribution = flashStats(rows.map(({ player }) => player));
            const runes = dominant(rows.map(({ player }) => rune(player)));
            const roles = dominant(rows.map(({ player }) => roleName(player.teamPosition)));
            const kda = rows.length ? Math.round(rows.reduce((sum, { player }) => sum + (player.kills + player.assists) / Math.max(1, player.deaths), 0) / rows.length * 100) / 100 : 0;
            const archiveTier = historicalTiers.get(label);
            const currentTier = soloEntry.tier ? `${soloEntry.tier[0]}${soloEntry.tier.slice(1).toLowerCase()}${soloEntry.rank ? ` ${soloEntry.rank}` : ""}${typeof soloEntry.leaguePoints === "number" ? ` ${soloEntry.leaguePoints} LP` : ""}` : undefined;
            return { label, games: totalGames, soloGames, flexGames, soloWins: isCurrentSeason ? soloEntry.wins : undefined, soloLosses: isCurrentSeason ? soloEntry.losses : undefined, flexWins: isCurrentSeason ? flexEntry.wins : undefined, flexLosses: isCurrentSeason ? flexEntry.losses : undefined, archivedTier: isCurrentSeason ? currentTier : archiveTier ? `${archiveTier.tier}${typeof archiveTier.lp === "number" ? ` ${archiveTier.lp} LP` : ""}` : undefined, recordAvailability: hasRawIds ? "available" : totalGames ? "archive" : "expired", analyzedGames: rows.length, winRate: winRate(rows), flashSlot: flash.value, flashPct: flash.pct, ...flashDistribution, primaryRune: runes.value, role: roles.value, champions: new Set(rows.map(({ player }) => player.championName)).size, kda };
        });
        const evidence: InternalEvidence[] = [];
        type TimelineProfile = {
            label: string;
            queue: number;
            flashSlot: string | number;
            flashPct: number;
            role: string;
        };
        type FlashPair = {
            previous: TimelineProfile;
            current: TimelineProfile;
            oldRows: GameRow[];
            newRows: GameRow[];
        };
        const flashPairs: FlashPair[] = [];
        const flashProfile = (rows: GameRow[]): TimelineProfile => ({ label: `${date(rows[0].match.info.gameCreation)} → ${date(rows[rows.length - 1].match.info.gameCreation)} · ${[...new Set(rows.map(queueName))].join(" + ")}`, queue: rows[0].match.info.queueId, flashSlot: slot(rows[0].player), flashPct: 100, role: "" });
        const seenFlashChanges = new Set<string>();
        for (const rows of [games, ...[420, 440].map((queue) => games.filter(({ match }) => match.info.queueId === queue))]) {
            const flashRuns = runs(rows.filter(({ player }) => slot(player)), ({ player }) => slot(player));
            for (let index = 1; index < flashRuns.length; index++) {
                const previous = flashRuns[index - 1], current = flashRuns[index];
                if (previous.rows.length < 5 && current.rows.length < 5 && !(index >= 2 && flashRuns[index - 2].rows.length >= 5))
                    continue;
                const key = `${previous.rows.at(-1)!.match.metadata.matchId}:${current.rows[0].match.metadata.matchId}`;
                if (seenFlashChanges.has(key))
                    continue;
                seenFlashChanges.add(key);
                flashPairs.push({ previous: flashProfile(previous.rows), current: flashProfile(current.rows), oldRows: previous.rows, newRows: current.rows });
            }
        }
        const alternatingFlashGroups = [420, 440].flatMap((queue) => {
            const rows = games.filter(({ match, player }) => match.info.queueId === queue && slot(player));
            const segments = runs(rows, ({ player }) => slot(player));
            const dRows = rows.filter(({ player }) => slot(player) === 1), fRows = rows.filter(({ player }) => slot(player) === 2);
            return segments.length >= 5 && dRows.length >= 3 && fRows.length >= 3 ? [{ dRows, fRows, switches: segments.length - 1 }] : [];
        });
        const allFlashPairs = flashPairs;
        const queueFlashCandidates = games.flatMap((anchor) => {
            const start = anchor.match.info.gameCreation, end = start + 45 * 86400000;
            const window = games.filter(({ match, player }) => match.info.gameCreation >= start && match.info.gameCreation <= end && slot(player));
            const soloRows = window.filter(({ match }) => match.info.queueId === 420);
            const flexRows = window.filter(({ match }) => match.info.queueId === 440);
            if (soloRows.length < 5 || flexRows.length < 5)
                return [];
            const solo = dominant(soloRows.map(({ player }) => slot(player))), flex = dominant(flexRows.map(({ player }) => slot(player)));
            if (solo.value === flex.value || solo.pct < 80 || flex.pct < 80)
                return [];
            return [{ soloRows, flexRows, solo, flex, support: Math.min(soloRows.length, flexRows.length) }];
        }).sort((a, b) => b.support - a.support);
        const queueFlashSplit = queueFlashCandidates[0];
        const itemSlotCandidates: Array<{
            champion: string;
            itemId: number;
            oldSlot: number;
            newSlot: number;
            oldPct: number;
            newPct: number;
            oldRows: GameRow[];
            newRows: GameRow[];
            crossQueue?: boolean;
        }> = [];
        const championRows = new Map<string, GameRow[]>();
        games.forEach((row) => { const key = row.player.championName; championRows.set(key, [...(championRows.get(key) ?? []), row]); });
        for (const rows of championRows.values()) {
            const champion = rows[0].player.championName;
            const itemIds = [...new Set(rows.flatMap(({ player }) => inventorySlots(player)).filter(Boolean))];
            for (const itemId of itemIds) {
                const observed = rows.filter(({ player }) => inventorySlots(player).filter((id) => id === itemId).length === 1);
                const itemRuns = runs(observed, ({ player }) => inventorySlots(player).indexOf(itemId) + 1);
                for (let index = 1; index < itemRuns.length; index++) {
                    const before = itemRuns[index - 1], after = itemRuns[index];
                    const boundary = after.rows[0].match.info.gameCreation;
                    const oldRows = before.rows.filter(({ match }) => boundary - match.info.gameCreation <= 45 * 86400000);
                    const newRows = after.rows.filter(({ match }) => match.info.gameCreation - boundary <= 45 * 86400000);
                    if (oldRows.length >= 3 && newRows.length >= 3)
                        itemSlotCandidates.push({ champion, itemId, oldSlot: Number(before.key), newSlot: Number(after.key), oldPct: 100, newPct: 100, oldRows, newRows });
                }
                for (const anchor of observed) {
                    const start = anchor.match.info.gameCreation;
                    const window = observed.filter(({ match }) => match.info.gameCreation >= start && match.info.gameCreation <= start + 45 * 86400000);
                    const oldRows = window.filter(({ match }) => match.info.queueId === 420), newRows = window.filter(({ match }) => match.info.queueId === 440);
                    const before = itemSlotProfile(oldRows, itemId), after = itemSlotProfile(newRows, itemId);
                    if (before.games >= 3 && after.games >= 3 && before.pct >= 80 && after.pct >= 80 && before.slot !== after.slot)
                        itemSlotCandidates.push({ champion, itemId, oldSlot: before.slot, newSlot: after.slot, oldPct: before.pct, newPct: after.pct, oldRows, newRows, crossQueue: true });
                }
            }
        }
        const allSoloRows = games.filter(({ match }) => match.info.queueId === 420);
        const roleCandidates = comparisonWindows(allSoloRows, 10).flatMap(({ rows, priorRows, label }) => {
            const previous = dominant(priorRows.map((row) => roleName(row.player.teamPosition)));
            const current = dominant(rows.map((row) => roleName(row.player.teamPosition)));
            if (previous.value === current.value || previous.value === "UNKNOWN" || current.value === "UNKNOWN" || previous.pct < 80 || current.pct < 80)
                return [];
            const oldRows = priorRows.filter((row) => roleName(row.player.teamPosition) === previous.value);
            const newRows = rows.filter((row) => roleName(row.player.teamPosition) === current.value);
            return [{ previous: { role: previous.value, label: `${date(priorRows[0].match.info.gameCreation)} → ${date(priorRows[priorRows.length - 1].match.info.gameCreation)}` }, current: { role: current.value, label }, oldRows, newRows }];
        });
        const performanceBlocks = comparisonWindows(allSoloRows, 20).map((window) => ({ ...window, winDelta: winRate(window.rows) - winRate(window.priorRows) }));
        const winRateShift = performanceBlocks.filter(({ rows, priorRows }) => sustainedWinChange(priorRows.map(({ player }) => player.win), rows.map(({ player }) => player.win), performanceBlocks.length)).sort((a, b) => Math.abs(b.winDelta) - Math.abs(a.winDelta))[0];
        const kdaGroups = new Map<string, GameRow[]>();
        for (const row of games) {
            const key = `${row.match.info.queueId}:${row.player.championName}:${roleName(row.player.teamPosition)}`;
            kdaGroups.set(key, [...(kdaGroups.get(key) ?? []), row]);
        }
        const kdaShift = [...kdaGroups.values()].flatMap((rows) => comparisonWindows(rows, 8)).filter(({ rows, priorRows }) => sustainedKdaChange(kdaValues(priorRows), kdaValues(rows))).map((window) => ({ ...window, kdaDelta: medianKda(window.rows) - medianKda(window.priorRows) })).sort((a, b) => Math.abs(b.kdaDelta) - Math.abs(a.kdaDelta))[0];
        const runeCandidates: Array<{
            patch: string;
            base: string;
            alt: string;
            baseRows: GameRow[];
            altRows: GameRow[];
        }> = [];
        const byPatch = new Map<string, GameRow[]>();
        games.forEach((row) => { const key = `${row.match.info.queueId}:${patch(row.match)}:${row.player.championName}:${roleName(row.player.teamPosition)}`; byPatch.set(key, [...(byPatch.get(key) ?? []), row]); });
        for (const rows of byPatch.values()) {
            const patchLabel = patch(rows[0].match);
            const segments = runs(rows, ({ player }) => rune(player));
            for (let index = 1; index + 1 < segments.length; index++) {
                const early = segments[index - 1], middle = segments[index], late = segments[index + 1];
                if (early.key === "unknown" || middle.key === "unknown" || early.key !== late.key || early.rows.length < 3 || middle.rows.length < 3 || late.rows.length < 3)
                    continue;
                const baseRows = [...early.rows, ...late.rows];
                const performanceLoop = sustainedKdaChange(kdaValues(early.rows), kdaValues(middle.rows)) && sustainedKdaChange(kdaValues(late.rows), kdaValues(middle.rows)) && medianKda(middle.rows) > Math.max(medianKda(early.rows), medianKda(late.rows));
                const resultsLoop = rows[0].match.info.queueId === 420 && winRate(early.rows) <= 50 && winRate(middle.rows) >= 67 && winRate(late.rows) <= 50;
                if (performanceLoop || resultsLoop)
                    runeCandidates.push({ patch: patchLabel, base: String(early.key), alt: String(middle.key), baseRows, altRows: middle.rows });
            }
        }
        const fullTimelineBreakouts = comparisonWindows(allSoloRows, 20).flatMap(({ rows, priorRows }) => {
            return [...new Set(rows.map(({ player }) => player.championName))].map((champion) => {
                const championRows = rows.filter(({ player }) => player.championName === champion);
                const earlierChampionRows = priorRows.filter(({ player }) => player.championName === champion);
                const blockShare = championRows.length / rows.length;
                const historicalShare = earlierChampionRows.length / Math.max(1, priorRows.length);
                return { champion, championRows, earlierChampionRows, priorRows, blockShare, historicalShare, label: `${date(rows[0].match.info.gameCreation)} → ${date(rows[rows.length - 1].match.info.gameCreation)}` };
            }).filter(({ championRows, priorRows, blockShare, historicalShare }) => championRows.length >= 5 && blockShare >= 0.25 && blockShare >= Math.max(0.12, historicalShare * 3) && winRate(championRows) >= Math.max(65, winRate(priorRows) + 15) && Boolean(winRateShift && championRows.some((row) => winRateShift.rows.includes(row))));
        }).sort((a, b) => (b.blockShare - b.historicalShare) - (a.blockShare - a.historicalShare));
        const strongestBreakout = fullTimelineBreakouts[0];
        const strongestItemSlotCandidates = [...new Map(itemSlotCandidates.sort((a, b) => (a.oldRows.length + a.newRows.length) - (b.oldRows.length + b.newRows.length)).map((candidate) => [`${candidate.champion}:${candidate.itemId}:${candidate.oldSlot}:${candidate.newSlot}:${candidate.crossQueue ? "queues" : candidate.newRows[0].match.metadata.matchId}`, candidate])).values()].sort((a, b) => (b.oldPct + b.newPct) - (a.oldPct + a.newPct));
        const habitSupport = allFlashPairs.length > 0 || alternatingFlashGroups.length > 0 || Boolean(queueFlashSplit) || strongestItemSlotCandidates.length > 0;
        for (const candidate of strongestItemSlotCandidates) {
            const oldItemRows = candidate.oldRows.filter(({ player }) => inventorySlots(player)[candidate.oldSlot - 1] === candidate.itemId && inventorySlots(player).filter((id) => id === candidate.itemId).length === 1);
            const newItemRows = candidate.newRows.filter(({ player }) => inventorySlots(player)[candidate.newSlot - 1] === candidate.itemId && inventorySlots(player).filter((id) => id === candidate.itemId).length === 1);
            evidence.push({ score: 38, title: "SAME-CHAMPION ITEM SLOT REGIME CHANGE", detail: `${candidate.champion}: Item ${candidate.itemId} occupies slot ${candidate.oldSlot} (${candidate.oldPct}%) ${candidate.crossQueue ? "in Solo/Duo" : "before the switch"} and slot ${candidate.newSlot} (${candidate.newPct}%) ${candidate.crossQueue ? "in Flex during the same period" : "after the switch"}.`, date: date(newItemRows[0].match.info.gameCreation), gameId: newItemRows[0].match.metadata.matchId, tone: "warm", comparison: { baseline: { label: `${candidate.crossQueue ? "SOLO/DUO · " : ""}${candidate.champion} · ITEM ${candidate.itemId} · SLOT ${candidate.oldSlot} · ${candidate.oldPct}%`, detail: `${summary(oldItemRows)} · exact matching games`, rows: oldItemRows }, changed: { label: `${candidate.crossQueue ? "FLEX · " : ""}${candidate.champion} · ITEM ${candidate.itemId} · SLOT ${candidate.newSlot} · ${candidate.newPct}%`, detail: `${summary(newItemRows)} · exact matching games`, rows: newItemRows } } });
        }
        if (winRateShift)
            evidence.push({ score: 35, title: "WIN-RATE REGIME CHANGE", detail: `Solo/Duo, ${winRateShift.label}: ${winRate(winRateShift.rows)}% wins across ${winRateShift.rows.length} games versus ${winRate(winRateShift.priorRows)}% in the preceding ${winRateShift.priorRows.length} games.`, date: date(winRateShift.rows[0].match.info.gameCreation), gameId: winRateShift.rows[0].match.metadata.matchId, tone: "warm", comparison: { baseline: { label: "PRECEDING SOLO/DUO GAMES", detail: summary(winRateShift.priorRows), rows: winRateShift.priorRows }, changed: { label: `${winRateShift.label} · ${winRate(winRateShift.rows)}% WINS`, detail: summary(winRateShift.rows), rows: winRateShift.rows } } });
        if (kdaShift)
            evidence.push({ score: 35, title: "KDA REGIME CHANGE", detail: `${queueName(kdaShift.rows[0])} · ${kdaShift.rows[0].player.championName} · ${roleName(kdaShift.rows[0].player.teamPosition)}, ${kdaShift.label}: median KDA ${medianKda(kdaShift.priorRows)} → ${medianKda(kdaShift.rows)}. Both groups use the same champion, role and queue.`, date: date(kdaShift.rows[0].match.info.gameCreation), gameId: kdaShift.rows[0].match.metadata.matchId, tone: "warm", comparison: { baseline: { label: "PRECEDING COMPARABLE GAMES", detail: `${summary(kdaShift.priorRows)} · ${medianKda(kdaShift.priorRows)} median KDA`, rows: kdaShift.priorRows }, changed: { label: `${kdaShift.label} · ${medianKda(kdaShift.rows)} MEDIAN KDA`, detail: summary(kdaShift.rows), rows: kdaShift.rows } } });
        if (strongestBreakout && habitSupport) {
            const breakout = strongestBreakout;
            evidence.push({ score: 35, title: "SOLO/DUO CHAMPION BREAKOUT", detail: `${breakout.champion} rises from ${Math.round(breakout.historicalShare * 100)}% of the preceding Solo/Duo window to ${Math.round(breakout.blockShare * 100)}% in ${breakout.label}, with ${winRate(breakout.championRows)}% wins. These games overlap the win-rate change shown in the receipts.`, date: date(breakout.championRows[0].match.info.gameCreation), gameId: breakout.championRows[0].match.metadata.matchId, tone: "warm", comparison: { baseline: { label: "PRECEDING SOLO/DUO WINDOW", detail: summary(breakout.priorRows), rows: breakout.priorRows }, changed: { label: `${breakout.label} · ${breakout.champion}`, detail: summary(breakout.championRows), rows: breakout.championRows } } });
        }
        for (const candidate of runeCandidates) {
            const before = candidate.baseRows.filter(({ match }) => match.info.gameCreation < candidate.altRows[0].match.info.gameCreation);
            const returned = candidate.baseRows.filter(({ match }) => match.info.gameCreation > candidate.altRows.at(-1)!.match.info.gameCreation);
            evidence.push({ score: 35, title: "SAME-PATCH RUNE PERFORMANCE LOOP", detail: `${queueName(candidate.altRows[0])} · ${candidate.altRows[0].player.championName}, patch ${candidate.patch}: ${runeNames(candidate.base)} → ${runeNames(candidate.alt)} → original setup. Median KDA: ${medianKda(before)} → ${medianKda(candidate.altRows)} → ${medianKda(returned)}.${candidate.altRows[0].match.info.queueId === 420 ? ` Wins: ${winRate(before)}% → ${winRate(candidate.altRows)}% → ${winRate(returned)}%.` : ""}`, date: date(candidate.altRows[0].match.info.gameCreation), gameId: candidate.altRows[0].match.metadata.matchId, tone: "warm", comparison: { baseline: { label: `${candidate.patch} · BEFORE + RETURN`, detail: `${runeNames(candidate.base)} · before: ${before.length} games, ${medianKda(before)} median KDA · return: ${returned.length} games, ${medianKda(returned)} median KDA`, rows: candidate.baseRows }, changed: { label: `${candidate.patch} · HIGH-PERFORMANCE BLOCK`, detail: `${runeNames(candidate.alt)} · ${candidate.altRows.length} games, ${medianKda(candidate.altRows)} median KDA`, rows: candidate.altRows } } });
        }
        for (const candidate of [...new Map(roleCandidates.map((candidate) => [`${candidate.previous.role}:${candidate.current.role}`, candidate])).values()])
            evidence.push({ score: 12, title: "ROLE HABIT SHIFT", detail: `Solo/Duo: ${candidate.previous.role} → ${candidate.current.role}.`, date: date(candidate.newRows[0].match.info.gameCreation), gameId: candidate.newRows[0].match.metadata.matchId, tone: "warm", comparison: { baseline: { label: `${candidate.previous.label} · ${candidate.previous.role}`, detail: summary(candidate.oldRows), rows: candidate.oldRows }, changed: { label: `${candidate.current.label} · ${candidate.current.role}`, detail: summary(candidate.newRows), rows: candidate.newRows } } });
        if (alternatingFlashGroups.length) {
            const dRows = games.filter(({ player }) => slot(player) === 1);
            const fRows = games.filter(({ player }) => slot(player) === 2);
            const allFlashRows = [...dRows, ...fRows].sort((a, b) => a.match.info.gameCreation - b.match.info.gameCreation);
            const queueBreakdown = [420, 440].map((queue) => {
                const rows = allFlashRows.filter(({ match }) => match.info.queueId === queue);
                const d = rows.filter(({ player }) => slot(player) === 1).length;
                const f = rows.filter(({ player }) => slot(player) === 2).length;
                return rows.length ? `${queue === 420 ? "Solo/Duo" : "Flex"}: ${d} D / ${f} F` : "";
            }).filter(Boolean).join(" · ");
            const switches = alternatingFlashGroups.reduce((sum, group) => sum + group.switches, 0);
            evidence.push({
                score: 92,
                title: "REPEATED FLASH SLOT SWITCHES",
                detail: `${switches} repeated Flash D/F switches across the account timeline${queueBreakdown ? ` · ${queueBreakdown}` : ""}. Every reviewed Flash game is listed below.`,
                date: date(allFlashRows.at(-1)!.match.info.gameCreation),
                gameId: allFlashRows.at(-1)!.match.metadata.matchId,
                tone: "hot",
                comparison: {
                    baseline: { label: "ALL QUEUES · FLASH D", detail: `${dRows.length} games`, rows: dRows },
                    changed: { label: "ALL QUEUES · FLASH F", detail: `${fRows.length} games`, rows: fRows },
                },
            });
        }
        else {
            for (const pair of flashPairs) {
                evidence.push({
                    score: 92,
                    title: "FLASH SLOT REGIME CHANGE",
                    detail: `${pair.previous.label}: ${pair.oldRows.length} games with Flash ${pair.previous.flashSlot === 1 ? "D" : "F"} → ${pair.current.label}: ${pair.newRows.length} games with Flash ${pair.current.flashSlot === 1 ? "D" : "F"}. Every game in both runs is listed below.`,
                    date: date(pair.newRows[0].match.info.gameCreation),
                    gameId: pair.newRows[0].match.metadata.matchId,
                    tone: "hot",
                    comparison: {
                        baseline: { label: `${pair.previous.label} · FLASH ${pair.previous.flashSlot === 1 ? "D" : "F"}`, detail: `${summary(pair.oldRows)} · earlier run`, rows: pair.oldRows },
                        changed: { label: `${pair.current.label} · FLASH ${pair.current.flashSlot === 1 ? "D" : "F"}`, detail: `${summary(pair.newRows)} · later run`, rows: pair.newRows },
                    },
                });
            }
        }
        if (queueFlashSplit) {
            const { soloRows, flexRows, solo, flex } = queueFlashSplit;
            const dOrF = (value: string | number) => value === 1 ? "D" : "F";
            const period = [...soloRows, ...flexRows].sort((a, b) => a.match.info.gameCreation - b.match.info.gameCreation);
            evidence.push({ score: 92, title: "CROSS-QUEUE FLASH HABIT SPLIT", detail: `${date(period[0].match.info.gameCreation)} → ${date(period[period.length - 1].match.info.gameCreation)}: Solo/Duo uses Flash ${dOrF(solo.value)} (${solo.pct}%) while Flex uses Flash ${dOrF(flex.value)} (${flex.pct}%).`, date: date(period[0].match.info.gameCreation), gameId: period[0].match.metadata.matchId, tone: "hot", comparison: {
                    baseline: { label: `SOLO/DUO · FLASH ${dOrF(solo.value)} · ${solo.pct}%`, detail: `${soloRows.length} games with Flash · every game in the compared period`, rows: soloRows },
                    changed: { label: `FLEX · FLASH ${dOrF(flex.value)} · ${flex.pct}%`, detail: `${flexRows.length} games with Flash · every game in the compared period`, rows: flexRows },
                } });
        }
        if (!evidence.length && games.length) {
            const row = games[games.length - 1];
            evidence.push({ score: 8, title: "NO CLOSED EVIDENCE LOOP FOUND", detail: "No qualifying habit or performance changes found in the reviewed games.", date: date(row.match.info.gameCreation), gameId: row.match.metadata.matchId, tone: "warm", comparison: { baseline: { label: "REVIEWED MATCHES", detail: summary(games), rows: games }, changed: { label: "QUALIFYING CHANGES", detail: "None found", rows: [] } } });
        }
        const hasFlashReversal = evidence.some((item) => item.title === "FLASH SLOT REGIME CHANGE" || item.title === "CROSS-QUEUE FLASH HABIT SPLIT" || item.title === "REPEATED FLASH SLOT SWITCHES");
        const hasItemSlotReversal = evidence.some((item) => item.title === "SAME-CHAMPION ITEM SLOT REGIME CHANGE");
        const hasRuneIssue = evidence.some((item) => item.title === "SAME-PATCH RUNE PERFORMANCE LOOP");
        const hasWinRateIssue = evidence.some((item) => item.title === "WIN-RATE REGIME CHANGE");
        const hasKdaIssue = evidence.some((item) => item.title === "KDA REGIME CHANGE");
        const hasOtherSignal = evidence.some((item) => item.title !== "NO CLOSED EVIDENCE LOOP FOUND");
        const score = hasFlashReversal ? 88 : hasItemSlotReversal || hasRuneIssue || hasWinRateIssue || hasKdaIssue ? 38 : hasOtherSignal ? 22 : 8;
        const fullEvidence = evidence.sort((a, b) => b.score - a.score || b.date.localeCompare(a.date) || b.gameId.localeCompare(a.gameId)).map((item, index) => {
            if (!item.comparison)
                return item;
            const { rows: baselineRows, ...baseline } = item.comparison.baseline, { rows: changedRows, ...changed } = item.comparison.changed;
            return { ...item, id: `${item.gameId}:${index}`, comparison: { baseline: { ...baseline, matches: baselineRows.map(({ match, player, ownerPuuid }) => receiptMatch(match, player, ownerPuuid, id)) }, changed: { ...changed, matches: changedRows.map(({ match, player, ownerPuuid }) => receiptMatch(match, player, ownerPuuid, id)) } } };
        });
        setScanProgress(progressKey, { phase: "PULLING THE RECEIPTS", completed: detailIds.length, total: detailIds.length });
        const reportedGames = seasons.reduce((sum, season) => sum + season.games, 0);
        const value = { id, region: region.code, score, games: reportedGames, analyzedGames: games.length, coverage: { reportedGames, matchesAvailable: detailIds.length, matchesAnalyzed: games.length }, wins: soloEntry.wins, ranked: { solo: soloEntry, flex: flexEntry }, seasons, evidence: fullEvidence, flash: { changed: hasFlashReversal, oldSlot: seasons[0]?.flashSlot ?? "—", oldPct: seasons[0]?.flashPct ?? 0, newSlot: seasons[2]?.flashSlot ?? "—", newPct: seasons[2]?.flashPct ?? 0 } };
        cache.set(cacheKey, { expires: Date.now() + 15 * 60000, value });
        return apiJson(value);
    }
    catch (error) {
        setScanProgress(progressKey, { phase: "FAILED", completed: 0, total: 0 });
        return apiJson({ error: error instanceof Error ? error.message : "Analysis failed" }, 502);
    }
}
