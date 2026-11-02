export type SpellSlots = { summoner1Id: number; summoner2Id: number };

 
export function flashSlot(player: SpellSlots): 0 | 1 | 2 {
  return player.summoner1Id === 4 ? 1 : player.summoner2Id === 4 ? 2 : 0;
}
export function flashLabel(player: SpellSlots) {
  return flashSlot(player) === 1 ? "D" : flashSlot(player) === 2 ? "F" : "—";
}
export function inventorySlots(player: { item0: number; item1: number; item2: number; item3: number; item4: number; item5: number }) {
  return [player.item0, player.item1, player.item2, player.item3, player.item4, player.item5];
}
export function normalizeRiotId(input: string | null) {
  const parts = input?.split("#").map((part) => part.trim());
  return parts?.length === 2 && parts.every(Boolean) ? parts.join("#") : null;
}
export function seasonSlices(now = Date.now()) {
  const currentYear = new Date(now).getUTCFullYear();
  return [currentYear - 2, currentYear - 1, currentYear].map((year) => ({
    label: String(year), start: Date.UTC(year, 0, 1) / 1000,
    end: year === currentYear ? Math.floor(now / 1000) + 1 : Date.UTC(year + 1, 0, 1) / 1000,
  }));
}
export function flashStats(players: SpellSlots[]) {
  const slots = players.map(flashSlot).filter(Boolean);
  const d = slots.filter((value) => value === 1).length, f = slots.length - d;
  const pct = (count: number) => slots.length ? Math.round(count / slots.length * 1000) / 10 : 0;
  return { flashGames: slots.length, flashDCount: d, flashFCount: f, flashD: pct(d), flashF: pct(f) };
}
