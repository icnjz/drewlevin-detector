import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

 
function client({ key = "development-test-token", respond } = {}) {
  let clock = 0;
  const calls = [];
  class Clock extends Date { static now() { return clock; } }
  const loadedModule = { exports: {} };
  const context = vm.createContext({
    module: loadedModule, exports: loadedModule.exports, URL, Response, AbortSignal, Date: Clock,
    process: { env: key === null ? {} : { RIOT_API_KEY: key } },
    setTimeout: (callback, delay) => { clock += delay; queueMicrotask(callback); },
    fetch: async (url, options) => {
      const call = { url, options, at: clock };
      calls.push(call);
      return respond ? respond(call, calls.length) : Response.json({ ok: true });
    },
  });
  const source = readFileSync(new URL("../lib/riot.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  } }).outputText;
  vm.runInContext(compiled, context);
  return { request: loadedModule.exports.riotJson, calls };
}

const matchUrl = "https://americas.api.riotgames.com/lol/match/v5/matches/NA1_123";

test("missing or multiple tokens fail before sending a request", async () => {
  for (const key of [null, "", "one,two", "one;two", "one two"]) {
    const api = client({ key });
    await assert.rejects(api.request(matchUrl), /RIOT_API_KEY/);
    assert.equal(api.calls.length, 0);
  }
});

test("concurrent requests share one token and a paced routing queue", async () => {
  const api = client();
  const results = await Promise.all([1, 2, 3].map(() => api.request(matchUrl)));
  assert.deepEqual(api.calls.map((call) => call.at), [0, 1300, 2600]);
  assert.ok(api.calls.every((call) => call.options.headers["X-Riot-Token"] === "development-test-token"));
  assert.ok(results.every((result) => result.ok && !Object.hasOwn(result, "key")));
});

test("platform and regional routing values have independent pacing", async () => {
  const api = client();
  await api.request(matchUrl);
  await api.request("https://na1.api.riotgames.com/lol/league/v4/entries/by-puuid/account");
  assert.deepEqual(api.calls.map((call) => call.at), [0, 0]);
});

test("429 Retry-After also holds queued requests until the cooldown ends", async () => {
  const api = client({ respond: (_call, count) => count === 1
    ? new Response(null, { status: 429, headers: { "Retry-After": "2" } })
    : Response.json({ ok: true }) });
  await Promise.all([api.request(matchUrl), api.request(`${matchUrl}4`)]);
  assert.deepEqual(api.calls.map((call) => call.at), [0, 2000, 3300]);
  assert.deepEqual(api.calls.map((call) => call.url), [matchUrl, matchUrl, `${matchUrl}4`]);
});

test("authentication failure makes one attempt and releases the request queue", async () => {
  for (const status of [401, 403]) {
    const api = client({ respond: () => new Response(null, { status }) });
    await assert.rejects(api.request(matchUrl), new RegExp(String(status)));
    assert.equal(api.calls.length, 1);
    await assert.rejects(api.request(matchUrl), new RegExp(String(status)));
    assert.equal(api.calls.length, 2);
  }
});

test("transient failures retry with the same token and stay bounded", async () => {
  const api = client({ respond: () => new Response(null, { status: 503 }) });
  await assert.rejects(api.request(matchUrl), /503/);
  assert.equal(api.calls.length, 3);
  assert.deepEqual(api.calls.map((call) => call.at), [0, 1300, 2600]);
});

test("network errors do not echo a token, and unrelated hosts receive no token", async () => {
  const key = "development-test-token";
  const api = client({ key, respond: () => { throw new Error(`upstream ${key}`); } });
  await assert.rejects(api.request(matchUrl), (error) => !error.message.includes(key));
  assert.equal(api.calls.length, 3);
  const foreign = client();
  await assert.rejects(foreign.request("https://example.com/"), /Invalid Riot API endpoint/);
  assert.equal(foreign.calls.length, 0);
});
