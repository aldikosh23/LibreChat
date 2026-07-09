const express = require('express');
const { createUser, findUser, getUserKey, updateUserKey } = require('~/models');
const { requireJwtAuth } = require('~/server/middleware');
const { setAuthTokens } = require('~/server/services/AuthService');

const router = express.Router();
const DEFAULT_BALANCE_URL = 'https://api.aigate.shop/v1/balance';
const DEFAULT_CLAIM_URL = 'http://localhost:3000/api/chat/sso/claim';
const DEFAULT_API_BASE_URL = 'https://api.aigate.shop/v1';
const DEFAULT_ENDPOINT = 'AIGate';
const AIGATE_ISSUER = 'aigate';

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
  } catch {
    // Plain API keys are valid.
  }

  return { apiKey: trimmed, baseURL: '' };
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
    headers: {
      'content-type': 'application/json',
      'x-aigate-chat-secret': getSsoSecret(),
    },
    body: JSON.stringify({ token }),
  });
  const payload = await upstream.json().catch(() => null);
  if (!upstream.ok || !payload?.success) {
    throw new Error(payload?.message || 'AIGate SSO claim failed');
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

router.get('/sso', async (req, res) => {
  const token = typeof req.query.token === 'string' ? req.query.token.trim() : '';
  if (!token) {
    return res.status(400).send('missing sso token');
  }

  try {
    const claim = await claimAigateSession(token);
    const user = await findOrCreateAigateUser(claim.user);
    const endpoint = String(claim.endpoint || process.env.AIGATE_ENDPOINT_NAME || DEFAULT_ENDPOINT);
    const apiKey = String(claim.apiKey || '').trim();
    const baseURL = String(claim.baseURL || process.env.AIGATE_API_BASE_URL || DEFAULT_API_BASE_URL).trim();

    if (!apiKey) {
      throw new Error('AIGate API key is missing');
    }

    await updateUserKey({
      userId: user._id.toString(),
      name: endpoint,
      value: JSON.stringify({ apiKey, baseURL }),
    });

    await setAuthTokens(user._id, res, null, req);
    return res.redirect(302, process.env.AIGATE_SSO_AFTER_LOGIN || '/');
  } catch (err) {
    return res.status(502).send(err instanceof Error ? err.message : 'AIGate SSO failed');
  }
});

router.get('/balance', requireJwtAuth, async (req, res) => {
  const endpoint = typeof req.query.endpoint === 'string' ? req.query.endpoint.trim() : '';
  if (!endpoint) {
    return res.status(400).send({ error: 'endpoint is required' });
  }

  let apiKey;
  try {
    const userKey = parseStoredUserKey(await getUserKey({ userId: req.user.id, name: endpoint }));
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
