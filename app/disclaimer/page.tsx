import type { Metadata } from "next";
import Link from "next/link";
export const metadata: Metadata = {
    title: "Disclaimer | DrewLevin Detector",
    description: "Important information about DrewLevin Detector and Riot Games.",
};
const policyLinks = [
    ["Riot Developer Portal", "https://developer.riotgames.com/docs/portal"],
    ["League of Legends API Docs", "https://developer.riotgames.com/docs/lol"],
    ["Riot Developer General Policies", "https://developer.riotgames.com/policies/general"],
    ["Riot Game Policy", "https://developer.riotgames.com/docs/lol#game-policy"],
];
export default function DisclaimerPage() {
    return <main className="legal-page">
    <header className="legal-header">
      <Link className="legal-brand" href="/">DrewLevin <b>Detector</b></Link>
      <nav aria-label="Legal pages"><a href="/privacy">Privacy</a><a href="/disclaimer" aria-current="page">Disclaimer</a></nav>
    </header>
    <article className="legal-card">
      <p className="legal-kicker">DISCLAIMER</p>
      <h1>Disclaimer</h1>
      <p className="legal-updated">Last updated: September 16, 2026</p>

      <section className="legal-boilerplate">
        <p>DrewLevin Detector isn&apos;t endorsed by Riot Games and doesn&apos;t reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc.</p>
      </section>

      <section>
        <h2>Unofficial community tool</h2>
        <p>DrewLevin Detector is an independent, free community project. It is not affiliated with, sponsored by, approved by, or operated by Riot Games. League of Legends and Riot Games are trademarks or registered trademarks of Riot Games, Inc.</p>
      </section>

      <section>
        <h2>Data may be incomplete or inaccurate</h2>
        <p>The report uses public Riot API data, Data Dragon assets, and limited public third-party information. Data can be delayed, incomplete, cached, unavailable, or incorrect. The report is for information only and is not proof of account ownership, account history, intent, wrongdoing, or an official Riot Games decision.</p>
      </section>

      <section>
        <h2>No enforcement or ban guarantee</h2>
        <p>This tool cannot determine whether an account follows Riot&apos;s rules, whether an account was purchased or shared, whether enforcement will happen, or whether using this tool will prevent a suspension. It does not provide legal or account-compliance advice. You remain responsible for your own account and choices.</p>
      </section>

      <section>
        <h2>Third-party services</h2>
        <p>This site may link to Riot Games or other third-party pages. Those services have their own terms and privacy practices. We are not responsible for their content, availability, or data handling.</p>
      </section>

      <section>
        <h2>Use at your own risk</h2>
        <p>To the maximum extent permitted by law, the project operators are not liable for account enforcement, account loss, inaccurate analysis, missed matches, service interruption, data loss, or decisions made using this tool. The service is provided as-is and as-available.</p>
      </section>

      <section>
        <h2>Official Riot resources</h2>
        <ul className="legal-links">{policyLinks.map(([label, href]) => <li key={href}><a href={href} target="_blank" rel="noreferrer">{label} ↗</a></li>)}</ul>
      </section>
    </article>
    <footer className="legal-footer"><Link href="/">DrewLevin Detector</Link><span>·</span><a href="/privacy">Privacy</a><span>·</span><a href="/disclaimer">Disclaimer</a></footer>
  </main>;
}
