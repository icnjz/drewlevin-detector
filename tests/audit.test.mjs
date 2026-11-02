import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

 
function loader(overrides = {}, globals = {}) {
  const cache = new Map();
  const context = vm.createContext({ console, URL, Response, Request, AbortSignal, AbortController, Date, setTimeout, clearTimeout, ...globals });
  function load(file) {
    file = resolve(file);
    if (cache.has(file)) return cache.get(file).exports;
    const loadedModule = { exports: {} }; cache.set(file, loadedModule);
    const source = readFileSync(file, 'utf8');
    if (file.endsWith('.json')) { loadedModule.exports = JSON.parse(source); return loadedModule.exports; }
    const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    const require = (name) => {
      if (Object.hasOwn(overrides, name)) return overrides[name];
      if (!name.startsWith('.')) throw new Error(`Unexpected dependency: ${name}`);
      let path = resolve(dirname(file), name);
      if (!existsSync(path)) path += '.ts';
      return load(path);
    };
    vm.runInContext(`(function(require,module,exports){${output}\n})`, context, { filename: file })(require, loadedModule, loadedModule.exports);
    return loadedModule.exports;
  }
  return load;
}
const plain = (value) => JSON.parse(JSON.stringify(value));
const utils = loader()('lib/match-utils.ts');
const year = new Date().getUTCFullYear();
const baseDate = Date.UTC(year, 0, 10);
function player(overrides = {}) {
  return { puuid: 'owner', teamId: 100, riotIdGameName: 'Test', riotIdTagline: 'NA1', summoner1Id: 4, summoner2Id: 11, win: true, championName: 'Ekko', teamPosition: 'JUNGLE', kills: 4, deaths: 2, assists: 2, item0: 0, item1: 3152, item2: 0, item3: 3100, item4: 0, item5: 0, perks: { styles: [{ style: 8100, selections: [{ perk: 8112 }] }, { style: 8300, selections: [{ perk: 8304 }, { perk: 8347 }] }], statPerks: { offense: 5008, flex: 5008, defense: 5011 } }, ...overrides };
}
function match(index, overrides = {}, info = {}) {
  const target = player(overrides);
  return { metadata: { matchId: `NA1_${100000 + index}` }, info: { gameCreation: baseDate + index * 3600_000, gameDuration: 1800, gameVersion: '26.1.1', queueId: 420, participants: [target, ...Array.from({ length: 9 }, (_, i) => player({ puuid: `other${i}`, teamId: i < 4 ? 100 : 200, riotIdGameName: `Other${i}`, championName: 'Garen', kills: 10 }))], ...info } };
}
function harness(matches, options = {}) {
  const calls = [], progress = [];
  const byId = new Map(matches.map((match) => [match.metadata.matchId, match]));
  const upstream = async (path) => {
    const url = new URL(path); calls.push(url);
    if (url.pathname.includes('/accounts/')) return { puuid: 'owner' };
    if (url.pathname.includes('/entries/')) return options.ranked ?? [];
    if (url.pathname.endsWith('/ids')) {
      if (options.repeatPage) return [matches[0].metadata.matchId];
      const start = Number(url.searchParams.get('start'));
      const filtered = matches.filter(({ info }) => info.queueId === Number(url.searchParams.get('queue')) && info.gameCreation / 1000 >= Number(url.searchParams.get('startTime')) && info.gameCreation / 1000 < Number(url.searchParams.get('endTime'))).map(({ metadata }) => metadata.matchId);
      return filtered.slice(start, start + (options.pageSize ?? 100));
    }
    return byId.get(url.pathname.split('/').at(-1));
  };
  const riot = { riotJson: upstream };
  const load = loader({
    'next/server': { NextResponse: { json: (value, init) => Response.json(value, init) } },
    '../../../lib/riot': riot,
    '../scan-state': {
      scanProgress: new Map(),
      setScanProgress: (id, value) => progress.push({ id, ...value }),
      claimScanSlot: () => ({ status: 'claimed', release: () => {} }),
      incrementDetectedAccounts: () => {},
    },
  }, { fetch: async () => new Response('', { status: 404 }) });
  const route = load('app/api/analyze/route.ts');
  const request = (id = 'Test#NA1', region = 'NA1') => ({ nextUrl: new URL(`http://local/api/analyze?id=${encodeURIComponent(id)}&region=${encodeURIComponent(region)}`) });
  return { route, calls, progress, request, run: async (id, region) => { const response = await route.GET(request(id, region)); return { status: response.status, body: await response.json() }; } };
}

test('one consistent default Flash slot mapping, including no Flash', () => {
  assert.equal(utils.flashLabel({ summoner1Id: 4, summoner2Id: 11 }), 'D');
  assert.equal(utils.flashLabel({ summoner1Id: 11, summoner2Id: 4 }), 'F');
  assert.equal(utils.flashLabel({ summoner1Id: 6, summoner2Id: 11 }), '—');
});
test('rare opposite Flash is visible and no-Flash games are excluded', () => {
  const result = utils.flashStats([...Array.from({ length: 243 }, () => player()), player({ summoner1Id: 11, summoner2Id: 4 }), player({ summoner1Id: 11, summoner2Id: 6 })]);
  assert.equal(result.flashGames, 244); assert.equal(result.flashDCount, 243); assert.equal(result.flashFCount, 1); assert.ok(result.flashD < 100);
});
test('inventory retains all six slots, empty and repeated items', () => {
  assert.deepEqual(plain(utils.inventorySlots(player({ item5: 3152 }))), [0,3152,0,3100,0,3152]);
});
test('Riot IDs preserve Unicode/spaces and reject extra tags', () => {
  assert.equal(utils.normalizeRiotId(' 测试玩家 # TEST '), '测试玩家#TEST');
  assert.equal(utils.normalizeRiotId('Example Player#TEST'), 'Example Player#TEST');
  assert.equal(utils.normalizeRiotId('name#tag#extra'), null);
});
test('date windows are fresh per scan and contain the final second of each year', () => {
  const first = utils.seasonSlices(Date.UTC(2026,8,1)); const second = utils.seasonSlices(Date.UTC(2026,8,2));
  assert.ok(second[2].end > first[2].end); assert.equal(first[0].end, first[1].start);
});
test('short pages continue, queues sum correctly, split totals never shrink raw counts', async () => {
  const matches = Array.from({ length: 12 }, (_, i) => match(i, {}, { queueId: i < 4 ? 420 : 440 }));
  const h = harness(matches, { pageSize: 3, ranked: [{ queueType: 'RANKED_FLEX_SR', wins: 6, losses: 2 }] });
  const { status, body } = await h.run(); assert.equal(status, 200); assert.equal(body.analyzedGames, 12);
  const season = body.seasons.at(-1); assert.equal(season.games, 12); assert.equal(season.soloGames, 4); assert.equal(season.flexGames, 8);
  assert.equal(season.games, season.soloGames + season.flexGames);
  assert.ok(h.calls.some((url) => url.searchParams.get('start') === '3'));
});
test('empty histories cannot produce a low-risk score', async () => {
  const result = await harness([]).run(); assert.equal(result.status, 502); assert.equal(result.body.score, undefined);
});
test('invalid ID makes no upstream call', async () => {
  const h = harness([]); assert.equal((await h.run('broken#tag#extra')).status, 400); assert.equal(h.calls.length, 0);
});
test('selected region controls platform, Match-V5 cluster and match prefix', async () => {
  const euwMatch = match(1); euwMatch.metadata.matchId = 'EUW1_100001';
  const h = harness([euwMatch]);
  const result = await h.run('Test#EUW', 'EUW1');
  assert.equal(result.status, 200); assert.equal(result.body.region, 'EUW1'); assert.equal(result.body.analyzedGames, 1);
  assert.ok(h.calls.some((url) => url.hostname === 'euw1.api.riotgames.com'));
  assert.ok(h.calls.some((url) => url.hostname === 'europe.api.riotgames.com'));
  assert.ok(h.progress.every((item) => item.id.startsWith('EUW1:')));
});
test('unsupported regions fail before any upstream request', async () => {
  const h = harness([]); const result = await h.run('Test#NA1', 'KR');
  assert.equal(result.status, 400); assert.match(result.body.error, /Unsupported region/); assert.equal(h.calls.length, 0);
});
test('scan queue serializes work, reports who is ahead and counts completions', async () => {
  const persisted = new Map();
  const queue = loader({ 'cloudflare:workers': { env: { DETECTOR_STATE: { get: async (key) => persisted.get(key) ?? null, put: async (key, value) => persisted.set(key, value) } } } })('app/api/scan-state.ts');
  const first = queue.claimScanSlot('NA1:first#one');
  assert.equal(first.status, 'claimed');
  const second = queue.claimScanSlot('EUW1:second#two');
  assert.equal(second.status, 'queued');
  assert.deepEqual(plain(await queue.detectorStats()), { detectedAccounts: 102, queueSize: 1, activeScans: 1 });
  assert.equal(queue.scanProgress.get('euw1:second#two').phase, 'QUEUED');
  assert.equal(queue.scanProgress.get('euw1:second#two').queueAhead, 1);
  first.release();
  const secondClaim = queue.claimScanSlot('EUW1:second#two');
  assert.equal(secondClaim.status, 'claimed');
  assert.equal((await queue.detectorStats()).queueSize, 0); assert.equal((await queue.detectorStats()).activeScans, 1);
  await queue.incrementDetectedAccounts(); assert.equal((await queue.detectorStats()).detectedAccounts, 103); assert.equal(persisted.get('detected-accounts'), '103');
  secondClaim.release(); assert.equal((await queue.detectorStats()).activeScans, 0);
});
test('repeating upstream pages fail instead of silently truncating or looping', async () => {
  const result = await harness([match(1)], { repeatPage: true }).run(); assert.equal(result.status, 502); assert.match(result.body.error, /repeated/);
});
test('account PUUID still identifies the participant after a Riot ID rename', async () => {
  const result = await harness([match(1, { riotIdGameName: 'Previous name', riotIdTagline: 'OLD' })]).run();
  assert.equal(result.status, 200); assert.equal(result.body.analyzedGames, 1);
});
test('simultaneous identical scans share work without holding a second Worker request open', async () => {
  const h = harness([match(1)]);
  const responses = await Promise.all([h.route.GET(h.request()), h.route.GET(h.request())]);
  assert.equal(h.calls.filter((url) => url.pathname.includes('/accounts/')).length, 1);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 202]);
  const completed = responses.find((response) => response.status === 200); assert.equal((await completed.json()).analyzedGames, 1);
  await h.run(); assert.equal(h.progress.at(-1).phase, 'PULLING THE RECEIPTS');
});
test('Flex win-rate changes never generate performance signals or change index', async () => {
  const base = Array.from({ length: 40 }, (_, i) => match(i, { win: i % 2 === 0 }));
  const flex = Array.from({ length: 40 }, (_, i) => match(100+i, { win: true }, { queueId: 440 }));
  const before = (await harness(base).run()).body;
  const after = (await harness([...base, ...flex]).run()).body;
  assert.equal(before.score, after.score);
  assert.ok(after.evidence.every((e) => !/WIN-RATE|QUEUE SPLIT|BREAKOUT|RUNE PERFORMANCE/.test(e.title)));
});
test('Solo/Duo win-rate evidence contains only Solo/Duo on both sides', async () => {
  const body = (await harness(Array.from({ length: 40 }, (_, i) => match(i, { win: i >= 20 }))).run()).body;
  const evidence = body.evidence.find((e) => e.title === 'WIN-RATE REGIME CHANGE'); assert.ok(evidence);
  assert.ok([...evidence.comparison.baseline.matches,...evidence.comparison.changed.matches].every((m) => m.queue === 'SOLO/DUO'));
});
test('changing champion or role alone cannot trigger KDA comparison', async () => {
  const body = (await harness(Array.from({ length: 40 }, (_, i) => match(i, { championName: i < 20 ? 'Ekko' : 'Garen', kills: i < 20 ? 4 : 20 }))).run()).body;
  assert.ok(body.evidence.every((e) => e.title !== 'KDA REGIME CHANGE'));
});
test('same-champion same-role KDA changes still produce exact evidence', async () => {
  const body = (await harness(Array.from({ length: 32 }, (_, i) => match(i, { kills: i < 16 ? 4 : 20 }))).run()).body;
  assert.ok(body.evidence.some((e) => e.title === 'KDA REGIME CHANGE'));
  for (const e of body.evidence) for (const group of Object.values(e.comparison)) for (const m of group.matches) {
    const target = m.players.filter((p) => p.isTarget); assert.equal(target.length, 1); assert.equal(target[0].flash, m.flash); assert.equal(target[0].items.length, 6);
  }
});
test('different stable Flash habits across queues get dedicated high-risk evidence', async () => {
  const rows = [...Array.from({ length: 24 }, (_, i) => match(i)), ...Array.from({ length: 24 }, (_, i) => match(100+i, { summoner1Id: 11, summoner2Id: 4 }, { queueId: 440 }))];
  const body = (await harness(rows).run()).body;
  assert.equal(body.score, 88);
  const evidence = body.evidence.find((e) => e.title === 'CROSS-QUEUE FLASH HABIT SPLIT'); assert.ok(evidence);
  assert.equal(body.flash.changed, true);
  assert.ok(evidence.comparison.baseline.matches.every((m) => m.queue === 'SOLO/DUO' && m.flash === 'D'));
  assert.ok(evidence.comparison.changed.matches.every((m) => m.queue === 'FLEX' && m.flash === 'F'));
});
test('same-queue Flash reversal remains high and opposite groups have exact matches', async () => {
  const body = (await harness(Array.from({ length: 32 }, (_, i) => match(i, i < 16 ? {} : { summoner1Id: 11, summoner2Id: 4 }))).run()).body;
  assert.equal(body.score, 88);
  const e = body.evidence.find((e) => e.title === 'FLASH SLOT REGIME CHANGE'); assert.ok(e);
  assert.ok(e.comparison.baseline.matches.every((m) => m.flash === 'D')); assert.ok(e.comparison.changed.matches.every((m) => m.flash === 'F'));
  assert.equal(new Set(body.evidence.map((e) => e.id)).size, body.evidence.length);
  assert.ok(!JSON.stringify(body).includes('RIOT_API_KEY'));
});
test('rune selections and all shards survive match serialization', async () => {
  const body = (await harness([match(1)]).run()).body;
  const receipt = body.evidence[0].comparison.baseline.matches[0];
  assert.equal(receipt.runes.primary.selections[0].name, 'Electrocute');
  assert.equal(receipt.runes.secondary.selections.length, 2); assert.equal(receipt.runes.shards.length, 3);
  const unknownShardBody = (await harness([match(2, { perks: { ...player().perks, statPerks: { offense: 5005, flex: 5008, defense: 5001 } } })]).run()).body;
  const unknownShard = unknownShardBody.evidence[0].comparison.baseline.matches[0].runes.shards[2];
  assert.equal(unknownShard.name, 'Health Scaling'); assert.equal(unknownShard.icon, '/riot/img/rune/shard-5001.png');
});

test('one opposite Flash game inside a long history is not averaged away', async () => {
  const rows = Array.from({ length: 300 }, (_, i) => match(i, i === 151 ? { summoner1Id: 11, summoner2Id: 4 } : {}));
  const body = (await harness(rows).run()).body;
  assert.equal(body.score, 88);
  const changes = body.evidence.filter((e) => e.title === 'FLASH SLOT REGIME CHANGE');
  assert.ok(changes.some((e) => e.comparison.changed.matches.length === 1 && e.comparison.changed.matches[0].gameId === rows[151].metadata.matchId));
  assert.ok(changes.some((e) => e.comparison.baseline.matches[0].gameId === rows[151].metadata.matchId && e.comparison.changed.matches.every((m) => m.flash === 'D')));
});

test('repeated D/F alternation is visible even without a long stable run', async () => {
  const body = (await harness(Array.from({ length: 12 }, (_, i) => match(i, i % 2 ? { summoner1Id: 11, summoner2Id: 4 } : {}))).run()).body;
  assert.equal(body.score, 88);
  const e = body.evidence.find((e) => e.title === 'REPEATED FLASH SLOT SWITCHES');
  assert.equal(e.comparison.baseline.matches.length, 6);
  assert.equal(e.comparison.changed.matches.length, 6);
  assert.equal(body.evidence.filter((e) => e.title === 'FLASH SLOT REGIME CHANGE').length, 0);
});

test('a short opposite Flash prefix is compared to the later established habit', async () => {
  const rows = Array.from({ length: 30 }, (_, i) => match(i, i < 2 ? { summoner1Id: 11, summoner2Id: 4 } : {}));
  const body = (await harness(rows).run()).body;
  assert.equal(body.score, 88);
  const e = body.evidence.find((e) => e.title === 'FLASH SLOT REGIME CHANGE');
  assert.equal(e.comparison.baseline.matches.length, 2);
  assert.equal(e.comparison.changed.matches.length, 28);
});

test('a sparse Flex opposite Flash is compared against the established Solo habit', async () => {
  const rows = [...Array.from({ length: 12 }, (_, i) => match(i)), match(12, { summoner1Id: 11, summoner2Id: 4 }, { queueId: 440 })];
  const body = (await harness(rows).run()).body;
  assert.equal(body.score, 88);
  assert.ok(body.evidence.some((e) => e.comparison.changed.matches.some((m) => m.queue === 'FLEX' && m.flash === 'F')));
});

test('Flash history remains connected across all three seasons', async () => {
  const rows = Array.from({ length: 6 }, (_, i) => match(i, {}, { gameCreation: Date.UTC(year - 2, 10, 1) + i * 3600_000 }));
  rows.push(match(20, { summoner1Id: 11, summoner2Id: 4 }, { gameCreation: Date.UTC(year - 1, 3, 1) }));
  rows.push(...Array.from({ length: 6 }, (_, i) => match(30 + i)));
  const body = (await harness(rows).run()).body;
  assert.equal(body.score, 88);
  const dates = body.evidence.flatMap((e) => Object.values(e.comparison).flatMap((group) => group.matches.map((m) => m.date.slice(0, 4))));
  for (const value of [year - 2, year - 1, year]) assert.ok(dates.includes(String(value)));
});

test('same-champion same-item shift is not filtered by queue or role', async () => {
  const rows = Array.from({ length: 6 }, (_, i) => match(i, i < 3 ? {} : { item0: 3152, item1: 0, teamPosition: 'MIDDLE' }, { queueId: i < 3 ? 420 : 440 }));
  const body = (await harness(rows).run()).body;
  assert.equal(body.score, 38);
  const e = body.evidence.find((e) => e.title === 'SAME-CHAMPION ITEM SLOT REGIME CHANGE');
  assert.ok(e.comparison.baseline.matches.every((m) => m.players.find((p) => p.isTarget).items[1] === 3152));
  assert.ok(e.comparison.changed.matches.every((m) => m.players.find((p) => p.isTarget).items[0] === 3152));
});

test('interleaved cross-queue Flash and item habits reach the combined tier', async () => {
  const rows = Array.from({ length: 16 }, (_, i) => match(i, i % 2 ? { item0: 3152, item1: 0, summoner1Id: 11, summoner2Id: 4 } : {}, { queueId: i % 2 ? 440 : 420 }));
  const body = (await harness(rows).run()).body;
  assert.equal(body.score, 88);
  const e = body.evidence.find((e) => e.title === 'SAME-CHAMPION ITEM SLOT REGIME CHANGE');
  assert.match(e.detail, /Solo\/Duo.*Flex/);
  assert.equal(e.comparison.baseline.matches.length, 8); assert.equal(e.comparison.changed.matches.length, 8);
});

test('different builds and duplicate item copies are not position changes', async () => {
  const rows = Array.from({ length: 12 }, (_, i) => match(i, i < 6 ? { item0: 3152 } : { item0: 3089, item1: 3089 }));
  const body = (await harness(rows).run()).body;
  assert.ok(body.evidence.every((e) => e.title !== 'SAME-CHAMPION ITEM SLOT REGIME CHANGE'));
});

test('combined tier does not add an unrequested 45-day co-occurrence gate', async () => {
  const rows = Array.from({ length: 12 }, (_, i) => match(i, i < 6 ? {} : { summoner1Id: 11, summoner2Id: 4 }));
  rows.push(...Array.from({ length: 12 }, (_, i) => match(100 + i, { summoner1Id: 11, summoner2Id: 4, ...(i < 6 ? {} : { item0: 3152, item1: 0 }) }, { gameCreation: baseDate + (100 + i) * 86400_000 })));
  assert.equal((await harness(rows).run()).body.score, 88);
});

function runeVariant() {
  const perks = player().perks;
  return { ...perks, styles: [perks.styles[0], { style: 8300, selections: [{ perk: 8345 }, { perk: 8347 }] }] };
}

test('uneven same-patch A-B-A rune loop is found at actual change points', async () => {
  const rows = Array.from({ length: 18 }, (_, i) => match(i, i >= 12 && i < 15 ? { perks: runeVariant(), win: true, kills: 20 } : { win: false }));
  const body = (await harness(rows).run()).body;
  const e = body.evidence.find((e) => e.title === 'SAME-PATCH RUNE PERFORMANCE LOOP'); assert.ok(e);
  assert.deepEqual(e.comparison.changed.matches.map((m) => m.gameId), rows.slice(12, 15).map((m) => m.metadata.matchId));
  assert.equal(e.comparison.baseline.matches.length, 15);
  assert.ok(e.detail.includes('Biscuit Delivery'));
});

test('a patch change or a one-way rune meta adoption is not an A-B-A loop', async () => {
  const rows = Array.from({ length: 18 }, (_, i) => match(i, i >= 6 && i < 12 ? { perks: runeVariant(), kills: 20, win: true } : { win: false }, { gameVersion: i < 6 ? '26.1.1' : i < 12 ? '26.2.1' : '26.3.1' }));
  const oneWay = Array.from({ length: 18 }, (_, i) => match(i, i >= 6 ? { perks: runeVariant(), kills: 20 } : {}));
  for (const data of [rows, oneWay]) {
    const body = (await harness(data).run()).body;
    assert.ok(body.evidence.every((e) => e.title !== 'SAME-PATCH RUNE PERFORMANCE LOOP'));
  }
});

test('secondary rune ordering alone is not a different rune choice', async () => {
  const reversed = player().perks;
  reversed.styles[1].selections.reverse();
  const rows = Array.from({ length: 18 }, (_, i) => match(i, i >= 6 && i < 12 ? { perks: reversed, win: true, kills: 20 } : { win: false }));
  const body = (await harness(rows).run()).body;
  assert.ok(body.evidence.every((e) => e.title !== 'SAME-PATCH RUNE PERFORMANCE LOOP'));
});

test('Flex wins do not qualify rune loops, but Flex personal-performance loops can', async () => {
  const create = (performance) => Array.from({ length: 18 }, (_, i) => match(i, i >= 6 && i < 12 ? { perks: runeVariant(), win: true, ...(performance ? { kills: 20 } : {}) } : { win: false }, { queueId: 440 }));
  const winsOnly = (await harness(create(false)).run()).body;
  assert.ok(winsOnly.evidence.every((e) => e.title !== 'SAME-PATCH RUNE PERFORMANCE LOOP'));
  const personal = (await harness(create(true)).run()).body;
  assert.ok(personal.evidence.some((e) => e.title === 'SAME-PATCH RUNE PERFORMANCE LOOP'));
});

test('KDA separates queues, retains Flex evidence and does not reset every patch', async () => {
  const separate = Array.from({ length: 32 }, (_, i) => match(i, { kills: i < 16 ? 4 : 20 }, { queueId: i < 16 ? 420 : 440 }));
  assert.ok((await harness(separate).run()).body.evidence.every((e) => e.title !== 'KDA REGIME CHANGE'));
  const withinFlex = Array.from({ length: 32 }, (_, i) => match(i, { kills: i < 16 ? 4 : 20 }, { queueId: 440, gameVersion: i < 16 ? '26.1.1' : '26.2.1' }));
  const body = (await harness(withinFlex).run()).body;
  const e = body.evidence.find((e) => e.title === 'KDA REGIME CHANGE'); assert.ok(e);
  assert.equal(body.score, 38);
  assert.ok(Object.values(e.comparison).every((group) => group.matches.every((m) => m.queue === 'FLEX')));
});

test('a KDA outlier, high-baseline small delta and familiar volatility are not sustained shifts', async () => {
  const data = [
    Array.from({ length: 40 }, (_, i) => match(i, { kills: i === 25 ? 300 : 4 })),
    Array.from({ length: 40 }, (_, i) => match(i, { kills: i < 20 ? 14 : 17 })),
    Array.from({ length: 40 }, (_, i) => match(i, { kills: i % 2 ? 30 : 1 })),
  ];
  for (const rows of data) assert.ok((await harness(rows).run()).body.evidence.every((e) => e.title !== 'KDA REGIME CHANGE'));
});

test('routine win variance is not promoted by choosing the best window', async () => {
  const rows = Array.from({ length: 160 }, (_, i) => match(i, { win: i % 4 < (i >= 60 && i < 80 ? 3 : 2) }));
  const body = (await harness(rows).run()).body;
  assert.ok(body.evidence.every((e) => e.title !== 'WIN-RATE REGIME CHANGE'));
});

test('role alone remains in the low tier', async () => {
  const rows = Array.from({ length: 24 }, (_, i) => match(i, { teamPosition: i < 12 ? 'JUNGLE' : 'MIDDLE' }));
  const body = (await harness(rows).run()).body;
  assert.equal(body.score, 22);
  assert.ok(body.evidence.some((e) => e.title === 'ROLE HABIT SHIFT'));
});
