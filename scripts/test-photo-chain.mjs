import { createRequire } from 'module';
const require = createRequire(import.meta.url);
require('./load-env.js');

const GOOGLE_KEY = process.env.GOOGLE_PLACES_API_KEY;

async function fetchWikipediaPhoto(cityName, country) {
  const queries = [
    country ? `${cityName}, ${country}` : null,
    cityName,
  ].filter(Boolean);

  for (const q of queries) {
    const url = 'https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(q);
    const r = await fetch(url, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'LocalsApp/1.0' },
      redirect: 'follow',
    });
    const d = await r.json();
    if (d.originalimage?.source) {
      return d.originalimage.source.replace(/\/\d+px-/, '/1200px-');
    }
  }
  return null;
}

async function fetchGooglePlacesPhoto(cityName) {
  const autocompleteUrl = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(cityName)}&types=(cities)&language=pt-BR&key=${GOOGLE_KEY}`;
  const r = await fetch(autocompleteUrl);
  const d = await r.json();
  const placeId = d.predictions?.[0]?.place_id;
  if (!placeId) return null;

  const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=photos&key=${GOOGLE_KEY}`;
  const r2 = await fetch(detailsUrl);
  const d2 = await r2.json();
  const photoRef = d2.result?.photos?.[0]?.photo_reference;
  if (!photoRef) return null;

  return `https://maps.googleapis.com/maps/api/place/photo?maxwidth=1200&photo_reference=${photoRef}&key=${GOOGLE_KEY}`;
}

const testCases = [
  { name: 'Paris', country: 'France' },
  { name: 'Tokyo', country: 'Japan' },
  { name: 'Bariloche', country: 'Argentina' },
  { name: 'Nazaré', country: 'Portugal' },
  { name: 'Hallstatt', country: 'Austria' },
  { name: 'Chefchaouen', country: 'Morocco' },
  { name: 'Kotor', country: 'Montenegro' },
  { name: 'Tbilisi', country: 'Georgia' },
  { name: 'Luang Prabang', country: 'Laos' },
  { name: 'Colonia del Sacramento', country: 'Uruguay' },
  { name: 'Alberobello', country: 'Italy' },
  { name: 'Sintra', country: 'Portugal' },
];

console.log('Testing photo fallback chain for', testCases.length, 'destinations...\n');

for (const { name, country } of testCases) {
  // Layer 1: Google Places photo (via autocomplete + details)
  let source = 'google-places';
  let url = await fetchGooglePlacesPhoto(name).catch(() => null);

  // Layer 2: Wikipedia photo
  if (!url) {
    source = 'wikipedia';
    url = await fetchWikipediaPhoto(name, country).catch(() => null);
  }

  // Layer 3: Default fallback
  if (!url) {
    source = 'DEFAULT-FALLBACK';
    url = 'https://images.unsplash.com/photo-1488085061387-422e29b40080?w=1200';
  }

  console.log(`${name}: [${source}] ${url ? url.substring(0, 70) + '...' : 'NONE'}`);
}
