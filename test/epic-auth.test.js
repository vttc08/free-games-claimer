import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEpicAuthorizationCode, normalizeEpicAuth, isEpicAuthExpired, isEpicRefreshExpired } from '../src/epic-auth.js';

test('parseEpicAuthorizationCode accepts raw codes', () => {
  assert.equal(parseEpicAuthorizationCode('abc123DEF'), 'abc123DEF');
});

test('parseEpicAuthorizationCode extracts code from JSON', () => {
  assert.equal(
    parseEpicAuthorizationCode('{"authorizationCode":"abc123DEF"}'),
    'abc123DEF',
  );
});

test('parseEpicAuthorizationCode rejects Epic redirect payloads without a usable code', () => {
  assert.throws(
    () => parseEpicAuthorizationCode('{"warning":"Do not share this code with any 3rd party service. It allows full access to your Epic account.","redirectUrl":"https://localhost/launcher/authorized","authorizationCode":null,"exchangeCode":null,"sid":null}'),
    /Epic did not return an authorization code/,
  );
});

test('parseEpicAuthorizationCode extracts code from URLs', () => {
  assert.equal(
    parseEpicAuthorizationCode('http://localhost:3989/callback?code=abc123DEF'),
    'abc123DEF',
  );
});

test('normalizeEpicAuth computes expiry timestamps', () => {
  const auth = normalizeEpicAuth({
    access_token: 'access',
    refresh_token: 'refresh',
    token_type: 'bearer',
    account_id: 'user-1',
    expires_in: 120,
    refresh_expires: 3600,
  }, new Date('2026-04-15T12:00:00.000Z'));

  assert.equal(auth.expires_at, '2026-04-15T12:02:00.000Z');
  assert.equal(auth.refresh_expires_at, '2026-04-15T13:00:00.000Z');
  assert.equal(auth.account_id, 'user-1');
});

test('isEpicAuthExpired applies a refresh skew', () => {
  assert.equal(
    isEpicAuthExpired({ expires_at: '2026-04-15T12:00:30.000Z' }, new Date('2026-04-15T12:00:00.000Z')),
    true,
  );
  assert.equal(
    isEpicAuthExpired({ expires_at: '2026-04-15T12:03:00.000Z' }, new Date('2026-04-15T12:00:00.000Z')),
    false,
  );
});

test('isEpicRefreshExpired detects expired refresh tokens', () => {
  assert.equal(
    isEpicRefreshExpired({ refresh_expires_at: '2026-04-15T12:00:30.000Z' }, new Date('2026-04-15T12:00:00.000Z')),
    true,
  );
  assert.equal(
    isEpicRefreshExpired({ refresh_expires_at: '2026-04-15T12:03:00.000Z' }, new Date('2026-04-15T12:00:00.000Z')),
    false,
  );
  assert.equal(
    isEpicRefreshExpired({}, new Date('2026-04-15T12:00:00.000Z')),
    false,
  );
});
