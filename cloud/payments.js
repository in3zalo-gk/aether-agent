const MAX_BODY = 128 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const REF = /^aether:([a-z0-9][a-z0-9_-]{2,31}):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const PAYMENT_STATUSES = new Set(['approved', 'refunded', 'cancelled', 'rejected', 'pending']);
const SUPPORTER_THEMES = new Set(['midnight', 'forest']);

function rejected(reason = 'invalid webhook') {
  return Promise.reject(new Error(reason));
}

async function readJsonBody(req) {
  const declared = Number(req.headers.get('content-length') || 0);
  if (!Number.isFinite(declared) || declared < 0 || declared > MAX_BODY) throw new Error('body too large');
  const reader = req.body?.getReader();
  if (!reader) throw new Error('invalid json');
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY) {
        await reader.cancel();
        throw new Error('body too large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock?.();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let parsed;
  try { parsed = JSON.parse(decoder.decode(bytes)); } catch { throw new Error('invalid json'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid json');
  return parsed;
}

function signaturePart(signature, name) {
  const values = String(signature || '').split(',').map(x => x.trim());
  const prefix = `${name}=`;
  return values.find(x => x.startsWith(prefix))?.slice(prefix.length) || '';
}

function constantTimeHexEqual(actual, expected) {
  if (!/^[0-9a-f]{64}$/i.test(actual)) return false;
  const a = encoder.encode(actual.toLowerCase());
  const b = encoder.encode(expected.toLowerCase());
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] || 0) ^ (b[i] || 0);
  return diff === 0;
}

function paymentAmount(payment) {
  return payment?.transaction_amount ?? payment?.amount;
}

function paymentCurrency(payment) { return payment?.currency_id ?? payment?.currency; }
function paymentMethod(payment) { return payment?.payment_method_id ?? payment?.method; }

/** Verify a Mercado Pago webhook and return its verified payment id. */
export async function verifyWebhook(req, secret, { now = Date.now() } = {}) {
  if (!req || !secret) return rejected();
  const url = new URL(req.url);
  const queryId = url.searchParams.get('data.id');
  const data = await readJsonBody(req);
  const bodyId = data?.data?.id == null ? '' : String(data.data.id);
  if (queryId && bodyId && queryId !== bodyId) return rejected();
  const id = queryId || bodyId;
  const requestId = req.headers.get('x-request-id') || '';
  const signature = req.headers.get('x-signature') || '';
  const ts = signaturePart(signature, 'ts');
  const v1 = signaturePart(signature, 'v1');
  if (!id || !requestId || !ts || !v1 || !/^[0-9]+$/.test(ts)) return rejected();

  const stamp = Number(ts);
  if (!Number.isSafeInteger(stamp)) return rejected();
  const milliseconds = stamp > 1e12 ? stamp : stamp * 1000;
  if (!Number.isFinite(now) || Math.abs(now - milliseconds) > 5 * 60 * 1000) return rejected();

  const key = await crypto.subtle.importKey('raw', encoder.encode(String(secret)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signed = await crypto.subtle.sign('HMAC', key, encoder.encode(`id:${id.toLowerCase()};request-id:${requestId};ts:${ts};`));
  const expected = Array.from(new Uint8Array(signed), byte => byte.toString(16).padStart(2, '0')).join('');
  if (!constantTimeHexEqual(v1, expected)) return rejected();
  return id;
}

/** Apply a provider-confirmed payment to its matching account donation. */
export function reconcilePayment(account, payment) {
  if (!account || !payment || typeof account !== 'object' || typeof payment !== 'object') return false;
  const reference = String(payment.external_reference ?? payment.externalReference ?? '');
  const match = REF.exec(reference);
  const paymentId = payment.id == null ? '' : String(payment.id);
  const status = String(payment.status || '').toLowerCase();
  const amount = paymentAmount(payment);
  const cents = Math.round(Number(amount) * 100);
  const exactCents = Number.isFinite(Number(amount)) && Math.abs(Number(amount) * 100 - cents) < 1e-8;
  if (!match || !paymentId || match[1] !== String(account.username || '') || !PAYMENT_STATUSES.has(status) ||
      paymentCurrency(payment) !== 'BRL' || paymentMethod(payment) !== 'pix' || payment.live_mode !== true ||
      !exactCents || cents <= 0) return false;

  const donations = Array.isArray(account.donations) ? account.donations : (account.donations = []);
  const donation = donations.find(d => d && String(d.id) === match[2]);
  if (!donation || String(donation.providerId ?? donation.provider_id ?? '') !== paymentId || Number(donation.amount) !== cents) return false;

  donation.status = status;
  account.supporter = donations.some(d => d?.status === 'approved');
  if (!account.supporter && SUPPORTER_THEMES.has(account.settings?.theme)) account.settings.theme = 'dark';
  return true;
}

/** Return only payment fields that may be shown to the account owner. */
export function paymentView(donation = {}) {
  return {
    id: donation.id,
    status: donation.status,
    qrCode: donation.qrCode,
    qrImage: donation.qrImage,
    expiresAt: donation.expiresAt,
  };
}
