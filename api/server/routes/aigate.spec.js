const express = require('express');
const request = require('supertest');

jest.mock('~/models', () => ({
  createUser: jest.fn(),
  findUser: jest.fn(),
  getUserKey: jest.fn(),
  updateUserKey: jest.fn(),
}));

jest.mock('~/server/middleware', () => ({
  requireJwtAuth: (req, res, next) => {
    if (req.get('authorization') !== 'Bearer session') {
      return res.status(401).send({ error: 'Unauthorized' });
    }
    req.user = { id: 'libre-user-1' };
    next();
  },
}));

jest.mock('~/server/services/AuthService', () => ({
  setAuthTokens: jest.fn(),
}));

const { findUser, getUserKey, updateUserKey } = require('~/models');
const { setAuthTokens } = require('~/server/services/AuthService');
const aigateRouter = require('./aigate');

describe('AIGate routes', () => {
  let app;
  const originalFetch = global.fetch;

  beforeAll(() => {
    process.env.LIBRECHAT_SSO_SECRET = 'test-shared-secret';
    app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: false }));
    app.use('/api/aigate', aigateRouter);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
    findUser.mockResolvedValue({
      _id: { toString: () => 'libre-user-1' },
    });
    setAuthTokens.mockResolvedValue(undefined);
    updateUserKey.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    global.fetch = originalFetch;
    delete process.env.LIBRECHAT_SSO_SECRET;
  });

  it('claims a POSTed token with a timeout and stores only the server-managed key', async () => {
    const signal = new AbortController().signal;
    const timeoutSpy = jest.spyOn(AbortSignal, 'timeout').mockReturnValue(signal);
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          user: { id: 'aigate-user-1', username: 'alice' },
          apiKey: 'sk-claimed',
          baseURL: 'https://api.aigate.shop/v1',
          endpoint: 'AIGate',
        },
      }),
    });

    const response = await request(app)
      .post('/api/aigate/sso')
      .type('form')
      .send({ token: 'encrypted-one-time-claim' });

    expect(response.status).toBe(303);
    expect(response.headers.location).toBe('/');
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(timeoutSpy).toHaveBeenCalledWith(5000);
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/chat/sso/claim',
      expect.objectContaining({
        method: 'POST',
        cache: 'no-store',
        signal,
        headers: expect.objectContaining({
          'cache-control': 'no-store',
          'x-aigate-chat-secret': 'test-shared-secret',
        }),
        body: JSON.stringify({ token: 'encrypted-one-time-claim' }),
      }),
    );
    expect(updateUserKey).toHaveBeenCalledWith({
      userId: 'libre-user-1',
      name: '__server_managed__:AIGate',
      value: JSON.stringify({
        apiKey: 'sk-claimed',
        baseURL: 'https://api.aigate.shop/v1',
      }),
    });
  });

  it('accepts the encrypted legacy GET handoff during rolling deploys', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          user: { id: 'aigate-user-1', username: 'alice' },
          apiKey: 'sk-claimed',
          baseURL: 'https://api.aigate.shop/v1',
          endpoint: 'AIGate',
        },
      }),
    });

    const response = await request(app).get('/api/aigate/sso?token=encrypted-one-time-claim');

    expect(response.status).toBe(303);
    expect(response.headers.location).toBe('/');
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/chat/sso/claim',
      expect.objectContaining({ body: JSON.stringify({ token: 'encrypted-one-time-claim' }) }),
    );
  });

  it('returns a generic no-store error without reflecting the claim or upstream message', async () => {
    const token = 'secret-claim';
    global.fetch.mockResolvedValue({
      ok: false,
      json: async () => ({ success: false, message: `invalid ${token}` }),
    });

    const response = await request(app).post('/api/aigate/sso').send({ token });

    expect(response.status).toBe(502);
    expect(response.text).toBe('AIGate SSO failed');
    expect(response.text).not.toContain(token);
    expect(response.headers['cache-control']).toBe('private, no-store');
  });

  it('rejects unauthenticated balance requests before reading any key', async () => {
    const response = await request(app).get('/api/aigate/balance?endpoint=AIGate');

    expect(response.status).toBe(401);
    expect(getUserKey).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejects a foreign endpoint instead of using its stored user key', async () => {
    const response = await request(app)
      .get('/api/aigate/balance?endpoint=OpenRouter')
      .set('authorization', 'Bearer session');

    expect(response.status).toBe(400);
    expect(getUserKey).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('uses only the claimed server-managed key for balance', async () => {
    getUserKey.mockImplementation(async ({ name }) => {
      if (name === '__server_managed__:AIGate') {
        return JSON.stringify({
          apiKey: 'sk-claimed',
          baseURL: 'https://api.aigate.shop/v1',
        });
      }
      return JSON.stringify({ apiKey: 'sk-user-supplied' });
    });
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ balance: 12.34 }),
    });

    const response = await request(app)
      .get('/api/aigate/balance?endpoint=AIGate')
      .set('authorization', 'Bearer session');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ balance: 12.34 });
    expect(getUserKey).toHaveBeenCalledWith({
      userId: 'libre-user-1',
      name: '__server_managed__:AIGate',
    });
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.aigate.shop/v1/balance',
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer sk-claimed' }),
      }),
    );
  });
});
