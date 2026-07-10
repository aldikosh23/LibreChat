const express = require('express');
const { getServerManagedKeyName } = require('librechat-data-provider');
const { createUser, findUser, getUserKey, updateUserKey } = require('~/models');
const { requireJwtAuth } = require('~/server/middleware');
const { setAuthTokens } = require('~/server/services/AuthService');

const router = express.Router();
const DEFAULT_BALANCE_URL = 'https://api.aigate.shop/v1/balance';
const DEFAULT_CLAIM_URL = 'http://localhost:3000/api/chat/sso/claim';
const DEFAULT_API_BASE_URL = 'https://api.aigate.shop/v1';
const DEFAULT_ENDPOINT = 'AIGate';
const AIGATE_ISSUER = 'aigate';
const SSO_CLAIM_TIMEOUT_MS = 5000;
const MAX_SSO_TOKEN_LENGTH = 16 * 1024;

function parseStoredUserKey(rawKey) {
  if (typeof rawKey !== 'string') {
    return null;
  }

  const trimmed = rawKey.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object') {
      return {
        apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey.trim() : '',
        baseURL: typeof parsed.baseURL === 'string' ? parsed.baseURL.trim() : '',
      };
    }
  } catch {}

  return null;
}

function getAigateEndpoint() {
  return String(process.env.AIGATE_ENDPOINT_NAME || DEFAULT_ENDPOINT).trim() || DEFAULT_ENDPOINT;
}

function getSsoSecret() {
  const secret = process.env.LIBRECHAT_SSO_SECRET || process.env.AIGATE_CHAT_SSO_SECRET || '';
  if (secret) {
    return secret;
  }
  if (process.env.NODE_ENV !== 'production') {
    return 'local-dev-chat-sso-secret';
  }
  throw new Error('LIBRECHAT_SSO_SECRET is not configured');
}

function cleanId(value) {
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 80);
}

function cleanName(value, fallback) {
  const clean = String(value || fallback || '')
    .trim()
    .replace(/[^\w.-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 60);
  return clean || fallback;
}

async function claimAigateSession(token) {
  const claimUrl = process.env.AIGATE_SSO_CLAIM_URL || DEFAULT_CLAIM_URL;
  const upstream = await fetch(claimUrl, {
    method: 'POST',
    cache: 'no-store',
    signal: AbortSignal.timeout(SSO_CLAIM_TIMEOUT_MS),
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json',
      'x-aigate-chat-secret': getSsoSecret(),
    },
    body: JSON.stringify({ token }),
  });
  const payload = await upstream.json().catch(() => null);
  if (!upstream.ok || !payload?.success) {
    throw new Error('AIGate SSO claim failed');
  }
  return payload.data;
}

async function findOrCreateAigateUser(aigateUser) {
  const aigateUserId = cleanId(aigateUser?.id);
  if (!aigateUserId) {
    throw new Error('AIGate user id is missing');
  }

  const openidId = `${AIGATE_ISSUER}:${aigateUserId}`;
  const existing = await findUser({ openidId, openidIssuer: AIGATE_ISSUER });
  if (existing) {
    return existing;
  }

  const username = cleanName(aigateUser?.username || aigateUser?.email, `aigate_${aigateUserId}`);
  return await createUser(
    {
      provider: AIGATE_ISSUER,
      email: `aigate-${aigateUserId}@aigate.local`,
      emailVerified: true,
      username,
      name: aigateUser?.display_name || aigateUser?.username || username,
      openidId,
      openidIssuer: AIGATE_ISSUER,
    },
    undefined,
    true,
    true,
  );
}

router.use((_req, res, next) => {
  res.set({
    'Cache-Control': 'private, no-store',
    Pragma: 'no-cache',
    'Referrer-Policy': 'no-referrer',
  });
  next();
});

async function handleSso(req, res) {
  const rawToken = req.method === 'GET' ? req.query?.token : req.body?.token;
  const token = typeof rawToken === 'string' ? rawToken.trim() : '';
  if (!token || token.length > MAX_SSO_TOKEN_LENGTH) {
    return res.status(400).send('invalid sso token');
  }

  try {
    const claim = await claimAigateSession(token);
    const user = await findOrCreateAigateUser(claim.user);
    const endpoint = getAigateEndpoint();
    const apiKey = String(claim.apiKey || '').trim();
    const baseURL = String(claim.baseURL || process.env.AIGATE_API_BASE_URL || DEFAULT_API_BASE_URL).trim();

    if (String(claim.endpoint || '').trim() !== endpoint || !apiKey) {
      throw new Error('AIGate API key is missing');
    }

    await updateUserKey({
      userId: user._id.toString(),
      name: getServerManagedKeyName(endpoint),
      value: JSON.stringify({ apiKey, baseURL }),
    });

    await setAuthTokens(user._id, res, null, req);
    return res.redirect(303, process.env.AIGATE_SSO_AFTER_LOGIN || '/');
  } catch {
    return res.status(502).send('AIGate SSO failed');
  }
}

router.get('/sso', handleSso);
router.post('/sso', handleSso);

router.get('/balance', requireJwtAuth, async (req, res) => {
  const endpoint = typeof req.query.endpoint === 'string' ? req.query.endpoint.trim() : '';
  if (endpoint !== getAigateEndpoint()) {
    return res.status(400).send({ error: 'invalid endpoint' });
  }

  let apiKey;
  try {
    const userKey = parseStoredUserKey(
      await getUserKey({
        userId: req.user.id,
        name: getServerManagedKeyName(endpoint),
      }),
    );
    if (!userKey || !userKey.apiKey) {
      return res.status(404).send({ error: 'AIGate key is not configured' });
    }
    apiKey = userKey.apiKey;
  } catch {
    return res.status(404).send({ error: 'AIGate key is not configured' });
  }

  try {
    const upstream = await fetch(process.env.AIGATE_BALANCE_URL || DEFAULT_BALANCE_URL, {
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
    });
    const payload = await upstream.json().catch(() => null);
    if (!upstream.ok) {
      return res.status(502).send({ error: 'AIGate balance unavailable' });
    }
    return res.status(200).send(payload);
  } catch {
    return res.status(502).send({ error: 'AIGate balance unavailable' });
  }
});

module.exports = router;
