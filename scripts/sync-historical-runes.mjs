import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.cwd();
const manifest = JSON.parse(await readFile(join(root, 'lib/runes.json'), 'utf8'));
const json = async (url) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`Rune archive ${response.status}`);
  return response.json();
};
const versions = await json('https://ddragon.leagueoflegends.com/api/versions.json');
const current = new Date().getUTCFullYear() - 2010;
const patches = [current - 2, current - 1, current].flatMap((major) => [versions.find((v) => v.startsWith(`${major}.1.`)), versions.find((v) => v.startsWith(`${major}.`))]).filter(Boolean);
let added = 0;
await mkdir(join(root, 'public/riot/img/rune'), { recursive: true });
for (const version of new Set(patches)) {
  const styles = await json(`https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/runesReforged.json`);
  for (const style of styles) for (const slot of style.slots) for (const perk of slot.runes) {
    if (manifest.perks[perk.id]) continue;
    const response = await fetch(`https://ddragon.leagueoflegends.com/cdn/img/${perk.icon}`, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`Rune icon ${perk.id}: ${response.status}`);
    await writeFile(join(root, `public/riot/img/rune/${perk.id}.png`), Buffer.from(await response.arrayBuffer()));
    manifest.perks[perk.id] = { name: perk.name, icon: `/riot/img/rune/${perk.id}.png` };
    added++;
  }
}
const serialized = JSON.stringify(manifest, null, 2);
await writeFile(join(root, 'lib/runes.json'), serialized);
await writeFile(join(root, 'public/riot/runes.json'), serialized);
console.log(`Added ${added} historical rune icons and names.`);
