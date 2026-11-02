import type { Metadata } from "next";
import Link from "next/link";
export const metadata: Metadata = {
    title: "Privacy Policy | DrewLevin Detector",
    description: "How DrewLevin Detector handles player and match data.",
};
const policyLinks = [
    ["Riot Developer Portal", "https://developer.riotgames.com/docs/portal"],
    ["League of Legends API Docs", "https://developer.riotgames.com/docs/lol"],
    ["Riot Developer General Policies", "https://developer.riotgames.com/policies/general"],
    ["Riot Game Policy", "https://developer.riotgames.com/docs/lol#game-policy"],
];
export default function PrivacyPage() {
    return <main className="legal-page">
    <header className="legal-header">
      <Link className="legal-brand" href="/">DrewLevin <b>Detector</b></Link>
      <nav aria-label="Legal pages"><a href="/privacy" aria-current="page">Privacy</a><a href="/disclaimer">Disclaimer</a></nav>
    </header>
    <article className="legal-card">
      <p className="legal-kicker">PRIVACY POLICY</p>
      <h1>Privacy Policy</h1>
      <p className="legal-updated">Last updated: September 16, 2026</p>

      <section>
        <h2>What we collect</h2>
        <p>We process the Riot ID and region you enter, together with public League of Legends data returned by the Riot API. This can include ranked information, match history, participants, champions, items, runes, summoner spells, scores, and timestamps. A public third-party profile page may be used to fill in historical rank labels.</p>
        <p>We do not ask for your Riot password, email address, payment details, or account credentials.</p>
      </section>

      <section>
        <h2>How we use it</h2>
        <p>Your information is used only to create the report, show match receipts, keep the service working, and prevent abuse. We do not sell your information or use the detector for advertising.</p>
      </section>

      <section>
        <h2>How long data stays</h2>
        <p>Reports and match details are kept in short-lived server memory for faster repeat searches. Analysis results are cached for about 15 minutes and match details for up to 24 hours. This cache is cleared when the server restarts. We do not maintain a persistent player profile.</p>
        <p>Standard security and operation logs may be kept by the hosting provider under its own policies.</p>
      </section>

      <section>
        <h2>Sharing</h2>
        <p>We send requests to Riot Games APIs and may read a public third-party profile page to prepare the report. The service also runs on third-party hosting infrastructure. We do not sell or rent personal information.</p>
      </section>

      <section>
        <h2>Cookies and tracking</h2>
        <p>The detector does not use advertising cookies, cross-site tracking pixels, or behavioral profiling. Essential security or authentication cookies may be used by the hosting platform when required.</p>
      </section>

      <section>
        <h2>Your choices</h2>
        <p>You can use the tool without creating an account. Because we do not maintain player profiles, there is normally no account data to delete. For privacy questions or removal requests concerning server logs, contact the operator through the support channel associated with this deployment.</p>
      </section>

      <section>
        <h2>Children</h2>
        <p>This service is not directed to children under 13, and we do not knowingly collect personal information from children.</p>
      </section>

      <section>
        <h2>Official Riot resources</h2>
        <ul className="legal-links">{policyLinks.map(([label, href]) => <li key={href}><a href={href} target="_blank" rel="noreferrer">{label} ↗</a></li>)}</ul>
      </section>

      <section>
        <h2>Changes</h2>
        <p>We may update this policy when the service changes. The date at the top of this page will be updated when that happens.</p>
      </section>
    </article>
    <footer className="legal-footer"><Link href="/">DrewLevin Detector</Link><span>·</span><a href="/privacy">Privacy</a><span>·</span><a href="/disclaimer">Disclaimer</a></footer>
  </main>;
}
