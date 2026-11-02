 
const REQUEST_INTERVAL_MS = 1_300;
const MAX_ATTEMPTS = 3;

type RoutingState = {
  availableAt: number;
  blockedUntil: number;
  tail: Promise<void>;
};

const routingStates = new Map<string, RoutingState>();

function configuredKey() {
  const key = process.env.RIOT_API_KEY?.trim();
  if (!key) throw new Error("RIOT_API_KEY is not configured");
  if (/[\s,;]/.test(key)) throw new Error("RIOT_API_KEY must contain one token");
  return key;
}

function stateFor(hostname: string) {
  let state = routingStates.get(hostname);
  if (!state) {
    state = { availableAt: 0, blockedUntil: 0, tail: Promise.resolve() };
    routingStates.set(hostname, state);
  }
  return state;
}

function endpointLabel(url: URL) {
  return url.pathname.replace(/\/[A-Za-z0-9_-]{20,}/g, "/:id");
}

function pause(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function retryDelay(header: string | null, attempt: number) {
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds > 0) return seconds * 1_000;
  const date = header ? Date.parse(header) : NaN;
  if (Number.isFinite(date) && date > Date.now()) return date - Date.now();
  return Math.min(30_000, 1_500 * (attempt + 1));
}

 
export async function riotJson<T>(path: string): Promise<T> {
  const key = configuredKey();
  const url = new URL(path);
  if (url.protocol !== "https:" || !/^[a-z0-9]+\.api\.riotgames\.com$/.test(url.host) || url.username || url.password) {
    throw new Error("Invalid Riot API endpoint");
  }

  const state = stateFor(url.hostname);
  const previous = state.tail;
  let release!: () => void;
  state.tail = new Promise<void>((resolve) => { release = resolve; });
  await previous;

  try {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const wait = Math.max(state.availableAt, state.blockedUntil) - Date.now();
      if (wait > 0) await pause(wait);
      state.availableAt = Date.now() + REQUEST_INTERVAL_MS;

      let response: Response;
      try {
        response = await fetch(url.href, {
          headers: { "X-Riot-Token": key },
          cache: "no-store",
          signal: AbortSignal.timeout(20_000),
        });
      } catch {
        if (attempt === MAX_ATTEMPTS - 1) throw new Error(`Riot request failed for ${endpointLabel(url)}`);
        await pause(300 * (attempt + 1));
        continue;
      }

      if (response.ok) return await response.json() as T;

      if (response.status === 429) {
        state.blockedUntil = Date.now() + retryDelay(response.headers.get("Retry-After"), attempt);
        if (attempt < MAX_ATTEMPTS - 1) continue;
      } else if (response.status >= 500 && attempt < MAX_ATTEMPTS - 1) {
        await pause(300 * (attempt + 1));
        continue;
      }

      throw new Error(`Riot returned ${response.status} for ${endpointLabel(url)}`);
    }
    throw new Error("Riot request failed");
  } finally {
    release();
  }
}
