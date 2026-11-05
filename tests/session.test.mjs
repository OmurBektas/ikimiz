import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DAILY_SESSION_MS,sessionExpiry,dailySessionExpired} from '../web/session.mjs';
test('daily login expires at 24 hours, not at token refresh or midnight', () => {
  const signedIn = '2026-11-05T23:59:00+03:00';
  const expiry = sessionExpiry(signedIn);
  assert.equal(expiry-Date.parse(signedIn),DAILY_SESSION_MS);
  assert.equal(dailySessionExpired(expiry,Date.parse('2026-11-06T00:01:00+03:00')),false);
  assert.equal(dailySessionExpired(expiry,expiry-1),false);
  assert.equal(dailySessionExpired(expiry,expiry),true);
});
test('invalid authentication time cannot create a lasting session', () => {
  assert.equal(dailySessionExpired(sessionExpiry('invalid')),true);
  assert.equal(dailySessionExpired(Number.NaN),true);
});
