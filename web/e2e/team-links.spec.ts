import { expect, test } from '@playwright/test';
import { inviteTokenFromInput, inviteTokenFromSearch, seatsUsed } from '../src/lib/teams';
import { safeRedirectPath } from '../src/lib/utils';

// Pure logic behind the Team tab's invite links and the sign-in redirect
// that brings an invited user back to them.
const TOKEN = '0123456789abcdef'.repeat(4);

test('reads an invite token from the dashboard URL', () => {
  expect(inviteTokenFromSearch(`?tab=team&invite=${TOKEN}`)).toBe(TOKEN);
  expect(inviteTokenFromSearch('?tab=team')).toBeNull();
  expect(inviteTokenFromSearch('?tab=team&invite=not-a-token')).toBeNull();
});

test('reads an invite token from a pasted link or a bare token', () => {
  expect(inviteTokenFromInput(`https://treq.dev/dashboard?tab=team&invite=${TOKEN}`)).toBe(TOKEN);
  expect(inviteTokenFromInput(`  ${TOKEN}  `)).toBe(TOKEN);
  expect(inviteTokenFromInput(`${TOKEN.toUpperCase()}`)).toBe(TOKEN);
  expect(inviteTokenFromInput('https://treq.dev/dashboard?tab=team')).toBeNull();
  expect(inviteTokenFromInput('hello')).toBeNull();
});

test('counts pending invites toward the seats', () => {
  expect(seatsUsed({ members: 3, pendingInvites: 7 })).toBe(10);
});

test('keeps sign-in redirects on this site', () => {
  expect(safeRedirectPath(`/dashboard?tab=team&invite=${TOKEN}`)).toBe(
    `/dashboard?tab=team&invite=${TOKEN}`,
  );
  expect(safeRedirectPath('https://evil.example/dashboard')).toBe('/dashboard');
  expect(safeRedirectPath('//evil.example/dashboard')).toBe('/dashboard');
  expect(safeRedirectPath('/\\evil.example')).toBe('/dashboard');
  expect(safeRedirectPath('javascript:alert(1)')).toBe('/dashboard');
  expect(safeRedirectPath(null)).toBe('/dashboard');
});
