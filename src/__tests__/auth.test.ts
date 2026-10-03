import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Isolate from any real ~/.config of the developer (CONFIG_DIR is computed at import time)
vi.hoisted(() => { process.env.HOME = '/nonexistent-home'; });
import { isUserAllowed, isAuthorized } from '../utils/AuthGuard.js';
import { isValidGitUrl, isSafeDirName } from '../utils/Validation.js';
import type { Context } from 'grammy';

const ctx = (id?: number) => ({ from: id === undefined ? undefined : { id } }) as unknown as Context;

describe('isUserAllowed (fail-closed)', () => {
  it('allows listed user', () => expect(isUserAllowed(42, [1, 42])).toBe(true));
  it('rejects unlisted user', () => expect(isUserAllowed(7, [1, 42])).toBe(false));
  it('rejects everybody on empty allowlist', () => expect(isUserAllowed(42, [])).toBe(false));
  it('rejects on undefined allowlist', () => expect(isUserAllowed(42, undefined)).toBe(false));
  it('rejects missing user id', () => expect(isUserAllowed(undefined, [1])).toBe(false));
  it('rejects NaN', () => expect(isUserAllowed(NaN, [NaN])).toBe(false));
});

describe('isAuthorized via config', () => {
  const saved = { ...process.env };
  beforeEach(() => { process.env.TELEGRAM_BOT_TOKEN = '123:test'; });
  afterEach(() => { process.env = { ...saved }; });

  it('allows listed id', () => {
    process.env.TELEGRAM_ALLOWED_USER_IDS = '10, 20';
    expect(isAuthorized(ctx(20))).toBe(true);
    expect(isAuthorized(ctx(30))).toBe(false);
  });
  it('empty env list never allows (falls back to stored config, none in CI)', () => {
    process.env.TELEGRAM_ALLOWED_USER_IDS = '';
    expect(isAuthorized(ctx(20))).toBe(false);
  });
  it('garbage list authorizes nobody', () => {
    process.env.TELEGRAM_ALLOWED_USER_IDS = 'abc,,x';
    expect(isAuthorized(ctx(0))).toBe(false);
    expect(isAuthorized(ctx(1))).toBe(false);
  });
  it('no token -> nobody', () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    process.env.TELEGRAM_ALLOWED_USER_IDS = '1';
    expect(isAuthorized(ctx(1))).toBe(false);
  });
});

describe('injection validation', () => {
  it.each([
    'https://github.com/a/b.git', 'http://host/a/b', 'git@github.com:a/b.git',
  ])('accepts %s', u => expect(isValidGitUrl(u)).toBe(true));
  it.each([
    'https://x/a"; touch /tmp/pwn; "', 'https://x/$(id)', 'https://x/`id`', 'https://x/a b',
    '--upload-pack=evil', '-c core.sshCommand=x', 'ext::sh -c id', 'file:///etc', 'https://x/a;b', 'https://x/a\nb',
  ])('rejects %s', u => expect(isValidGitUrl(u)).toBe(false));
  it.each(['proj', 'my-app_1.2'])('accepts dir %s', n => expect(isSafeDirName(n)).toBe(true));
  it.each(['../x', '..', 'a/b', '/etc', '.hidden', '-rf', 'a..b', '', 'a b', 'x$(id)'])('rejects dir %s', n => expect(isSafeDirName(n)).toBe(false));
});
