import { env } from "cloudflare:workers";
export type ScanProgress = {
    phase: "QUEUED" | "SEARCHING SUMMONER" | "CHECKING MOOD" | "REVIEWING" | "PULLING THE RECEIPTS" | "FAILED";
    completed: number;
    total: number;
    queueAhead?: number;
    queueSize?: number;
};
type QueueEntry = {
    id: string;
    lastSeen: number;
};
type ScanState = typeof globalThis & {
    __drewScanProgress?: Map<string, ScanProgress>;
    __drewProgressWriters?: Map<string, {
        writing: boolean;
        latest?: ScanProgress;
    }>;
    __drewScanQueue?: QueueEntry[];
    __drewActiveScans?: Set<string>;
    __drewDetectedAccounts?: number;
    __drewCounterHydration?: Promise<void>;
};
const state = globalThis as ScanState;
export const scanProgress = state.__drewScanProgress ?? (state.__drewScanProgress = new Map<string, ScanProgress>());
const progressWriters = state.__drewProgressWriters ?? (state.__drewProgressWriters = new Map<string, {
    writing: boolean;
    latest?: ScanProgress;
}>());
const scanQueue = state.__drewScanQueue ?? (state.__drewScanQueue = []);
const activeScans = state.__drewActiveScans ?? (state.__drewActiveScans = new Set<string>());
if (state.__drewDetectedAccounts === undefined)
    state.__drewDetectedAccounts = 102;
const MAX_ACTIVE_SCANS = 1;
const QUEUE_STALE_MS = 15000;
const INITIAL_DETECTED_ACCOUNTS = 102;
const DETECTED_ACCOUNTS_KEY = "detected-accounts";
const SCAN_PROGRESS_PREFIX = "scan-progress:";
function counterStore() {
    return env.DETECTOR_STATE;
}
async function hydrateDetectedAccounts() {
    if (!state.__drewCounterHydration) {
        state.__drewCounterHydration = (async () => {
            const store = counterStore();
            if (!store)
                return;
            const saved = Number(await store.get(DETECTED_ACCOUNTS_KEY));
            if (Number.isSafeInteger(saved) && saved >= INITIAL_DETECTED_ACCOUNTS) {
                state.__drewDetectedAccounts = saved;
                return;
            }
            await store.put(DETECTED_ACCOUNTS_KEY, String(state.__drewDetectedAccounts ?? INITIAL_DETECTED_ACCOUNTS));
        })().catch((error) => {
            state.__drewCounterHydration = undefined;
            throw error;
        });
    }
    await state.__drewCounterHydration;
}
export function setScanProgress(id: string, progress: ScanProgress) {
    const key = id.toLowerCase();
    scanProgress.set(key, progress);
    const writer = progressWriters.get(key) ?? { writing: false };
    writer.latest = progress;
    progressWriters.set(key, writer);
    if (writer.writing)
        return;
    writer.writing = true;
    void (async () => {
        try {
            while (writer.latest) {
                const latest = writer.latest;
                writer.latest = undefined;
                await counterStore()?.put(`${SCAN_PROGRESS_PREFIX}${key}`, JSON.stringify(latest));
            }
        }
        catch (error) {
            console.warn("Could not persist scan progress", error);
        }
        finally {
            writer.writing = false;
            if (!writer.latest)
                progressWriters.delete(key);
            else
                setScanProgress(key, writer.latest);
        }
    })();
}
export async function getScanProgress(id: string) {
    const key = id.toLowerCase();
    try {
        const stored = await counterStore()?.get(`${SCAN_PROGRESS_PREFIX}${key}`);
        if (stored) {
            const progress = JSON.parse(stored) as ScanProgress;
            scanProgress.set(key, progress);
            return progress;
        }
    }
    catch (error) {
        console.warn("Could not read persisted scan progress", error);
    }
    return scanProgress.get(key);
}
function refreshQueuedPositions() {
    scanQueue.forEach((entry, index) => setScanProgress(entry.id, {
        phase: "QUEUED",
        completed: 0,
        total: 0,
        queueAhead: activeScans.size + index,
        queueSize: scanQueue.length,
    }));
}
function removeStaleQueueEntries() {
    const cutoff = Date.now() - QUEUE_STALE_MS;
    for (let index = scanQueue.length - 1; index >= 0; index--) {
        if (scanQueue[index].lastSeen < cutoff)
            scanQueue.splice(index, 1);
    }
    refreshQueuedPositions();
}
export function claimScanSlot(id: string) {
    const key = id.toLowerCase();
    removeStaleQueueEntries();
    if (activeScans.has(key))
        return { status: "running" as const };
    let index = scanQueue.findIndex((entry) => entry.id === key);
    if (index < 0) {
        scanQueue.push({ id: key, lastSeen: Date.now() });
        index = scanQueue.length - 1;
    }
    else
        scanQueue[index].lastSeen = Date.now();
    if (activeScans.size < MAX_ACTIVE_SCANS && index === 0) {
        scanQueue.shift();
        activeScans.add(key);
        refreshQueuedPositions();
        let released = false;
        return { status: "claimed" as const, release: () => {
                if (released)
                    return;
                released = true;
                activeScans.delete(key);
                removeStaleQueueEntries();
            } };
    }
    refreshQueuedPositions();
    return { status: "queued" as const, queueAhead: activeScans.size + index, queueSize: scanQueue.length };
}
export async function incrementDetectedAccounts() {
    await hydrateDetectedAccounts();
    state.__drewDetectedAccounts = (state.__drewDetectedAccounts ?? 102) + 1;
    await counterStore()?.put(DETECTED_ACCOUNTS_KEY, String(state.__drewDetectedAccounts));
}
export async function detectorStats() {
    await hydrateDetectedAccounts();
    removeStaleQueueEntries();
    return {
        detectedAccounts: state.__drewDetectedAccounts ?? 102,
        queueSize: scanQueue.length,
        activeScans: activeScans.size,
    };
}
