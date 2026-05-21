import { config } from "dotenv";
config();

const key = process.env.GOOGLE_PLACES_API_KEY;
console.log("Key found:", !!key);

async function test() {
  for (const query of ["Maiorca", "Mallorca", "Menorca", "Formentera"]) {
    // Test geocode type
    const url = new URL("https://maps.googleapis.com/maps/api/place/autocomplete/json");
    url.searchParams.set("input", query);
    url.searchParams.set("types", "geocode");
    url.searchParams.set("language", "pt-BR");
    url.searchParams.set("key", key);
    const res = await fetch(url.toString());
    const data = await res.json();
    console.log(`\n=== "${query}" (geocode) status: ${data.status} ===`);
    (data.predictions || []).slice(0, 5).forEach((p) => {
      console.log(`  [${(p.types || []).join(", ")}] ${p.description}`);
    });
  }
}

test().catch(console.error);
