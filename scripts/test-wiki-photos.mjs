const tests = ['Nazare', 'Bariloche', 'Hallstatt', 'Chefchaouen', 'Kotor', 'Tbilisi', 'Luang Prabang', 'Sintra', 'Cappadocia', 'Paris', 'Tokyo'];

const results = await Promise.all(tests.map(async (city) => {
  try {
    const url = 'https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(city);
    const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
    const text = await r.text();
    const d = JSON.parse(text);
    return { city, hasImage: !!d.originalimage?.source, url: (d.originalimage?.source || 'NONE').substring(0, 70) };
  } catch (e) {
    return { city, hasImage: false, url: 'ERROR: ' + e.message };
  }
}));

results.forEach(r => console.log(r.city + ':', r.hasImage ? 'OK - ' + r.url : 'NO IMAGE - ' + r.url));
