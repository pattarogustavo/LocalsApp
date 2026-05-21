/**
 * Curated list of islands, archipelagos and regions that Google Places
 * does not return reliably as standalone destinations.
 * Used as a fallback/supplement in the destination autocomplete.
 */

export interface IslandEntry {
  id: string;
  name: string;           // Display name (pt-BR)
  nameAlt?: string[];     // Alternative names / spellings
  country: string;        // Country or region context
  fullDescription: string;
  lat: number;
  lng: number;
  imageKeyword?: string;  // For hero image matching
}

export const ISLANDS_AND_REGIONS: IslandEntry[] = [
  // ─── Ilhas Baleares (Espanha) ─────────────────────────────────────────────
  {
    id: "mallorca-es",
    name: "Maiorca",
    nameAlt: ["Mallorca", "Majorca"],
    country: "Ilhas Baleares, Espanha",
    fullDescription: "Maiorca, Ilhas Baleares, Espanha",
    lat: 39.6953,
    lng: 3.0176,
    imageKeyword: "mallorca",
  },
  {
    id: "menorca-es",
    name: "Menorca",
    nameAlt: ["Minorca"],
    country: "Ilhas Baleares, Espanha",
    fullDescription: "Menorca, Ilhas Baleares, Espanha",
    lat: 39.9496,
    lng: 4.1156,
    imageKeyword: "menorca",
  },
  {
    id: "ibiza-es",
    name: "Ibiza",
    nameAlt: ["Eivissa"],
    country: "Ilhas Baleares, Espanha",
    fullDescription: "Ibiza, Ilhas Baleares, Espanha",
    lat: 38.9067,
    lng: 1.4206,
    imageKeyword: "ibiza",
  },
  {
    id: "formentera-es",
    name: "Formentera",
    nameAlt: [],
    country: "Ilhas Baleares, Espanha",
    fullDescription: "Formentera, Ilhas Baleares, Espanha",
    lat: 38.7025,
    lng: 1.4519,
    imageKeyword: "formentera",
  },

  // ─── Ilhas Canárias (Espanha) ─────────────────────────────────────────────
  {
    id: "tenerife-es",
    name: "Tenerife",
    nameAlt: ["Teneriffe"],
    country: "Ilhas Canárias, Espanha",
    fullDescription: "Tenerife, Ilhas Canárias, Espanha",
    lat: 28.2916,
    lng: -16.6291,
    imageKeyword: "tenerife",
  },
  {
    id: "gran-canaria-es",
    name: "Gran Canária",
    nameAlt: ["Gran Canaria"],
    country: "Ilhas Canárias, Espanha",
    fullDescription: "Gran Canária, Ilhas Canárias, Espanha",
    lat: 27.9202,
    lng: -15.5474,
    imageKeyword: "gran canaria",
  },
  {
    id: "lanzarote-es",
    name: "Lanzarote",
    nameAlt: [],
    country: "Ilhas Canárias, Espanha",
    fullDescription: "Lanzarote, Ilhas Canárias, Espanha",
    lat: 29.0469,
    lng: -13.5899,
    imageKeyword: "lanzarote",
  },
  {
    id: "fuerteventura-es",
    name: "Fuerteventura",
    nameAlt: [],
    country: "Ilhas Canárias, Espanha",
    fullDescription: "Fuerteventura, Ilhas Canárias, Espanha",
    lat: 28.3587,
    lng: -14.0537,
    imageKeyword: "fuerteventura",
  },
  {
    id: "la-palma-es",
    name: "La Palma",
    nameAlt: [],
    country: "Ilhas Canárias, Espanha",
    fullDescription: "La Palma, Ilhas Canárias, Espanha",
    lat: 28.6835,
    lng: -17.7642,
    imageKeyword: "la palma canarias",
  },

  // ─── Grécia ───────────────────────────────────────────────────────────────
  {
    id: "santorini-gr",
    name: "Santorini",
    nameAlt: ["Thira", "Thera"],
    country: "Ilhas Cíclades, Grécia",
    fullDescription: "Santorini, Ilhas Cíclades, Grécia",
    lat: 36.3932,
    lng: 25.4615,
    imageKeyword: "santorini",
  },
  {
    id: "mykonos-gr",
    name: "Mykonos",
    nameAlt: ["Míconos"],
    country: "Ilhas Cíclades, Grécia",
    fullDescription: "Mykonos, Ilhas Cíclades, Grécia",
    lat: 37.4467,
    lng: 25.3289,
    imageKeyword: "mykonos",
  },
  {
    id: "corfu-gr",
    name: "Corfu",
    nameAlt: ["Córfu", "Kerkyra"],
    country: "Ilhas Jônicas, Grécia",
    fullDescription: "Corfu, Ilhas Jônicas, Grécia",
    lat: 39.6243,
    lng: 19.9217,
    imageKeyword: "corfu",
  },
  {
    id: "rhodes-gr",
    name: "Rodes",
    nameAlt: ["Rhodes", "Rodas"],
    country: "Dodecaneso, Grécia",
    fullDescription: "Rodes, Dodecaneso, Grécia",
    lat: 36.4341,
    lng: 28.2176,
    imageKeyword: "rhodes greece",
  },
  {
    id: "crete-gr",
    name: "Creta",
    nameAlt: ["Crete"],
    country: "Grécia",
    fullDescription: "Creta, Grécia",
    lat: 35.2401,
    lng: 24.8093,
    imageKeyword: "crete",
  },
  {
    id: "zakynthos-gr",
    name: "Zakynthos",
    nameAlt: ["Zante", "Zacinto"],
    country: "Ilhas Jônicas, Grécia",
    fullDescription: "Zakynthos, Ilhas Jônicas, Grécia",
    lat: 37.7902,
    lng: 20.9030,
    imageKeyword: "zakynthos",
  },

  // ─── Itália ───────────────────────────────────────────────────────────────
  {
    id: "sicily-it",
    name: "Sicília",
    nameAlt: ["Sicily", "Sicilia"],
    country: "Itália",
    fullDescription: "Sicília, Itália",
    lat: 37.5999,
    lng: 14.0154,
    imageKeyword: "sicily",
  },
  {
    id: "sardinia-it",
    name: "Sardenha",
    nameAlt: ["Sardinia", "Sardegna"],
    country: "Itália",
    fullDescription: "Sardenha, Itália",
    lat: 40.1209,
    lng: 9.0129,
    imageKeyword: "sardinia",
  },
  {
    id: "capri-it",
    name: "Capri",
    nameAlt: [],
    country: "Campânia, Itália",
    fullDescription: "Capri, Campânia, Itália",
    lat: 40.5500,
    lng: 14.2167,
    imageKeyword: "capri italy",
  },
  {
    id: "ischia-it",
    name: "Ischia",
    nameAlt: [],
    country: "Campânia, Itália",
    fullDescription: "Ischia, Campânia, Itália",
    lat: 40.7308,
    lng: 13.8975,
    imageKeyword: "ischia",
  },

  // ─── Portugal ─────────────────────────────────────────────────────────────
  {
    id: "madeira-pt",
    name: "Madeira",
    nameAlt: ["Ilha da Madeira"],
    country: "Portugal",
    fullDescription: "Madeira, Portugal",
    lat: 32.7607,
    lng: -16.9595,
    imageKeyword: "madeira island",
  },
  {
    id: "azores-pt",
    name: "Açores",
    nameAlt: ["Azores"],
    country: "Portugal",
    fullDescription: "Açores, Portugal",
    lat: 37.7412,
    lng: -25.6756,
    imageKeyword: "azores",
  },

  // ─── França ───────────────────────────────────────────────────────────────
  {
    id: "corsica-fr",
    name: "Córsega",
    nameAlt: ["Corsica", "Corse"],
    country: "França",
    fullDescription: "Córsega, França",
    lat: 42.0396,
    lng: 9.0129,
    imageKeyword: "corsica",
  },

  // ─── Croácia ──────────────────────────────────────────────────────────────
  {
    id: "hvar-hr",
    name: "Hvar",
    nameAlt: [],
    country: "Dalmácia, Croácia",
    fullDescription: "Hvar, Dalmácia, Croácia",
    lat: 43.1729,
    lng: 16.4412,
    imageKeyword: "hvar croatia",
  },
  {
    id: "brac-hr",
    name: "Brač",
    nameAlt: ["Brac"],
    country: "Dalmácia, Croácia",
    fullDescription: "Brač, Dalmácia, Croácia",
    lat: 43.3083,
    lng: 16.6333,
    imageKeyword: "brac croatia",
  },

  // ─── Caribe ───────────────────────────────────────────────────────────────
  {
    id: "maldives",
    name: "Maldivas",
    nameAlt: ["Maldives"],
    country: "Maldivas",
    fullDescription: "Maldivas",
    lat: 3.2028,
    lng: 73.2207,
    imageKeyword: "maldives",
  },
  {
    id: "bali-id",
    name: "Bali",
    nameAlt: [],
    country: "Indonésia",
    fullDescription: "Bali, Indonésia",
    lat: -8.3405,
    lng: 115.0920,
    imageKeyword: "bali",
  },
  {
    id: "phuket-th",
    name: "Phuket",
    nameAlt: [],
    country: "Tailândia",
    fullDescription: "Phuket, Tailândia",
    lat: 7.8804,
    lng: 98.3923,
    imageKeyword: "phuket",
  },
];

/**
 * Search the local islands/regions list by query string.
 * Matches against name, nameAlt and country fields.
 */
export function searchIslands(query: string): IslandEntry[] {
  const q = query.toLowerCase().trim();
  if (q.length < 2) return [];

  return ISLANDS_AND_REGIONS.filter((island) => {
    const nameMatch = island.name.toLowerCase().includes(q);
    const altMatch = island.nameAlt?.some((a) => a.toLowerCase().includes(q));
    const countryMatch = island.country.toLowerCase().includes(q);
    return nameMatch || altMatch || countryMatch;
  }).slice(0, 5);
}
