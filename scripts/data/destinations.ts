/**
 * Seed list of destinations for the curated-places catalog, in generation
 * priority order. `--pilot` (see scripts/curate-destinations.ts) runs only
 * the first PILOT_SIZE entries.
 */

export type DestinationTier = "mega" | "large" | "medium" | "small";
export type DestinationStatus = "active" | "inactive";

export interface DestinationSeed {
  slug: string;
  nameEn: string;
  namePt: string;
  countryCode: string;
  tier: DestinationTier;
  /** Defaults to "active" when omitted. */
  status?: DestinationStatus;
}

/** Full country name (English) per ISO 3166-1 alpha-2 code, for the `country` column. */
export const COUNTRY_NAMES: Record<string, string> = {
  GB: "United Kingdom",
  FR: "France",
  TR: "Turkey",
  IT: "Italy",
  ES: "Spain",
  NL: "Netherlands",
  PT: "Portugal",
  AT: "Austria",
  CZ: "Czech Republic",
  DE: "Germany",
  GR: "Greece",
  IE: "Ireland",
  HU: "Hungary",
  CH: "Switzerland",
  AE: "United Arab Emirates",
  SA: "Saudi Arabia",
  EG: "Egypt",
  MA: "Morocco",
  ZA: "South Africa",
  QA: "Qatar",
  US: "United States",
  CA: "Canada",
  MX: "Mexico",
  DO: "Dominican Republic",
  PR: "Puerto Rico",
  BR: "Brazil",
  AR: "Argentina",
  TH: "Thailand",
  HK: "Hong Kong",
  MO: "Macau",
  JP: "Japan",
  SG: "Singapore",
};

export const DESTINATIONS: DestinationSeed[] = [
  { slug: "london-gb", nameEn: "London", namePt: "Londres", countryCode: "GB", tier: "mega" },
  { slug: "paris-fr", nameEn: "Paris", namePt: "Paris", countryCode: "FR", tier: "mega" },
  { slug: "istanbul-tr", nameEn: "Istanbul", namePt: "Istambul", countryCode: "TR", tier: "mega" },
  { slug: "rome-it", nameEn: "Rome", namePt: "Roma", countryCode: "IT", tier: "mega" },
  { slug: "madrid-es", nameEn: "Madrid", namePt: "Madri", countryCode: "ES", tier: "large" },
  { slug: "barcelona-es", nameEn: "Barcelona", namePt: "Barcelona", countryCode: "ES", tier: "large" },
  { slug: "milan-it", nameEn: "Milan", namePt: "Milão", countryCode: "IT", tier: "large" },
  { slug: "amsterdam-nl", nameEn: "Amsterdam", namePt: "Amsterdã", countryCode: "NL", tier: "large" },
  { slug: "lisbon-pt", nameEn: "Lisbon", namePt: "Lisboa", countryCode: "PT", tier: "large" },
  { slug: "vienna-at", nameEn: "Vienna", namePt: "Viena", countryCode: "AT", tier: "large" },
  { slug: "prague-cz", nameEn: "Prague", namePt: "Praga", countryCode: "CZ", tier: "large" },
  { slug: "berlin-de", nameEn: "Berlin", namePt: "Berlim", countryCode: "DE", tier: "large" },
  { slug: "athens-gr", nameEn: "Athens", namePt: "Atenas", countryCode: "GR", tier: "large" },
  { slug: "venice-it", nameEn: "Venice", namePt: "Veneza", countryCode: "IT", tier: "large" },
  { slug: "florence-it", nameEn: "Florence", namePt: "Florença", countryCode: "IT", tier: "large" },
  { slug: "dublin-ie", nameEn: "Dublin", namePt: "Dublin", countryCode: "IE", tier: "large" },
  { slug: "edinburgh-gb", nameEn: "Edinburgh", namePt: "Edimburgo", countryCode: "GB", tier: "large" },
  { slug: "budapest-hu", nameEn: "Budapest", namePt: "Budapeste", countryCode: "HU", tier: "large" },
  { slug: "nice-fr", nameEn: "Nice", namePt: "Nice", countryCode: "FR", tier: "large" },
  { slug: "zurich-ch", nameEn: "Zurich", namePt: "Zurique", countryCode: "CH", tier: "large" },
  { slug: "dubai-ae", nameEn: "Dubai", namePt: "Dubai", countryCode: "AE", tier: "large" },
  { slug: "mecca-sa", nameEn: "Mecca", namePt: "Meca", countryCode: "SA", tier: "large", status: "inactive" },
  { slug: "antalya-tr", nameEn: "Antalya", namePt: "Antália", countryCode: "TR", tier: "large" },
  { slug: "abu-dhabi-ae", nameEn: "Abu Dhabi", namePt: "Abu Dhabi", countryCode: "AE", tier: "large" },
  { slug: "riyadh-sa", nameEn: "Riyadh", namePt: "Riad", countryCode: "SA", tier: "large" },
  { slug: "cairo-eg", nameEn: "Cairo", namePt: "Cairo", countryCode: "EG", tier: "large" },
  { slug: "marrakech-ma", nameEn: "Marrakech", namePt: "Marrakech", countryCode: "MA", tier: "large" },
  { slug: "cape-town-za", nameEn: "Cape Town", namePt: "Cidade do Cabo", countryCode: "ZA", tier: "large" },
  { slug: "johannesburg-za", nameEn: "Johannesburg", namePt: "Joanesburgo", countryCode: "ZA", tier: "large" },
  { slug: "doha-qa", nameEn: "Doha", namePt: "Doha", countryCode: "QA", tier: "large" },
  { slug: "new-york-us", nameEn: "New York", namePt: "Nova York", countryCode: "US", tier: "mega" },
  { slug: "miami-us", nameEn: "Miami", namePt: "Miami", countryCode: "US", tier: "large" },
  { slug: "orlando-us", nameEn: "Orlando", namePt: "Orlando", countryCode: "US", tier: "large" },
  { slug: "los-angeles-us", nameEn: "Los Angeles", namePt: "Los Angeles", countryCode: "US", tier: "large" },
  { slug: "las-vegas-us", nameEn: "Las Vegas", namePt: "Las Vegas", countryCode: "US", tier: "large" },
  { slug: "san-francisco-us", nameEn: "San Francisco", namePt: "São Francisco", countryCode: "US", tier: "large" },
  { slug: "toronto-ca", nameEn: "Toronto", namePt: "Toronto", countryCode: "CA", tier: "large" },
  { slug: "vancouver-ca", nameEn: "Vancouver", namePt: "Vancouver", countryCode: "CA", tier: "large" },
  { slug: "mexico-city-mx", nameEn: "Mexico City", namePt: "Cidade do México", countryCode: "MX", tier: "large" },
  { slug: "cancun-mx", nameEn: "Cancún", namePt: "Cancún", countryCode: "MX", tier: "large" },
  { slug: "punta-cana-do", nameEn: "Punta Cana", namePt: "Punta Cana", countryCode: "DO", tier: "large" },
  { slug: "san-juan-pr", nameEn: "San Juan", namePt: "San Juan", countryCode: "PR", tier: "large" },
  { slug: "rio-de-janeiro-br", nameEn: "Rio de Janeiro", namePt: "Rio de Janeiro", countryCode: "BR", tier: "large" },
  { slug: "sao-paulo-br", nameEn: "São Paulo", namePt: "São Paulo", countryCode: "BR", tier: "large" },
  { slug: "buenos-aires-ar", nameEn: "Buenos Aires", namePt: "Buenos Aires", countryCode: "AR", tier: "large" },
  { slug: "bangkok-th", nameEn: "Bangkok", namePt: "Bangkok", countryCode: "TH", tier: "large" },
  { slug: "hong-kong-hk", nameEn: "Hong Kong", namePt: "Hong Kong", countryCode: "HK", tier: "large" },
  { slug: "macau-mo", nameEn: "Macau", namePt: "Macau", countryCode: "MO", tier: "large" },
  { slug: "tokyo-jp", nameEn: "Tokyo", namePt: "Tóquio", countryCode: "JP", tier: "mega" },
  { slug: "singapore-sg", nameEn: "Singapore", namePt: "Singapura", countryCode: "SG", tier: "large" },
];

/** Number of leading entries that `--pilot` operates on. */
export const PILOT_SIZE = 5;

export function getPilotDestinations(): DestinationSeed[] {
  return DESTINATIONS.slice(0, PILOT_SIZE);
}

export function getDestinationsBySlug(slugs: string[]): DestinationSeed[] {
  const bySlug = new Map(DESTINATIONS.map((d) => [d.slug, d]));
  return slugs.map((slug) => {
    const found = bySlug.get(slug);
    if (!found) throw new Error(`Unknown destination slug: "${slug}"`);
    return found;
  });
}

export function countryNameFor(countryCode: string): string {
  return COUNTRY_NAMES[countryCode] ?? countryCode;
}
