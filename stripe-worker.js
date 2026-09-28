// Deploy separately as a Cloudflare Worker. Never put STRIPE_SECRET_KEY in GitHub Pages.
const SHOP = 'https://vapes4all.co.uk';
const ALLOWED_ORIGINS = new Set([SHOP, 'https://www.vapes4all.co.uk']);
const DOJO = [
  'Lemon Cola', 'Vimberry', 'Cherry Cola', 'Ten Tangerines', 'Pineapple Ice',
  'Blue Razz Lemonade', 'Banana Ice', 'Lemon Lime', 'Cool Menthol', 'Triple Mango',
  'Pink Lemonade', 'Fizzy Cherry', 'Juicy Peach', 'Black Grape', 'Huba',
  'Strawberry Ice', 'Double Apple', 'Watermelon Ice', 'Blueberry Sour Raspberry',
  'Strawberry Raspberry Cherry Ice', 'Fizzy Bru', 'Pineapple Peach Mango'
];
const IVG = [
  'Lemon and Lime', 'Frozen Cherry', 'Classic Menthol', 'Fizzy Cherry',
  'Blue Raspberry Ice', 'Blue Sour Raspberry', 'Frozen Watermelon',
  'Blue Raz Lemonade', 'Pineapple Ice', 'Watermelon Strawberry'
];
const SMARTER_PODS = [
  'Lemon & Lime', 'Watermelon Ice', 'Cherry Ice', 'Blueberry Ice',
  'Wild Berries', 'Pineapple Ice'
];
const SMARTER_KITS = ['Watermelon Ice', 'Pineapple Ice', 'Lemon & Lime'];

function catalog() {
  const items = new Map();
  for (const flavour of DOJO) {
    items.set('Dojo Unit — ' + flavour, { kind: 'unit', flavour, price: 699 });
    items.set('Dojo Pods — ' + flavour, { kind: 'pod', flavour, price: 499 });
  }
  for (const flavour of IVG) items.set('IVG 10K - ' + flavour, { kind: 'ivg', flavour, price: 499 });
  for (const flavour of SMARTER_PODS) items.set('Smarter Mini Pod Pack (2 pods) — ' + flavour, { kind: 'smarterPod', flavour, price: 50 });
  for (const flavour of SMARTER_KITS) items.set('Smarter Mini Starter Kit — ' + flavour, { kind: 'smarterKit', flavour, price: 100 });
  return items;
}

function priceBasket(basket) {
  if (!Array.isArray(basket) || !basket.length || basket.length > 100) throw new Error('Invalid basket.');
  const known = catalog();
  const merged = new Map();
  let count = 0;
  for (const entry of basket) {
    if (!entry || typeof entry.name !== 'string' || !known.has(entry.name) || !Number.isInteger(entry.qty) || entry.qty < 1 || entry.qty > 100) {
      throw new Error('The basket contains an invalid item or quantity.');
    }
    count += entry.qty;
    if (count > 100) throw new Error('Too many items in this basket.');
    merged.set(entry.name, (merged.get(entry.name) || 0) + entry.qty);
  }
  const units = [], pods = [], lines = [];
  for (const [name, qty] of merged) {
    const item = known.get(name);
    if (item.kind === 'unit' || item.kind === 'pod') {
      const group = item.kind === 'unit' ? units : pods;
      for (let i = 0; i < qty; i++) group.push(item.flavour);
    } else lines.push({ name, quantity: qty, unit_amount: item.price });
  }
  function addDeals(group, size, dealPrice, unitPrice, label) {
    while (group.length >= size) {
      const flavours = group.splice(0, size);
      lines.push({ name: label + ' mix & match (' + size + ')', description: flavours.join(', '), quantity: 1, unit_amount: dealPrice });
    }
    for (const flavour of group) lines.push({ name: label + ' — ' + flavour, quantity: 1, unit_amount: unitPrice });
  }
  addDeals(units, 3, 1299, 699, 'Dojo Units');
  addDeals(pods, 6, 2000, 499, 'Dojo Pods');
  const subtotal = lines.reduce((sum, line) => sum + line.quantity * line.unit_amount, 0);
  return { lines, subtotal };
}

function json(data, status = 200, origin = '') {
  return new Response(JSON.stringify(data), { status, headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...(ALLOWED_ORIGINS.has(origin) ? { 'access-control-allow-origin': origin, 'vary': 'Origin' } : {})
  }});
}

async function stripe(path, key, options = {}) {
  const response = await fetch('https://api.stripe.com/v1/' + path, {
    ...options, headers: { authorization: 'Bearer ' + key, ...(options.body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'Stripe could not start checkout.');
  return data;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const pathname = new URL(request.url).pathname;
    if (request.method === 'OPTIONS' && pathname === '/create-checkout-session') {
      if (!ALLOWED_ORIGINS.has(origin)) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: {
        'access-control-allow-origin': origin, 'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': 'content-type', 'vary': 'Origin'
      }});
    }
    if (pathname === '/session-status' && request.method === 'GET') {
      if (!ALLOWED_ORIGINS.has(origin)) return json({ error: 'Origin not allowed.' }, 403);
      const id = new URL(request.url).searchParams.get('id') || '';
      if (!/^cs_(test_|live_)[A-Za-z0-9]+$/.test(id)) return json({ error: 'Invalid session.' }, 400, origin);
      try {
        const session = await stripe('checkout/sessions/' + id, env.STRIPE_SECRET_KEY);
        return json({ paid: session.payment_status === 'paid', pending: session.status === 'complete' && session.payment_status !== 'paid' }, 200, origin);
      } catch { return json({ error: 'Could not check payment.' }, 502, origin); }
    }
    if (pathname !== '/create-checkout-session' || request.method !== 'POST') return json({ error: 'Not found.' }, 404, origin);
    if (!ALLOWED_ORIGINS.has(origin)) return json({ error: 'Origin not allowed.' }, 403);
    if (!env.STRIPE_SECRET_KEY || !/^(sk_test_|sk_live_)/.test(env.STRIPE_SECRET_KEY)) {
      return json({ error: 'Payment service has not been configured.' }, 503, origin);
    }
    const paidShipping = Number(env.PAID_SHIPPING_PENCE);
    if (!Number.isSafeInteger(paidShipping) || paidShipping < 0 || paidShipping > 10000 || env.PAID_SHIPPING_PENCE === undefined) {
      return json({ error: 'Delivery charge has not been configured.' }, 503, origin);
    }
    try {
      if (Number(request.headers.get('content-length')) > 20000) return json({ error: 'Basket too large.' }, 413, origin);
      const body = await request.text();
      if (body.length > 20000) return json({ error: 'Basket too large.' }, 413, origin);
      const { lines, subtotal } = priceBasket(JSON.parse(body).basket);
      const delivery = subtotal >= 2300 ? 0 : paidShipping;
      const params = new URLSearchParams({
        mode: 'payment',
        success_url: SHOP + '/checkout.html?payment=success&session_id={CHECKOUT_SESSION_ID}',
        cancel_url: SHOP + '/checkout.html?payment=cancelled',
        'shipping_address_collection[allowed_countries][0]': 'GB',
        'phone_number_collection[enabled]': 'true',
        'shipping_options[0][shipping_rate_data][type]': 'fixed_amount',
        'shipping_options[0][shipping_rate_data][fixed_amount][amount]': String(delivery),
        'shipping_options[0][shipping_rate_data][fixed_amount][currency]': 'gbp',
        'shipping_options[0][shipping_rate_data][display_name]': 'DPD tracked delivery'
      });
      // Stripe selects eligible, enabled payment methods dynamically. Do not force Klarna.
      for (const [i, line] of lines.entries()) {
        const prefix = 'line_items[' + i + ']';
        params.set(prefix + '[price_data][currency]', 'gbp');
        params.set(prefix + '[price_data][unit_amount]', String(line.unit_amount));
        params.set(prefix + '[price_data][product_data][name]', line.name);
        if (line.description) params.set(prefix + '[price_data][product_data][description]', line.description);
        params.set(prefix + '[quantity]', String(line.quantity));
      }
      const session = await stripe('checkout/sessions', env.STRIPE_SECRET_KEY, { method: 'POST', body: params });
      if (!session.url?.startsWith('https://checkout.stripe.com/')) throw new Error('Stripe did not return a checkout page.');
      return json({ url: session.url, id: session.id }, 200, origin);
    } catch (error) {
      const message = error instanceof SyntaxError ? 'Invalid basket.' : error.message;
      const status = /basket|item|quantity|Too many/.test(message) ? 400 : 502;
      return json({ error: status === 400 ? message : 'Could not start secure payment. Please try again.' }, status, origin);
    }
  }
};

export { priceBasket };
