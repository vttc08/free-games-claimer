import fs from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

export const EPIC_CLIENT_ID = '34a02cf8f4414e29b15921876da36f9a';
export const EPIC_LOGIN_URL = 'https://www.epicgames.com/id/login';
export const EPIC_AUTH_CODE_URL = `https://www.epicgames.com/id/api/redirect?clientId=${EPIC_CLIENT_ID}&responseType=code`;
export const EPIC_OAUTH_URL = 'https://account-public-service-prod03.ol.epicgames.com/account/api/oauth/token';
export const EPIC_ACCOUNT_URL = 'https://account-public-service-prod03.ol.epicgames.com/account/api/public/account/';
export const EPIC_LIBRARY_ITEMS_URL = 'https://library-service.live.use1a.on.epicgames.com/library/api/public/items?includeMetadata=true&platform=Windows';
const EPIC_BASIC_AUTH = 'Basic MzRhMDJjZjhmNDQxNGUyOWIxNTkyMTg3NmRhMzZmOWE6ZGFhZmJjY2M3Mzc3NDUwMzlkZmZlNTNkOTRmYzc2Y2Y=';
const TOKEN_REFRESH_SKEW_MS = 60 * 1000;

const html = String.raw;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = name => path.resolve(__dirname, '..', 'data', name);

const getEpicAuthSettings = () => ({
  authFile: process.env.EPIC_AUTH_FILE || dataDir('epic-auth.json'),
  authHost: process.env.EPIC_AUTH_LISTEN_HOST || '127.0.0.1',
  authPort: Number(process.env.EPIC_AUTH_LISTEN_PORT) || 3989,
  authPublicBaseUrl: process.env.EPIC_AUTH_PUBLIC_BASE_URL,
  loginTimeout: (Number(process.env.LOGIN_TIMEOUT) || 180) * 1000,
});

const decodeAuthInput = input => {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('Epic authorization code input is empty.');
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed === 'string') {
      return decodeAuthInput(parsed);
    }

    if (parsed?.authorizationCode) {
      return String(parsed.authorizationCode);
    }

    if (parsed?.exchangeCode) {
      return String(parsed.exchangeCode);
    }

    if (parsed?.redirectUrl) {
      if (parsed.authorizationCode === null && parsed.exchangeCode === null && parsed.sid === null) {
        throw new Error('Epic did not return an authorization code. Sign in to Epic in that same browser first, then open the auth-code URL again.');
      }

      return decodeAuthInput(String(parsed.redirectUrl));
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Epic did not return an authorization code.')) {
      throw error;
    }

    // Ignore JSON parsing errors and keep trying other formats.
  }

  try {
    const url = new URL(trimmed);
    const code = url.searchParams.get('code') || url.searchParams.get('authorizationCode');
    if (code) {
      return code;
    }
  } catch {
    // Not a URL.
  }

  const jsonMatch = trimmed.match(new RegExp('"authorizationCode"\\s*:\\s*"([^"]+)"'));
  if (jsonMatch) {
    return jsonMatch[1];
  }

  const urlMatch = trimmed.match(/[?&](?:code|authorizationCode)=([^&]+)/);
  if (urlMatch) {
    return decodeURIComponent(urlMatch[1]);
  }

  if (new RegExp('^[A-Za-z0-9._-]+$').test(trimmed)) {
    return trimmed;
  }

  throw new Error('Could not extract an Epic authorization code from the provided input.');
};

const requestToken = async (params, fetchImpl = fetch) => {
  const body = new URLSearchParams({ ...params, token_type: 'eg1' });
  const response = await fetchImpl(EPIC_OAUTH_URL, {
    method: 'POST',
    headers: {
      Authorization: EPIC_BASIC_AUTH,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body,
  });

  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const detail = payload?.errorMessage || payload?.error_description || payload?.errorCode || text || `${response.status} ${response.statusText}`;
    throw new Error(`Epic token request failed: ${detail}`);
  }

  if (!payload?.access_token || !payload?.refresh_token || !payload?.account_id) {
    throw new Error('Epic token response is missing required fields.');
  }

  return normalizeEpicAuth(payload);
};

export const normalizeEpicAuth = (payload, now = new Date()) => {
  const obtainedAt = new Date(now);
  const expiresAt = new Date(obtainedAt.getTime() + Number(payload.expires_in || 0) * 1000);
  const refreshExpiresAt = Number(payload.refresh_expires || payload.refresh_expires_in || 0) > 0
    ? new Date(obtainedAt.getTime() + Number(payload.refresh_expires || payload.refresh_expires_in) * 1000)
    : null;

  return {
    account_id: payload.account_id,
    access_token: payload.access_token,
    refresh_token: payload.refresh_token,
    token_type: payload.token_type || 'bearer',
    expires_in: Number(payload.expires_in || 0),
    expires_at: expiresAt.toISOString(),
    refresh_expires_in: Number(payload.refresh_expires || payload.refresh_expires_in || 0),
    refresh_expires_at: refreshExpiresAt?.toISOString() || null,
    obtained_at: obtainedAt.toISOString(),
  };
};

export const parseEpicAuthorizationCode = input => decodeAuthInput(String(input ?? ''));

export const loadEpicAuth = async (filePath = getEpicAuthSettings().authFile) => {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }

    throw error;
  }
};

export const saveEpicAuth = async (auth, filePath = getEpicAuthSettings().authFile) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(auth, null, 2)}\n`, 'utf8');
};

export const exchangeEpicAuthorizationCode = async (input, { fetchImpl = fetch } = {}) => {
  const code = parseEpicAuthorizationCode(input);
  return requestToken({ grant_type: 'authorization_code', code }, fetchImpl);
};

export const refreshEpicAuth = async (auth, { fetchImpl = fetch } = {}) => {
  if (!auth?.refresh_token) {
    throw new Error('Epic auth data does not contain a refresh token.');
  }

  return requestToken({ grant_type: 'refresh_token', refresh_token: auth.refresh_token }, fetchImpl);
};

export const isEpicRefreshExpired = (auth, now = new Date(), skewMs = TOKEN_REFRESH_SKEW_MS) => {
  if (!auth?.refresh_expires_at) {
    return false;
  }

  return new Date(auth.refresh_expires_at).getTime() <= now.getTime() + skewMs;
};

export const isEpicAuthExpired = (auth, now = new Date(), skewMs = TOKEN_REFRESH_SKEW_MS) => {
  if (!auth?.expires_at) {
    return true;
  }

  return new Date(auth.expires_at).getTime() <= now.getTime() + skewMs;
};

export const fetchEpicAccount = async (auth, { fetchImpl = fetch } = {}) => {
  const response = await fetchImpl(`${EPIC_ACCOUNT_URL}${auth.account_id}`, {
    headers: {
      Authorization: `${auth.token_type} ${auth.access_token}`,
      Accept: 'application/json',
    },
  });

  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const detail = payload?.errorMessage || payload?.errorCode || text || `${response.status} ${response.statusText}`;
    throw new Error(`Epic account request failed: ${detail}`);
  }

  return payload;
};

export const ensureEpicAuth = async ({ authFile = getEpicAuthSettings().authFile, fetchImpl = fetch, validate = true } = {}) => {
  let auth = await loadEpicAuth(authFile);
  if (!auth) {
    throw new Error(`Epic auth is not configured. Run \`node epic-auth\` first. Expected auth file at ${authFile}`);
  }

  if (isEpicRefreshExpired(auth)) {
    throw new Error('Epic refresh token has expired. Run `node epic-auth.js` and complete sign-in again.');
  }

  if (isEpicAuthExpired(auth)) {
    auth = await refreshEpicAuth(auth, { fetchImpl });
    await saveEpicAuth(auth, authFile);
  }

  if (!validate) {
    return auth;
  }

  try {
    const account = await fetchEpicAccount(auth, { fetchImpl });
    return { auth, account };
  } catch (error) {
    if (!auth.refresh_token) {
      throw error;
    }

    auth = await refreshEpicAuth(auth, { fetchImpl });
    await saveEpicAuth(auth, authFile);
    const account = await fetchEpicAccount(auth, { fetchImpl });
    return { auth, account };
  }
};

const fetchEpicLibraryPage = async (url, auth, fetchImpl) => {
  const response = await fetchImpl(url, {
    headers: {
      Authorization: `${auth.token_type} ${auth.access_token}`,
      Accept: 'application/json',
    },
  });
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const detail = payload?.errorMessage || payload?.errorCode || text || `${response.status} ${response.statusText}`;
    throw new Error(`Epic library request failed: ${detail}`);
  }

  return payload;
};

export const getEpicLibraryItems = async ({ authFile = getEpicAuthSettings().authFile, fetchImpl = fetch } = {}) => {
  const { auth, account } = await ensureEpicAuth({ authFile, fetchImpl });
  const records = [];
  let cursor = null;

  do {
    const url = cursor ? `${EPIC_LIBRARY_ITEMS_URL}&cursor=${encodeURIComponent(cursor)}` : EPIC_LIBRARY_ITEMS_URL;
    const payload = await fetchEpicLibraryPage(url, auth, fetchImpl);
    if (Array.isArray(payload?.records)) {
      records.push(...payload.records);
    }
    cursor = payload?.responseMetadata?.nextCursor || null;
  } while (cursor);

  return { auth, account, records };
};

const defaultAuthBaseUrl = () => {
  const settings = getEpicAuthSettings();
  if (settings.authPublicBaseUrl) {
    return settings.authPublicBaseUrl.endsWith('/') ? settings.authPublicBaseUrl : `${settings.authPublicBaseUrl}/`;
  }

  const host = settings.authHost === '0.0.0.0' ? '127.0.0.1' : settings.authHost;
  return `http://${host}:${settings.authPort}/`;
};

const renderEpicAuthPage = ({ message = '', error = '' } = {}) => html`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Epic Auth Setup</title>
    <style>
      :root {
        color-scheme: light;
        font-family: system-ui, sans-serif;
      }
      body {
        margin: 2rem auto;
        max-width: 48rem;
        padding: 0 1rem;
        line-height: 1.5;
      }
      code, textarea, input {
        font-family: ui-monospace, monospace;
      }
      textarea {
        width: 100%;
        min-height: 10rem;
      }
      .notice {
        padding: 0.75rem 1rem;
        border-radius: 0.5rem;
        margin-bottom: 1rem;
      }
      .success {
        background: #e8f5e9;
        color: #1b5e20;
      }
      .error {
        background: #ffebee;
        color: #b71c1c;
      }
    </style>
  </head>
  <body>
    <h1>Epic Auth Setup</h1>
    ${message ? `<div class="notice success">${message}</div>` : ''}
    ${error ? `<div class="notice error">${error}</div>` : ''}
    <ol>
      <li>Open <a href="${EPIC_LOGIN_URL}" target="_blank" rel="noreferrer">${EPIC_LOGIN_URL}</a> and sign in to Epic in your normal browser.</li>
      <li>After signing in, open <a href="${EPIC_AUTH_CODE_URL}" target="_blank" rel="noreferrer">${EPIC_AUTH_CODE_URL}</a>.</li>
      <li>Copy the returned authorization code, redirect URL, or JSON payload and submit it below.</li>
    </ol>
    <form action="/callback" method="get">
      <label for="code">Authorization code or raw response</label><br>
      <textarea id="code" name="code" placeholder='{"authorizationCode":"..."}'></textarea><br>
      <button type="submit">Save Epic Auth</button>
    </form>
    <script>
      const textarea = document.getElementById('code');
      textarea?.addEventListener('keydown', event => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          event.target.form?.requestSubmit();
        }
      });
    </script>
  </body>
</html>`;

export const createEpicAuthServer = ({ authFile = getEpicAuthSettings().authFile, fetchImpl = fetch } = {}) => {
  const settings = getEpicAuthSettings();
  let resolveResult;
  let rejectResult;
  const completion = new Promise((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  const server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url, defaultAuthBaseUrl());

    if (requestUrl.pathname === '/callback') {
      const submitted = requestUrl.searchParams.get('code') || '';
      try {
        const auth = await exchangeEpicAuthorizationCode(submitted, { fetchImpl });
        await saveEpicAuth(auth, authFile);
        const account = await fetchEpicAccount(auth, { fetchImpl });
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(renderEpicAuthPage({
          message: `Epic auth saved for ${account.displayName || account.id}. You can close this page.`,
        }));
        resolveResult({ auth, account });
      } catch (error) {
        response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(renderEpicAuthPage({ error: error.message }));
      }
      return;
    }

    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(renderEpicAuthPage());
  });

  return {
    url: new URL('/', defaultAuthBaseUrl()).href,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
    listen: () => new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(settings.authPort, settings.authHost, () => {
        server.off('error', reject);
        resolve();
      });
    }),
    waitForCompletion: ({ timeoutMs = settings.loginTimeout } = {}) => new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Timed out waiting for Epic auth after ${timeoutMs / 1000} seconds.`));
      }, timeoutMs);

      completion.then(
        value => {
          clearTimeout(timeout);
          resolve(value);
        },
        error => {
          clearTimeout(timeout);
          reject(error);
        },
      );
    }),
    reject: rejectResult,
  };
};
