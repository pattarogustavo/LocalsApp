import { describe, it, expect } from 'vitest';

const DIRECTIONS_KEY = process.env.GOOGLE_DIRECTIONS_API_KEY || '';

describe('Google Directions API', () => {
  it('should return a valid route between two known points', async () => {
    expect(DIRECTIONS_KEY).toBeTruthy();

    // GRU airport → Paulista Ave (São Paulo) — well-known route
    const origin = '-23.4356,-46.4731';
    const destination = '-23.5614,-46.6565';
    const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${origin}&destination=${destination}&mode=driving&key=${DIRECTIONS_KEY}`;

    const res = await fetch(url);
    expect(res.ok).toBe(true);

    const json = (await res.json()) as any;
    expect(json.status).toBe('OK');
    expect(json.routes?.length).toBeGreaterThan(0);

    const leg = json.routes[0]?.legs?.[0];
    expect(leg?.duration?.value).toBeGreaterThan(0);
    console.log(`Route: ${leg?.duration?.text} / ${leg?.distance?.text}`);
  }, 15000);
});
