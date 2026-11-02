"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
type Match = {
    id: string;
    queue: string;
    date: string;
    duration: number;
    players: Array<{
        riotId: string;
        champion: string;
        championImage: string;
        result: string;
        flash: string;
        items: number[];
    }>;
    error?: string;
};
export default function MatchPage() {
    const params = useParams<{
        id: string;
    }>();
    const [match, setMatch] = useState<Match | null>(null);
    const [error, setError] = useState("");
    useEffect(() => {
        const controller = new AbortController();
        setMatch(null);
        setError("");
        void fetch(`/api/match?id=${encodeURIComponent(params.id)}`, { cache: "no-store", signal: controller.signal }).then(async (response) => {
            const data = await response.json() as Match;
            if (!response.ok)
                throw new Error(data.error || "Match unavailable");
            if (!controller.signal.aborted)
                setMatch(data);
        }).catch((reason) => { if (!controller.signal.aborted)
            setError(reason instanceof Error ? reason.message : "Match unavailable"); });
        return () => controller.abort();
    }, [params.id]);
    if (error)
        return <main className="match-loading">{error}</main>;
    if (!match)
        return <main className="match-loading">LOADING MATCH…</main>;
    if (match.error)
        return <main className="match-loading">{match.error}</main>;
    return <main className="match-page"><style>{`body{font-family:"Arial Rounded MT Bold",ui-rounded,system-ui,sans-serif;background:#f5f8ff;color:#10172e}.match-page{max-width:920px;margin:auto;padding:48px 20px}.match-kicker{color:#3167e5;font-weight:800;font-size:12px}.match-page h1{font-size:34px;margin:7px 0}.match-meta{color:#62708b;font-size:14px;margin-bottom:28px}.match-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.match-player{background:white;border:1px solid #dbe4f2;border-radius:16px;padding:16px}.champion-line{display:flex;align-items:center;gap:11px}.champion-line>img{width:42px;height:42px;border-radius:12px;border:1px solid #dbe4f2}.match-player h2{font-size:17px;margin:0}.match-player b{color:#3167e5;font-size:12px}.match-player .loss{color:#e84f62}.match-player p{font-size:13px;color:#64718a;margin:10px 0 7px}.flash{display:inline-flex;align-items:center;gap:5px}.flash img{width:17px;height:17px}.item-row{display:flex;gap:4px;flex-wrap:wrap;margin-top:8px}.item-row img{width:30px;height:30px;border-radius:7px;background:#eef3ff;border:1px solid #dbe4f2}.match-loading{display:grid;place-items:center;min-height:100vh;font:800 18px ui-monospace,monospace;color:#3167e5}@media(max-width:640px){.match-grid{grid-template-columns:1fr}.match-page{padding:28px 16px}}`}</style><p className="match-kicker">DREWLEVIN DETECTOR · MATCH DETAILS</p><h1>{match.id}</h1><p className="match-meta">{match.queue} · {new Date(match.date).toLocaleString()} · {match.duration} min</p><section className="match-grid">{match.players.map((player, index) => <article className="match-player" key={`${player.champion}-${index}`}><div className="champion-line"><img src={player.championImage} alt=""/><div><h2>{player.champion}</h2><b className={player.result === "LOSS" ? "loss" : ""}>{player.result}</b></div></div><p className="flash"><img src="/riot/img/spell/SummonerFlash.png" alt=""/> Flash: {player.flash}</p><div className="item-row">{player.items.map((item) => <img key={item} src={`/riot/img/item/${item}.png`} alt={`Item ${item}`} title={`Item ${item}`}/>)}</div></article>)}</section></main>;
}
