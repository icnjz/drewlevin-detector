"use client";
import { FormEvent, useEffect, useRef, useState } from "react";
import runeManifestData from "../lib/runes.json";
import { normalizeRiotId } from "../lib/match-utils";
import { REGION_CONFIGS, REGION_OPTIONS, type RegionCode } from "../lib/regions";
type Rune = {
    name: string;
    icon: string;
};
type RuneShard = {
    id: number;
    name: string;
    icon: string;
};
type RuneLoadout = {
    primary: {
        name: string;
        icon: string;
        selections: Rune[];
    };
    secondary: {
        name: string;
        icon: string;
        selections: Rune[];
    };
    shards: RuneShard[];
};
type RuneTreeSlot = {
    runes: Array<Rune & {
        id: number;
    }>;
};
type RuneStyleManifest = {
    name: string;
    icon: string;
    slots: RuneTreeSlot[];
};
type RuneManifest = {
    styles: Record<string, RuneStyleManifest>;
    shards: Record<string, Rune>;
};
type ReceiptMatch = {
    gameId: string;
    date: string;
    queue: string;
    duration: number;
    flash: string;
    runes?: RuneLoadout;
    role: string;
    kda: string;
    players: Array<{
        riotId: string;
        isTarget: boolean;
        teamId: number;
        champion: string;
        championImage: string;
        result: string;
        flash: string;
        kda: string;
        items: number[];
    }>;
};
type EvidenceGroup = {
    label: string;
    detail: string;
    matches: ReceiptMatch[];
};
type Evidence = {
    id: string;
    score: number;
    title: string;
    detail: string;
    date: string;
    gameId: string;
    comparison?: {
        baseline: EvidenceGroup;
        changed: EvidenceGroup;
    };
    tone: string;
};
type Season = {
    label: string;
    games: number;
    analyzedGames: number;
    soloGames: number;
    flexGames: number;
    soloWins?: number;
    soloLosses?: number;
    flexWins?: number;
    flexLosses?: number;
    archivedTier?: string;
    recordAvailability: "available" | "archive" | "expired";
    winRate: number;
    flashSlot: string | number;
    flashPct: number;
    flashD?: number;
    flashF?: number;
    flashGames: number;
    flashDCount: number;
    flashFCount: number;
    champions: number;
};
type Analysis = {
    id: string;
    region: RegionCode;
    games: number;
    analyzedGames: number;
    coverage: {
        reportedGames: number;
        matchesAvailable: number;
        matchesAnalyzed: number;
    };
    wins: number;
    ranked: {
        solo: {
            wins: number;
            losses: number;
        };
        flex: {
            wins: number;
            losses: number;
        };
    };
    score: number;
    seasons: Season[];
    evidence: Evidence[];
    flash: {
        changed: boolean;
        oldSlot: string | number;
        oldPct: number;
        newSlot: string | number;
        newPct: number;
    };
};
type ScanProgress = {
    phase: "QUEUED" | "SEARCHING SUMMONER" | "CHECKING MOOD" | "REVIEWING" | "PULLING THE RECEIPTS" | "FAILED";
    completed: number;
    total: number;
    queueAhead?: number;
    queueSize?: number;
};
type DetectorStats = {
    detectedAccounts: number;
    queueSize: number;
    activeScans: number;
};
const LOW_SCORE_PREVIEW: Analysis = {
    id: "Preview#LOW",
    region: "NA1",
    games: 84,
    analyzedGames: 84,
    coverage: { reportedGames: 84, matchesAvailable: 84, matchesAnalyzed: 84 },
    wins: 22,
    ranked: { solo: { wins: 22, losses: 21 }, flex: { wins: 19, losses: 22 } },
    score: 35,
    seasons: [
        { label: "2024", games: 24, analyzedGames: 24, soloGames: 14, flexGames: 10, recordAvailability: "available", winRate: 50, flashSlot: 1, flashPct: 100, flashD: 100, flashF: 0, flashGames: 24, flashDCount: 24, flashFCount: 0, champions: 9 },
        { label: "2025", games: 31, analyzedGames: 31, soloGames: 17, flexGames: 14, recordAvailability: "available", winRate: 52, flashSlot: 1, flashPct: 100, flashD: 100, flashF: 0, flashGames: 31, flashDCount: 31, flashFCount: 0, champions: 11 },
        { label: "2026", games: 29, analyzedGames: 29, soloGames: 12, flexGames: 17, recordAvailability: "available", winRate: 49, flashSlot: 1, flashPct: 100, flashD: 100, flashF: 0, flashGames: 29, flashDCount: 29, flashFCount: 0, champions: 8 },
    ],
    evidence: [{
            id: "preview-low-signal",
            score: 35,
            title: "KDA REGIME CHANGE",
            detail: "A weak performance change appeared in a small comparable set of games.",
            date: "2026-08-20",
            gameId: "NA1_PREVIEW",
            tone: "warm",
            comparison: {
                baseline: { label: "PRECEDING COMPARABLE GAMES", detail: "Small comparison group", matches: [] },
                changed: { label: "RECENT COMPARABLE GAMES", detail: "Small comparison group", matches: [] },
            },
        }],
    flash: { changed: false, oldSlot: 1, oldPct: 100, newSlot: 1, newPct: 100 },
};
const evidenceGroups = (receipt: Evidence) => receipt.comparison ? [receipt.comparison.baseline, receipt.comparison.changed] : [];
const flashClass = (slot: string) => `flash-mark flash-${slot.toLowerCase()}`;
const roleText = (value: string) => value.replace(/\bMIDDLE\b/g, "MID").replace(/\bBOTTOM\b/g, "ADC").replace(/\bUTILITY\b/g, "SUPPORT");
const receiptDetail = (receipt: Evidence) => receipt.title === "ROLE HABIT SHIFT"
    ? roleText(receipt.detail.replace(/\.\s*A role change alone carries only a small index weight\.?/i, "."))
    : receipt.detail;
const runeManifest = runeManifestData as RuneManifest;
const runeStyleEntries = Object.entries(runeManifest.styles);
const shardRows = [[5008, 5005, 5007], [5008, 5010, 5011], [5011, 5012, 5013]];
const shardFallbackNames: Record<number, string> = {
    5001: "Health Scaling", 5002: "Armor", 5003: "Magic Resist", 5005: "Attack Speed",
    5007: "Ability Haste", 5008: "Adaptive Force", 5010: "Move Speed", 5011: "Health",
    5012: "Resist Scaling", 5013: "Tenacity and Slow Resist",
};
const runeId = (rune: Rune) => Number(rune.icon.match(/\/(\d+)\.png$/)?.[1] ?? 0);
function RuneChoice({ rune, selected }: {
    rune: Rune & {
        id?: number;
    };
    selected: boolean;
}) {
    return <span className={`rune-choice ${selected ? "selected" : ""}`} title={rune.name}><img src={rune.icon} alt={rune.name}/></span>;
}
function RuneFullPage({ runes }: {
    runes: RuneLoadout;
}) {
    const primary = runeStyleEntries.find(([, style]) => style.name === runes.primary.name)?.[1];
    const secondary = runeStyleEntries.find(([, style]) => style.name === runes.secondary.name)?.[1];
    const selectedIds = new Set([...runes.primary.selections, ...runes.secondary.selections].map(runeId));
    const selectedShardIds = runes.shards.map((shard) => shard.id);
    const renderedShardRows = shardRows.map((row, rowIndex) => {
        const selectedId = selectedShardIds[rowIndex];
        return selectedId && !row.includes(selectedId) ? [...row, selectedId] : row;
    });
    return <div className="full-rune-page">
    <div className="rune-style-tabs">{runeStyleEntries.map(([id, style]) => <img key={id} src={style.icon} alt={style.name} className={style.name === runes.primary.name ? "primary" : style.name === runes.secondary.name ? "secondary" : ""}/>)}</div>
    <div className="rune-page-body">
      <div className="rune-page-trees">
        {primary ? <section className="rune-tree-panel primary">
          <header><img src={primary.icon} alt=""/><div><small>PRIMARY PATH</small><b>{primary.name}</b></div></header>
          <div className="rune-slots">{primary.slots.map((slot, slotIndex) => <div className={`rune-slot ${slotIndex === 0 ? "keystones" : ""}`} key={`${primary.name}-${slotIndex}`}>{slot.runes.map((rune) => <RuneChoice key={rune.id} rune={rune} selected={selectedIds.has(rune.id)}/>)}</div>)}</div>
        </section> : null}
        {secondary ? <section className="rune-tree-panel secondary">
          <header><img src={secondary.icon} alt=""/><div><small>SECONDARY PATH</small><b>{secondary.name}</b></div></header>
          <div className="rune-slots">{secondary.slots.slice(1).map((slot, slotIndex) => <div className="rune-slot" key={`${secondary.name}-${slotIndex}`}>{slot.runes.map((rune) => <RuneChoice key={rune.id} rune={rune} selected={selectedIds.has(rune.id)}/>)}</div>)}</div>
        </section> : null}
        <section className="rune-shard-panel"><header><small>STAT SHARDS</small><b>{runes.shards.map((shard) => shard.name).join(" · ")}</b></header><div className="rune-shard-rows">{renderedShardRows.map((row, rowIndex) => <div className="rune-slot" key={rowIndex}>{row.map((id) => { const manifestShard = runeManifest.shards[String(id)]; const shard = manifestShard ?? { name: shardFallbackNames[id] ?? `Stat Shard ${id}`, icon: `/riot/img/rune/shard-${id}.png` }; return <RuneChoice key={`${rowIndex}-${id}`} rune={{ id, ...shard }} selected={selectedShardIds[rowIndex] === id}/>; })}</div>)}</div></section>
      </div>
    </div>
  </div>;
}
export default function Home() {
    const [riotId, setRiotId] = useState("");
    const [region, setRegion] = useState<RegionCode>("NA1");
    const [analysis, setAnalysis] = useState<Analysis | null>(null);
    const [loading, setLoading] = useState(false);
    const [scanActive, setScanActive] = useState(false);
    const [activeId, setActiveId] = useState("");
    const [activeRegion, setActiveRegion] = useState<RegionCode>("NA1");
    const requestRef = useRef<AbortController | null>(null);
    const [progress, setProgress] = useState<ScanProgress>({ phase: "SEARCHING SUMMONER", completed: 0, total: 0 });
    const [preflightPercent, setPreflightPercent] = useState(1);
    const [stats, setStats] = useState<DetectorStats | null>(null);
    const [error, setError] = useState("");
    const [tab, setTab] = useState<"TLDR" | "THE RECEIPTS">("TLDR");
    const [openMatch, setOpenMatch] = useState<ReceiptMatch | null>(null);
    const [openRunes, setOpenRunes] = useState<RuneLoadout | null>(null);
    const [openMotivation, setOpenMotivation] = useState(false);
    const [openFaq, setOpenFaq] = useState(false);
    const runeModalRef = useRef<HTMLElement | null>(null);
    const [expandedReceipt, setExpandedReceipt] = useState<string | null>(null);
    useEffect(() => {
        if (process.env.NODE_ENV !== "development" || new URLSearchParams(window.location.search).get("preview") !== "low")
            return;
        requestRef.current?.abort();
        setRiotId(LOW_SCORE_PREVIEW.id);
        setActiveId(LOW_SCORE_PREVIEW.id);
        setAnalysis(LOW_SCORE_PREVIEW);
        setLoading(false);
        setTab("TLDR");
    }, []);
    const inspect = async (event: FormEvent) => {
        event.preventDefault();
        const id = normalizeRiotId(riotId);
        if (!id) {
            setError("Use RiotID#Tag");
            return;
        }
        requestRef.current?.abort();
        const controller = new AbortController();
        requestRef.current = controller;
        setActiveId(id);
        setActiveRegion(region);
        setLoading(true);
        setScanActive(false);
        setProgress({ phase: "SEARCHING SUMMONER", completed: 0, total: 0 });
        setError("");
        setAnalysis(null);
        setOpenMatch(null);
        setOpenRunes(null);
        setExpandedReceipt(null);
        setTab("TLDR");
        try {
            while (!controller.signal.aborted) {
                const activeTimer = window.setTimeout(() => {
                    if (requestRef.current === controller) {
                        setScanActive(true);
                        setProgress((current) => current.phase === "QUEUED" ? { phase: "SEARCHING SUMMONER", completed: 0, total: 0 } : current);
                    }
                }, 1200);
                let response: Response;
                try {
                    response = await fetch(`/api/analyze?id=${encodeURIComponent(id)}&region=${region}`, { cache: "no-store", signal: controller.signal });
                }
                finally {
                    window.clearTimeout(activeTimer);
                }
                const raw = await response.text();
                let data: Analysis & {
                    error?: string;
                    queued?: boolean;
                    running?: boolean;
                    queueAhead?: number;
                    queueSize?: number;
                };
                try {
                    data = JSON.parse(raw) as typeof data;
                }
                catch {
                    throw new Error(`Server returned ${response.status}. Try again.`);
                }
                if (response.status === 202) {
                    if (data.queued && requestRef.current === controller) {
                        setScanActive(false);
                        setProgress({ phase: "QUEUED", completed: 0, total: 0, queueAhead: data.queueAhead, queueSize: data.queueSize });
                    }
                    else if (data.running && requestRef.current === controller)
                        setScanActive(true);
                    await new Promise((resolve) => window.setTimeout(resolve, 1000));
                    continue;
                }
                if (!response.ok)
                    throw new Error(data.error || "Analysis failed");
                if (requestRef.current === controller)
                    setAnalysis(data);
                break;
            }
        }
        catch (reason) {
            if (!controller.signal.aborted && requestRef.current === controller)
                setError(reason instanceof Error ? reason.message : "Analysis failed");
        }
        finally {
            if (requestRef.current === controller) {
                setLoading(false);
                setScanActive(false);
            }
        }
    };
    useEffect(() => { if (openRunes)
        runeModalRef.current?.scrollTo({ top: 0 }); }, [openRunes]);
    useEffect(() => {
        let live = true;
        const refresh = async () => { try {
            const response = await fetch("/api/stats", { cache: "no-store" });
            const data = await response.json() as DetectorStats;
            if (response.ok && live)
                setStats(data);
        }
        catch { } };
        void refresh();
        const timer = window.setInterval(() => void refresh(), 2000);
        return () => { live = false; window.clearInterval(timer); };
    }, []);
    useEffect(() => {
        if (!loading || !activeId || !scanActive)
            return;
        let live = true;
        const refresh = async () => { try {
            const response = await fetch(`/api/progress?id=${encodeURIComponent(activeId)}&region=${activeRegion}`, { cache: "no-store" });
            const data = await response.json() as ScanProgress;
            if (response.ok && live)
                setProgress(data);
        }
        catch { } };
        void refresh();
        const timer = window.setInterval(() => void refresh(), 700);
        return () => { live = false; window.clearInterval(timer); };
    }, [loading, activeId, activeRegion, scanActive]);
    useEffect(() => {
        if (!loading || progress.phase === "QUEUED") {
            setPreflightPercent(1);
            return;
        }
        if (progress.phase === "REVIEWING" || progress.phase === "PULLING THE RECEIPTS")
            return;
        const preparationTarget = progress.phase === "CHECKING MOOD" ? Math.min(29, 5 + progress.completed) : 4;
        setPreflightPercent((current) => Math.max(current, preparationTarget));
        const timer = window.setInterval(() => setPreflightPercent((current) => Math.min(29, current + 1)), 1200);
        return () => window.clearInterval(timer);
    }, [loading, progress.phase, progress.completed]);
    useEffect(() => () => requestRef.current?.abort(), []);
    const receipts = analysis?.evidence ?? [];
    const score = analysis?.score ?? 0;
    const scoreBand = score >= 75 ? "dont" : score >= 50 ? "very" : score >= 25 ? "watch" : "low";
    const winRate = analysis ? Math.round(analysis.ranked.solo.wins / Math.max(1, analysis.ranked.solo.wins + analysis.ranked.solo.losses) * 100) : 0;
    const scanPercent = progress.phase === "PULLING THE RECEIPTS" ? 100 : progress.phase === "QUEUED" ? 0 : progress.phase === "SEARCHING SUMMONER" || progress.phase === "CHECKING MOOD" ? preflightPercent : progress.total ? Math.min(99, 30 + Math.floor(progress.completed / progress.total * 69)) : 30;
    const scanStep = progress.phase === "QUEUED" ? 0 : progress.phase === "SEARCHING SUMMONER" ? 1 : progress.phase === "CHECKING MOOD" ? 2 : progress.phase === "REVIEWING" ? 3 : 4;
    const scanLabel = scanStep === 0 ? "WAITING FOR DREWLEVIN’S ATTENTION" : scanStep === 1 ? "FINDING SUMMONER" : scanStep === 2 ? "CHECKING DREWLEVIN’S MOOD" : scanStep === 3 ? "SIMULATING DREWLEVIN BRAIN" : "PULLING THE RECEIPTS";
    const matchTeams = openMatch ? (() => {
        const grouped = new Map<string, ReceiptMatch["players"]>();
        openMatch.players.forEach((player, index) => {
            const key = Number.isFinite(player.teamId) ? String(player.teamId) : index < 5 ? "team-1" : "team-2";
            grouped.set(key, [...(grouped.get(key) ?? []), player]);
        });
        return [...grouped.entries()];
    })() : [];
    return <main>
    <style>{`
      body{font-family:"Arial Rounded MT Bold",ui-rounded,system-ui,sans-serif!important}main{background:linear-gradient(155deg,#fff7f8,#fff 48%,#f2f6ff)!important;min-height:100vh}.search-wrap{padding:92px 20px 28px!important}.search-wrap h1{font-size:clamp(52px,7vw,82px)!important;letter-spacing:-.07em!important}.search-wrap h1 em{color:#e84f62!important}.intro{color:#68748b!important}.search{border-radius:22px!important;height:60px!important;overflow:hidden;border-color:#c9d7f0!important;box-shadow:0 10px 30px #315bdb17!important}.search button{margin:5px;border-radius:17px!important;background:#3167e5!important;font-family:inherit!important;letter-spacing:0!important}.live-stats{display:flex;align-items:center;justify-content:center;gap:20px;margin:21px auto 0;color:#62708b;font-size:16px;font-weight:800;letter-spacing:.025em}.live-stats span{display:flex;align-items:baseline;gap:8px}.live-stats b{font-size:27px;color:#3167e5}.live-stats span:last-child b{color:#e84f62}.live-stats i{width:6px;height:6px;border-radius:50%;background:#c7d2e5}.casefile{max-width:940px!important}.file-head{border-top:0!important;padding:12px 0 22px!important}.file-head h2{font-family:inherit!important;font-size:28px!important}.tabs{border:0!important;gap:8px!important;margin-bottom:18px}.tabs button{border:1px solid #d8e0ed!important;border-radius:999px!important;padding:14px 26px!important;font-family:inherit!important;font-size:16px!important;font-weight:900!important;letter-spacing:.02em!important;background:#fff!important}.tabs button.selected{border-color:#3167e5!important;background:#3167e5!important;color:#fff!important}.tldr-card,.receipts-card{background:#fff;border:1px solid #dfe6f0;border-radius:24px;box-shadow:0 12px 35px #1d3d720d}.tldr-card{padding:clamp(25px,5vw,52px);display:grid;grid-template-columns:230px 1fr;gap:42px}.big-score{font-size:clamp(110px,16vw,176px);line-height:.72;letter-spacing:-.12em;font-weight:900;color:#3167e5}.score-label{font-size:13px;font-weight:800;color:#e84f62;margin-top:17px}.tldr-title{font-size:clamp(30px,4vw,48px);line-height:.92;letter-spacing:-.065em;margin:7px 0 15px}.tldr-copy{color:#61708a;font-size:15px;line-height:1.45;margin:0 0 25px}.reason-list{display:grid;gap:10px}.reason{display:grid;grid-template-columns:38px 1fr;gap:10px;align-items:start;padding:12px 0;border-top:1px solid #e8edf5}.reason b{color:#e84f62;font-size:12px}.reason h3{font-size:12px;margin:0 0 4px}.reason p{font-size:12px;line-height:1.35;color:#6d7a90;margin:0}.season-row{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;margin-top:18px}.season{border-radius:13px;background:#f4f7fd;padding:12px}.season b{display:block;color:#3167e5;font-size:11px;margin-bottom:6px}.season span{display:block;font-size:12px;color:#6b7890;line-height:1.5}.receipts-card{padding:25px}.receipts-head{display:flex;justify-content:space-between;align-items:end;margin-bottom:8px}.receipts-head h2{font-size:29px;letter-spacing:-.055em;margin:0}.receipts-head span{font-size:11px;color:#68758d}.receipt{display:grid;grid-template-columns:52px 1fr auto;gap:14px;align-items:start;border-top:1px solid #e4e9f1;padding:17px 0}.receipt-score{width:42px;height:42px;border-radius:13px;background:#eaf1ff;color:#3167e5;display:grid;place-items:center;font-weight:900}.receipt-score.hot{background:#ffeaed;color:#e84f62}.receipt h3{font-size:13px;margin:1px 0 5px;letter-spacing:.03em}.receipt p{font-size:13px;line-height:1.45;color:#61708a;margin:0}.receipt-meta{font:10px ui-monospace,monospace;color:#3167e5;white-space:nowrap;padding-top:3px}.api-error{max-width:700px;margin:0 auto 120px}.loading{height:220px!important}.scan-loading{height:auto!important;max-width:760px;margin:0 auto 120px;padding:38px 40px;background:#fff;border:1px solid #dfe6f0;border-radius:26px;box-shadow:0 16px 42px #1d3d7214;text-align:center}.scan-current{display:block;color:#e84f62;font-size:clamp(20px,3vw,29px);letter-spacing:.025em}.scan-percent,.queue-ahead{font-size:clamp(94px,16vw,156px);font-weight:900;line-height:.88;letter-spacing:-.09em;color:#3167e5;margin:13px 0 22px}.queue-ahead{color:#e84f62}.scan-track{width:100%;height:32px;border-radius:99px;background:#eaf0fb;overflow:hidden;box-shadow:inset 0 0 0 1px #dce5f5}.scan-track i{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,#3167e5,#7099f5);transition:width .35s ease}.scan-loading>b{display:block;margin-top:16px;color:#51627d;font-size:18px;letter-spacing:.035em}.queue-note{margin:13px 0 0;color:#74829a;font-size:15px}.receipt-game{color:#8b98ad;display:block;margin-top:6px}@media(max-width:700px){.search-wrap{padding-top:64px!important}.live-stats{gap:12px;font-size:14px}.live-stats span{gap:6px}.live-stats b{font-size:23px}.tldr-card{grid-template-columns:1fr;gap:26px;padding:26px}.big-score{font-size:126px}.season-row{grid-template-columns:1fr}.receipt{grid-template-columns:42px 1fr}.receipt-meta{grid-column:2;white-space:normal;padding-top:0}.receipts-card{padding:18px}.scan-loading{padding:30px 18px}.scan-loading>b{font-size:14px}}
    `}</style>
      <style>{`.riot-id{font-size:34px!important;letter-spacing:-.04em!important;margin:0!important}.report-count{font-size:16px;font-weight:800;letter-spacing:.04em;color:#61708a;margin:8px 0 0}.sample{font-size:15px!important}.sample b{font-size:23px!important}.big-score,.big-score.low,.big-score.watch,.big-score.very,.big-score.dont{font-size:clamp(175px,25vw,265px)!important}.big-score.low,.big-score.watch{color:#3167e5!important}.big-score.very{color:#ef7b25!important}.big-score.dont{color:#e84f62!important}.score-label{font-size:24px!important;margin-top:42px!important;color:#3167e5!important;letter-spacing:.08em!important}.index-legend{margin-top:34px;border-top:1px solid #dce4f0;padding-top:18px;display:grid;gap:13px}.index-legend div{font-size:15px;line-height:1.45;color:#66748a}.index-legend b{display:inline-block;width:72px;font-size:15px}.index-legend .low b,.index-legend .watch b{color:#3167e5}.index-legend .very b,.index-legend .dont b{color:#e84f62}.tldr-card{grid-template-columns:350px 1fr!important}.tldr-title{font-size:clamp(34px,4.5vw,52px)!important}.low-confidence-note{display:flex;align-items:center;gap:13px;margin:0 0 22px;padding:14px 16px;border:1px solid #bcd0f7;border-radius:15px;background:#edf4ff;color:#31578f;font-size:15px;line-height:1.35}.low-confidence-note b{flex:none;padding:5px 8px;border-radius:8px;background:#3167e5;color:#fff;font-size:12px;letter-spacing:.05em}.reason{display:block!important}.reason h3{font-size:16px!important}.reason p,.tldr-copy{font-size:16px!important}.season-row{gap:13px!important}.season{padding:18px!important;border-radius:17px!important}.season b{font-size:16px!important;margin-bottom:10px!important}.season span{font-size:15px!important;line-height:1.65!important}.receipt{display:block!important;padding:0!important}.receipt-toggle{display:grid;width:100%;grid-template-columns:1fr auto;gap:14px;align-items:center;border:0;background:transparent;text-align:left;padding:18px 0}.receipt-toggle:hover h3{color:#3167e5}.receipt h3{font-size:18px!important}.receipt p{font-size:16px!important}.receipt-toggle-state{color:#3167e5;font-size:14px;font-weight:900}.receipt-body{padding:0 0 22px}.receipt-games{display:grid;gap:8px;margin-top:13px}.evidence-group{padding:13px;border-radius:14px;background:#f7f9ff}.evidence-group.changed{background:#fff5f6}.evidence-group h4{font-size:15px;margin:0 0 3px;color:#3167e5}.evidence-group.changed h4{color:#e84f62}.evidence-group p{font-size:14px!important;margin:0 0 9px!important}.receipt-games button{width:100%;text-align:left;font:13px ui-monospace,monospace;color:#23365d;background:#fff;border:1px solid #dbe4f2;border-radius:9px;padding:9px 10px;line-height:1.45}.receipt-games button:hover{background:#e8f0ff;border-color:#3167e5}.flash-mark{color:#e84f62!important;font-weight:900!important;border-radius:6px;padding:2px 5px}.flash-d{background:#dce9ff}.flash-f{background:#ffe0e5}.receipt-meta{font-size:13px!important}.match-modal{position:fixed;inset:0;z-index:10;background:#15213b88;padding:24px;overflow:auto;display:grid;place-items:center}.match-modal-card{width:min(920px,100%);max-height:calc(100vh - 48px);overflow:auto;background:#fff;border-radius:24px;padding:30px;box-shadow:0 24px 80px #10172e55;position:relative}.modal-close{position:absolute;right:16px;top:15px;width:42px;height:42px;border:0;border-radius:50%;background:#edf3ff;color:#3167e5;font-size:30px;line-height:1}.modal-kicker{font-size:14px;color:#3167e5;font-weight:900;margin:0}.modal-title{font-size:32px;margin:7px 50px 4px 0;letter-spacing:-.04em}.modal-meta{font-size:16px;color:#64718a;margin:0 0 15px}.account-focus{background:#fff0f2;border:2px solid #e84f62;border-radius:15px;padding:12px 14px;margin:0 0 18px;font-size:16px}.account-focus strong{font-size:19px}.modal-grid{display:grid;grid-template-columns:1fr 1fr;gap:11px}.modal-player{border:1px solid #dbe4f2;border-radius:15px;padding:14px}.modal-player.target-player{border:2px solid #3167e5;background:#edf3ff}.modal-player-top{display:flex;gap:10px;align-items:center}.modal-player-top>img{width:44px;height:44px;border-radius:12px}.modal-player h3{margin:0;font-size:17px;overflow-wrap:anywhere}.modal-player .champion{font-size:15px;color:#63728d;margin:2px 0 0}.modal-player b{font-size:13px;color:#3167e5}.modal-player b.loss{color:#e84f62}.modal-flash{display:flex;align-items:center;gap:5px;font-size:15px;color:#64718a;margin:11px 0 7px}.modal-flash img{width:19px;height:19px}.modal-items{display:flex;flex-wrap:wrap;gap:5px}.modal-items img{width:33px;height:33px;border-radius:8px;background:#edf3ff}@media(max-width:700px){.tldr-card{grid-template-columns:1fr!important}.big-score{font-size:190px!important}.riot-id{font-size:26px!important}.receipt-body{padding-left:0}.match-modal{padding:10px}.match-modal-card{padding:20px;max-height:calc(100vh - 20px)}.modal-grid{grid-template-columns:1fr}.low-confidence-note{align-items:flex-start;flex-direction:column;gap:8px}}`}</style>
    <style>{`.reason{display:grid!important;grid-template-columns:38px 1fr!important}.receipt-toggle{grid-template-columns:52px 1fr auto!important}.receipt-body{padding:0 0 22px 66px!important}.rune-brief{display:inline-flex;align-items:center;gap:5px;margin-left:8px;color:#4f6387;font:700 12px ui-rounded,system-ui;white-space:normal}.rune-brief img{width:18px;height:18px;border-radius:50%;background:#edf3ff}.rune-brief i{font-style:normal;color:#9aa8bf}.rune-full{margin-top:12px;padding:13px 14px;border-radius:13px;background:#fff;border:1px solid #f0cbd1;color:#293b60}.rune-full>div{display:grid;grid-template-columns:145px 1fr;gap:9px;align-items:start;margin:6px 0}.rune-full strong,.rune-full span,.rune-full em{display:flex;align-items:center;gap:5px}.rune-full strong{font-size:13px;color:#315ebd}.rune-full span{flex-wrap:wrap}.rune-full em{font-style:normal;font-size:12px;color:#53637d}.rune-full img{width:20px;height:20px;object-fit:contain}.rune-full p{margin:9px 0 0!important;font-size:12px!important;color:#6d7b92!important}@media(max-width:700px){.rune-full>div{grid-template-columns:1fr}.rune-brief{margin:5px 0 0}}`}</style>
    <section className="search-wrap" id="top">
      <h1>DrewLevin<br /><em>Detector</em></h1>
      <p className="intro">Wanna duo? Hold up. Verify before you get <span className="intro-drewed">Drewed</span>.</p>
      <form className="search" onSubmit={inspect}>
        <span className="target">◎</span><input aria-label="Riot ID" value={riotId} onChange={(event) => setRiotId(event.target.value)} placeholder="RiotID#Tag"/>
        <select aria-label="Region" value={region} disabled={loading} onChange={(event) => setRegion(event.target.value as RegionCode)}>{REGION_OPTIONS.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}</select><button type="submit" disabled={loading}>DETECT <span>↗</span></button>
      </form>
      <div className="live-stats" aria-live="polite"><span><b>{stats?.detectedAccounts ?? "—"}</b> ACCOUNTS DETECTED</span><i /><span><b>{progress.phase === "QUEUED" ? progress.queueSize ?? stats?.queueSize ?? "—" : stats?.queueSize ?? "—"}</b> IN DREW QUEUE</span></div>
    </section>
    <div className="utility-triggers"><a className="source-code-trigger" href="https://github.com/icnjz/drewlevin-detector" target="_blank" rel="noopener noreferrer"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 0C5.37 0 0 5.373 0 12c0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.043-1.61-4.043-1.61-.546-1.387-1.333-1.756-1.333-1.756-1.09-.745.083-.729.083-.729 1.205.084 1.84 1.237 1.84 1.237 1.07 1.835 2.807 1.305 3.492.998.108-.776.418-1.305.762-1.605-2.665-.305-5.466-1.334-5.466-5.931 0-1.31.468-2.382 1.236-3.222-.124-.303-.536-1.524.117-3.176 0 0 1.008-.323 3.301 1.23a11.52 11.52 0 0 1 3.003-.404c1.02.005 2.047.138 3.006.404 2.291-1.553 3.297-1.23 3.297-1.23.653 1.652.242 2.873.118 3.176.77.84 1.235 1.912 1.235 3.222 0 4.609-2.803 5.624-5.475 5.921.43.372.823 1.102.823 2.222 0 1.606-.015 2.898-.015 3.293 0 .322.216.694.825.576C20.565 21.795 24 17.297 24 12c0-6.627-5.373-12-12-12Z"/></svg><span>SOURCE CODE</span></a><button type="button" className="motivation-trigger" onClick={() => setOpenMotivation(true)} aria-haspopup="dialog"><span>MOTIVATION</span></button><button type="button" className="faq-trigger" onClick={() => setOpenFaq(true)} aria-haspopup="dialog">FAQ</button></div>
    {loading ? progress.phase === "QUEUED" ? <div className="loading scan-loading queue-loading"><strong className="scan-current">{scanLabel}</strong><div className="queue-ahead">#{progress.queueAhead ?? 1}</div><b>{`YOU ARE #${progress.queueAhead ?? 1} IN DREW QUEUE`}</b><p className="queue-note">{progress.queueSize ?? stats?.queueSize ?? 0} WAITING · YOUR SCAN STARTS AUTOMATICALLY</p></div> : <div className="loading scan-loading"><strong className="scan-current">{scanLabel}</strong><div className="scan-percent">{scanPercent}%</div><div className="scan-track"><i style={{ width: `${scanPercent}%` }}/></div><b>{progress.total ? `${progress.completed} / ${progress.total} GAMES REVIEWED` : "WAITING FOR MATCH COUNT"}</b></div> : error ? <div className="api-error solo-error">{REGION_CONFIGS[activeRegion].label} REQUEST FAILED · {error}</div> : analysis ? <section className="casefile">
      <div className="file-head"><div><h2 className="riot-id">{analysis.id}</h2><p className="report-count">{analysis.analyzedGames} RANKED MATCHES · REVIEWED</p></div><div className="sample">SOLO W/L <b>{analysis.ranked.solo.wins}–{analysis.ranked.solo.losses} · {winRate}%</b></div></div>
      <nav className="tabs" aria-label="Report views"><button onClick={() => setTab("TLDR")} className={tab === "TLDR" ? "selected" : ""}>TLDR</button><button onClick={() => setTab("THE RECEIPTS")} className={tab === "THE RECEIPTS" ? "selected" : ""}>THE RECEIPTS</button></nav>
      {tab === "TLDR" ? (<div className="tldr-card">
          <section>
            <div className={`big-score ${scoreBand}`}>{score}</div>
            <div className="score-label">DREW INDEX</div>
            <div className="index-legend">
              <div className="low"><b>0–24</b> No meaningful signal.</div>
              <div className="watch"><b>25–49</b> Low confidence. Likely false positive.</div>
              <div className="very"><b>50–74</b> Very sus. Only duo when you have to.</div>
              <div className="dont"><b>75–99</b> Don’t duo. You might get Drewed.</div>
            </div>
          </section>
          <section>
            <h2 className="tldr-title">{scoreBand === "dont" ? "DON’T DUO. YOU MIGHT GET DREWED." : scoreBand === "very" ? "VERY SUS. ONLY DUO WHEN YOU HAVE TO." : scoreBand === "watch" ? "LOW CONFIDENCE. LIKELY FALSE POSITIVE." : "QUEUE UP. PROBABLY FINE."}</h2>
            {score < 50 ? <div className="low-confidence-note"><b>NOT CONFIDENTLY FLAGGED</b><span>Scores below 50 are low confidence and likely false positives.</span></div> : null}
            <div className="reason-list">{receipts.slice(0, 3).map((receipt) => (<div className="reason" key={receipt.id}>
                <b>{receipt.score}</b>
                <div><h3>{receipt.title}</h3><p>{receiptDetail(receipt)}</p></div>
              </div>))}</div>
            <div className="season-row">{analysis.seasons.map((season) => (<div className="season" key={season.label}>
                <b>{season.label}</b>
                {season.archivedTier ? <span className="season-tier">{season.archivedTier}</span> : null}
                {season.recordAvailability === "available" ? <>
                  <span>{season.soloGames} Solo/Duo</span><span>{season.flexGames} Flex</span>
                  {season.flashGames ? <span>Flash: D {season.flashD}% ({season.flashDCount}) · F {season.flashF}% ({season.flashFCount})</span> : <span className="season-archive">Flash: —</span>}
                </> : season.recordAvailability === "archive" ? <><span>{season.soloGames} Solo/Duo</span><span>{season.flexGames} Flex</span><span className="season-archive">Archived stats</span></> : <span className="season-archive">No match data</span>}
              </div>))}</div>
          </section>
        </div>) : (<div className="receipts-card">
          <div className="receipts-head"><h2>THE RECEIPTS</h2><span>{receipts.length} SIGNALS</span></div>
          {receipts.map((receipt) => (<article className="receipt" key={receipt.id}>
              <button type="button" className="receipt-toggle" aria-expanded={expandedReceipt === receipt.id} onClick={() => setExpandedReceipt(expandedReceipt === receipt.id ? null : receipt.id)}>
                <span className={`receipt-score ${receipt.score >= 50 ? "hot" : ""}`}>{receipt.score}</span>
                <div><h3>{receipt.title}</h3></div>
                <span className="receipt-toggle-state">{expandedReceipt === receipt.id ? "−" : "+"}</span>
              </button>
              {expandedReceipt === receipt.id ? <div className="receipt-body">
                <p>{receiptDetail(receipt)}</p>
                <div className="receipt-games">{evidenceGroups(receipt).map((group, groupIndex) => (<section className={`evidence-group ${groupIndex === 1 ? "changed" : ""}`} key={groupIndex}>
                    <h4>{roleText(group.label)}</h4><p>{group.detail}</p>
                    {group.matches.map((match) => {
                                const isFlashReceipt = receipt.title.includes("FLASH");
                                return <div className="receipt-match-row" key={match.gameId}><button type="button" className="receipt-match-open" onClick={() => setOpenMatch(match)}>
                      <b>{match.date}</b> · {match.queue} · {isFlashReceipt ? <strong className={flashClass(match.flash)}>Flash: {match.flash}</strong> : <strong>{match.kda} KDA</strong>} · {match.gameId}
                    </button></div>;
                            })}
                  </section>))}</div>
              </div> : null}
            </article>))}
        </div>)}
    </section> : null}
    {openMatch ? <div className="match-modal" role="dialog" aria-modal="true" aria-label="Match details" onMouseDown={() => setOpenMatch(null)}>
      <section className="match-modal-card" onMouseDown={(event) => event.stopPropagation()}>
        <button type="button" className="modal-close" aria-label="Close match details" onClick={() => setOpenMatch(null)}>×</button>
        <p className="modal-kicker">MATCH DETAILS</p>
        <h2 className="modal-title">{openMatch.gameId}</h2>
        <p className="modal-meta">{openMatch.date} · {openMatch.queue} · {openMatch.duration} min</p>
        {openMatch.players.filter((player) => player.isTarget).map((player) => <div className="account-focus" key={player.riotId}>
          <div>ACCOUNT UNDER REVIEW: <strong>{player.riotId}</strong> · {player.champion} · <span className={flashClass(player.flash)}>Flash: {player.flash}</span> · {player.kda} KDA · {roleText(openMatch.role)}</div>
          {openMatch.runes ? <button type="button" className="rune-preview-trigger modal-rune-trigger" onClick={() => setOpenRunes(openMatch.runes!)} aria-label="Open full rune page"><span>VIEW FULL RUNE PAGE</span></button> : null}
        </div>)}
        <div className="modal-grid">{matchTeams.map(([teamId, teamPlayers], teamIndex) => <section className="modal-team" key={teamId} aria-label={`Team ${teamIndex + 1}`}>
          <h3 className="modal-team-label">TEAM {teamIndex + 1}</h3>
          {teamPlayers.map((player, index) => <article className={`modal-player ${player.isTarget ? "target-player" : ""}`} key={`${player.riotId}-${index}`}>
          <div className="modal-player-top"><img src={player.championImage} alt=""/><div><h3>{player.riotId}</h3><p className="champion">{player.champion}</p><b className={player.result === "LOSS" ? "loss" : ""}>{player.result} · {player.kda}</b></div></div>
          <div className="modal-flash"><img src="/riot/img/spell/SummonerFlash.png" alt=""/><span className={flashClass(player.flash)}>Flash: {player.flash}</span></div>
          <div className="modal-items">{player.items.map((item, slotIndex) => <span className="item-slot" key={slotIndex} title={`Slot ${slotIndex + 1}${item ? ` · Item ${item}` : " · Empty"}`}>{item ? <img src={`/riot/img/item/${item}.png`} alt={`Slot ${slotIndex + 1}: Item ${item}`}/> : <span className="empty-item"/>}<small>{slotIndex + 1}</small></span>)}</div>
        </article>)}
        </section>)}</div>
      </section>
    </div> : null}
    {openRunes ? <div className="match-modal rune-modal" role="dialog" aria-modal="true" aria-label="Full rune page" onMouseDown={() => setOpenRunes(null)}>
      <section ref={runeModalRef} className="match-modal-card rune-modal-card" onMouseDown={(event) => event.stopPropagation()}>
        <button type="button" className="modal-close" aria-label="Close rune page" onClick={() => setOpenRunes(null)}>×</button>
        <p className="modal-kicker">LEAGUE RUNE PAGE</p>
        <RuneFullPage runes={openRunes}/>
      </section>
    </div> : null}
    {openMotivation ? <div className="match-modal motivation-modal" role="dialog" aria-modal="true" aria-label="Motivation" onMouseDown={() => setOpenMotivation(false)}>
      <section className="match-modal-card motivation-modal-card" onMouseDown={(event) => event.stopPropagation()}>
        <button type="button" className="modal-close" aria-label="Close motivation" onClick={() => setOpenMotivation(false)}>×</button>
        <p className="modal-kicker">MOTIVATION</p>
        <div className="motivation-body">
          <p>Apparently, your duo’s account can get your account banned. “I didn’t know” is not a defense, and Riot’s unclear enforcement may still put your account at risk.</p>
          <a className="motivation-policy-link" href="https://www.leagueoflegends.com/en-us/news/dev/account-penalties-and-enforcement-faq/" target="_blank" rel="noreferrer">Riot Account Penalties &amp; Enforcement FAQ ↗</a>
          <div className="motivation-shots">
            <figure className="motivation-shot"><img src="/evidence/p1.png" alt="Player asks whether Riot will unban them if their duo lied about the account"/><figcaption>Ask first. It will not save you.</figcaption></figure>
            <figure className="motivation-shot"><img src="/evidence/p2.png" alt="Drew Levin says I did not know is not an excuse for duoing with a purchased account"/><figcaption>&quot;I did not know.&quot; Also will not save you.</figcaption></figure>
            <figure className="motivation-shot"><img src="/evidence/p3.png" alt="Drew Levin says your husband bought an account to duo with you"/><figcaption>&quot;My husband bought it.&quot; Still will not save you.</figcaption></figure>
            <figure className="motivation-shot"><img src="/evidence/p4.png" alt="Drew Levin says your duo account was bought"/><figcaption>Their account. Your problem.</figcaption></figure>
          </div>
        </div>
      </section>
    </div> : null}
    {openFaq ? <div className="match-modal faq-modal" role="dialog" aria-modal="true" aria-label="Frequently asked questions" onMouseDown={() => setOpenFaq(false)}>
      <section className="match-modal-card faq-modal-card" onMouseDown={(event) => event.stopPropagation()}>
        <button type="button" className="modal-close" aria-label="Close FAQ" onClick={() => setOpenFaq(false)}>×</button>
        <p className="modal-kicker">FAQ</p>
        <h2 className="modal-title">DrewLevin Detector</h2>
        <div className="faq-list">
          <section><h3>What does it do?</h3><p>It compares ranked match habits across the account timeline, then puts the exact supporting games in THE RECEIPTS.</p></section>
          <section><h3>Why do some accounts show more games than others?</h3><p>Every account has a different amount of individual match detail still available to read. The detector reviews every eligible Solo/Duo and Flex game it can reach.</p></section>
          <section><h3>Why can an old season have a rank but no receipts?</h3><p>Season summaries can remain visible after the individual game records behind them are no longer available. Without a game record, there is no Flash, rune, build, or player data to compare.</p></section>
          <section><h3>Why do other stat sites sometimes show more history?</h3><p>They may have saved season summaries or match data earlier. A visible historical rank does not always come with a readable match-by-match record.</p></section>
          <section><h3>What does the Drew Index use?</h3><p>It looks for habit changes that line up across games. Open THE RECEIPTS to see the matches behind each signal.</p></section>
          <section><h3>What does a score below 50 mean?</h3><p>It is low confidence and likely a false positive. The account was not confidently flagged; weak or isolated signals can still produce a low score.</p></section>
        </div>
      </section>
    </div> : null}
    <footer className="site-footer">
      <span>DrewLevin Detector</span>
      <a href="/privacy">Privacy</a>
      <a href="/disclaimer">Disclaimer</a>
      <p>DrewLevin Detector isn&apos;t endorsed by Riot Games and doesn&apos;t reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc.</p>
    </footer>
  </main>;
}
