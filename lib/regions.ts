export const REGION_CONFIGS = {
  NA1: { code: "NA1", label: "NA", platform: "na1", routing: "americas", opgg: "na" },
  BR1: { code: "BR1", label: "BR", platform: "br1", routing: "americas", opgg: "br" },
  LA1: { code: "LA1", label: "LA1", platform: "la1", routing: "americas", opgg: "lan" },
  LA2: { code: "LA2", label: "LA2", platform: "la2", routing: "americas", opgg: "las" },
  EUW1: { code: "EUW1", label: "EUW1", platform: "euw1", routing: "europe", opgg: "euw" },
  EUN1: { code: "EUN1", label: "EUN1", platform: "eun1", routing: "europe", opgg: "eune" },
  TR1: { code: "TR1", label: "TR1", platform: "tr1", routing: "europe", opgg: "tr" },
} as const;

export type RegionCode = keyof typeof REGION_CONFIGS;
export type RegionConfig = (typeof REGION_CONFIGS)[RegionCode];

export const REGION_OPTIONS = Object.values(REGION_CONFIGS);

const REGION_ALIASES: Record<string, RegionCode> = {
  NA: "NA1",
  BR: "BR1",
  LAN: "LA1",
  LAS: "LA2",
  EUW: "EUW1",
  EUNE: "EUN1",
  TR: "TR1",
};

export function normalizeRegion(value: string | null | undefined): RegionCode | null {
  const normalized = (value ?? "").trim().toUpperCase();
  if (!normalized) return "NA1";
  const aliased = REGION_ALIASES[normalized] ?? normalized;
  return Object.hasOwn(REGION_CONFIGS, aliased) ? aliased as RegionCode : null;
}

export function regionConfig(value: string | null | undefined): RegionConfig | null {
  const code = normalizeRegion(value);
  return code ? REGION_CONFIGS[code] : null;
}

export function regionForMatchId(matchId: string): RegionConfig | null {
  return regionConfig(matchId.split("_", 1)[0]);
}

export function scanKey(region: RegionCode, riotId: string) {
  return `${region}:${riotId.trim().toLowerCase()}`;
}
