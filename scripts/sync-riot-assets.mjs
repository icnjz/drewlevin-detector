import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = join(process.cwd(), "public", "riot");
const cdn = "https://ddragon.leagueoflegends.com/cdn";
const communityCdn = "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/perk-images/statmods";

async function json(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Asset manifest failed: ${response.status}`);
  return response.json();
}

async function download(url, output) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Asset failed: ${response.status} ${url}`);
  await writeFile(output, Buffer.from(await response.arrayBuffer()));
}

async function pool(entries, limit, task) {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, entries.length) }, async () => {
    while (cursor < entries.length) await task(entries[cursor++]);
  }));
}

const [version] = await json("https://ddragon.leagueoflegends.com/api/versions.json");
const [champions, items, runeStyles] = await Promise.all([
  json(`${cdn}/${version}/data/en_US/champion.json`),
  json(`${cdn}/${version}/data/en_US/item.json`),
  json(`${cdn}/${version}/data/en_US/runesReforged.json`),
]);

 
await mkdir(join(root, "img", "champion"), { recursive: true });
await mkdir(join(root, "img", "item"), { recursive: true });
await mkdir(join(root, "img", "spell"), { recursive: true });
await mkdir(join(root, "img", "rune"), { recursive: true });

const championFiles = Object.values(champions.data).map((champion) => champion.image.full);
const itemFiles = Object.values(items.data).map((item) => item.image.full);
await pool(championFiles, 12, (file) => download(`${cdn}/${version}/img/champion/${file}`, join(root, "img", "champion", file)));
await pool(itemFiles, 12, (file) => download(`${cdn}/${version}/img/item/${file}`, join(root, "img", "item", file)));
await download(`${cdn}/${version}/img/spell/SummonerFlash.png`, join(root, "img", "spell", "SummonerFlash.png"));

const styles = {};
const previousRunes = await readFile(join(root, "runes.json"), "utf8").then(JSON.parse).catch(() => ({}));
const perks = { ...previousRunes.perks };
const shards = { ...previousRunes.shards };
for (const style of runeStyles) {
  styles[style.id] = {
    name: style.name,
    icon: `/riot/img/rune/style-${style.id}.png`,
    slots: style.slots.map((slot) => ({
      runes: slot.runes.map((rune) => ({ id: rune.id, name: rune.name, icon: `/riot/img/rune/${rune.id}.png` })),
    })),
  };
  await download(`${cdn}/img/${style.icon}`, join(root, "img", "rune", `style-${style.id}.png`));
  for (const slot of style.slots) for (const rune of slot.runes) {
    perks[rune.id] = { name: rune.name, icon: `/riot/img/rune/${rune.id}.png` };
    await download(`${cdn}/img/${rune.icon}`, join(root, "img", "rune", `${rune.id}.png`));
  }
}

const shardFiles = {
  5001: ["Health Scaling", "statmodshealthplusicon.png"],
  5002: ["Armor", "statmodsarmoricon.png"],
  5003: ["Magic Resist", "statmodsmagicresicon.png"],
  5005: ["Attack Speed", "statmodsattackspeedicon.png"],
  5007: ["Ability Haste", "statmodscdrscalingicon.png"],
  5008: ["Adaptive Force", "statmodsadaptiveforceicon.png"],
  5010: ["Move Speed", "statmodsmovementspeedicon.png"],
  5011: ["Health", "statmodshealthscalingicon.png"],
  5012: ["Resist Scaling", "statmodsadaptiveforcescalingicon.png"],
  5013: ["Tenacity and Slow Resist", "statmodstenacityicon.png"],
};
for (const [id, [name, file]] of Object.entries(shardFiles)) {
  shards[id] = { name, icon: `/riot/img/rune/shard-${id}.png` };
  await download(`${communityCdn}/${file}`, join(root, "img", "rune", `shard-${id}.png`));
}
const runeManifest = JSON.stringify({ styles, perks, shards }, null, 2);
await writeFile(join(root, "runes.json"), runeManifest);
await writeFile(join(process.cwd(), "lib", "runes.json"), runeManifest);
await writeFile(join(root, "manifest.json"), JSON.stringify({ version, champions: championFiles.length, items: itemFiles.length, runes: Object.keys(perks).length }, null, 2));
console.log(`Saved ${championFiles.length} champions, ${itemFiles.length} items, ${Object.keys(perks).length} runes, and Flash locally (${version}).`);
