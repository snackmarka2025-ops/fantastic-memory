// Сервис расчёта цены экспресс-доставки Яндекс для корзины SnackMarka.
// Без зависимостей, Node 18+. Токен Яндекса хранится только в переменных окружения.
import http from 'node:http';

const {
  PORT = 3000,
  YANDEX_TOKEN,
  YANDEX_API = 'https://b2b.taxi.yandex.net',
  YANDEX_GEOCODER_KEY,
  ALLOWED_ORIGIN = 'https://snackmarka.ru',
  // Адрес и координаты склада отправления
  WAREHOUSE_ADDRESS,
  WAREHOUSE_LON,
  WAREHOUSE_LAT,
  DEFAULT_WEIGHT_KG = '1',
} = process.env;

for (const k of ['YANDEX_TOKEN', 'YANDEX_GEOCODER_KEY', 'WAREHOUSE_ADDRESS', 'WAREHOUSE_LON', 'WAREHOUSE_LAT']) {
  if (!process.env[k]) {
    console.error(`Не задана переменная окружения ${k}`);
    process.exit(1);
  }
}

const cors = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...cors });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 10_000) throw new Error('payload too large');
  }
  return JSON.parse(raw || '{}');
}

// Адрес -> координаты (Яндекс Геокодер)
async function geocode(address) {
  const url = new URL('https://geocode-maps.yandex.ru/1.x/');
  url.search = new URLSearchParams({
    apikey: YANDEX_GEOCODER_KEY, geocode: address, format: 'json', results: '1',
  });
  const r = await fetch(url);
  if (!r.ok) throw new Error(`geocoder ${r.status}`);
  const j = await r.json();
  const pos = j.response?.GeoObjectCollection?.featureMember?.[0]?.GeoObject?.Point?.pos;
  if (!pos) return null;
  const [lon, lat] = pos.split(' ').map(Number);
  return { lon, lat };
}

// Расчёт цены: Яндекс Доставка Экспресс (cargo API), метод check-price.
// Формат запроса сверьте с актуальной документацией вашего кабинета.
async function checkPrice(to, weightKg) {
  const body = {
    items: [{
      quantity: 1,
      weight: Number(weightKg),
      pickup_point: 1,
      dropoff_point: 2,
    }],
    route_points: [
      { id: 1, coordinates: [Number(WAREHOUSE_LON), Number(WAREHOUSE_LAT)], fullname: WAREHOUSE_ADDRESS },
      { id: 2, coordinates: [to.lon, to.lat], fullname: to.address },
    ],
    requirements: { taxi_classes: ['express'] },
  };
  const r = await fetch(`${YANDEX_API}/b2b/cargo/integration/v2/check-price`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${YANDEX_TOKEN}`,
      'Accept-Language': 'ru',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`yandex ${r.status}: ${JSON.stringify(j)}`);
  return j; // price: строка в рублях, например "349.5"
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (req.method !== 'POST' || req.url !== '/api/express-price') return send(res, 404, { error: 'not found' });

  try {
    const { address, weightKg } = await readJson(req);
    if (!address || typeof address !== 'string') return send(res, 400, { error: 'Укажите адрес доставки' });

    const point = await geocode(address);
    if (!point) return send(res, 422, { error: 'Не удалось найти адрес' });

    const result = await checkPrice({ ...point, address }, weightKg || DEFAULT_WEIGHT_KG);
    const price = Math.ceil(Number(result.price));
    if (!Number.isFinite(price)) return send(res, 502, { error: 'Яндекс не вернул цену' });

    send(res, 200, { price, currency: 'RUB', distanceKm: result.distance_meters ? +(result.distance_meters / 1000).toFixed(1) : null });
  } catch (e) {
    console.error(e);
    send(res, 500, { error: 'Не удалось рассчитать доставку' });
  }
});

server.listen(PORT, () => console.log(`express-delivery на порту ${PORT}`));
