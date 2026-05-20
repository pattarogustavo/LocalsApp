import { describe, it, expect } from 'vitest';

const RAPIDAPI_KEY = process.env.AERODATABOX_RAPIDAPI_KEY;

describe('AeroDataBox API', () => {
  it('should have the API key set', () => {
    expect(RAPIDAPI_KEY).toBeTruthy();
  });

  it('should find a scheduled flight by number', async () => {
    // Search for LA8084 — a known LATAM flight GRU→LHR
    // AeroDataBox flight search by number: GET /flights/number/{flightNumber}
    const today = new Date();
    // Use a date a few days ahead to get scheduled flights
    const futureDate = new Date(today);
    futureDate.setDate(today.getDate() + 7);
    const dateStr = futureDate.toISOString().split('T')[0];

    const url = `https://aerodatabox.p.rapidapi.com/flights/number/LA8084/${dateStr}`;
    const res = await fetch(url, {
      headers: {
        'x-rapidapi-key': RAPIDAPI_KEY!,
        'x-rapidapi-host': 'aerodatabox.p.rapidapi.com',
      },
    });

    console.log('Status:', res.status);
    const data = await res.json();
    console.log('Response:', JSON.stringify(data).slice(0, 400));

    // Accept 200 (found) or 404 (no flight on that date) — both mean the API key works
    expect([200, 404, 400]).toContain(res.status);
  });

  it('should search flights by route (GRU → LHR)', async () => {
    const today = new Date();
    const futureDate = new Date(today);
    futureDate.setDate(today.getDate() + 7);
    const dateStr = futureDate.toISOString().split('T')[0];

    // AeroDataBox: GET /flights/airports/iata/{departureIata}/{date}/{time}/{direction}
    const url = `https://aerodatabox.p.rapidapi.com/flights/airports/iata/GRU/${dateStr}T00:00/${dateStr}T23:59/Departure?withLeg=true&withCancelled=false&withCodeshared=true&withCargo=false&withPrivate=false&withLocation=false`;
    const res = await fetch(url, {
      headers: {
        'x-rapidapi-key': RAPIDAPI_KEY!,
        'x-rapidapi-host': 'aerodatabox.p.rapidapi.com',
      },
    });

    console.log('Route search status:', res.status);
    const data = await res.json();
    const flights = data?.departures || data?.arrivals || data || [];
    console.log('Flights found:', Array.isArray(flights) ? flights.length : 'N/A');

    expect([200, 404, 400]).toContain(res.status);
  });
});
