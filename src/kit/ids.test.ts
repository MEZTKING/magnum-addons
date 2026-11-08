import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseId } from './ids.ts';

test('movie ids', () => {
  assert.deepEqual(parseId('movie', 'tt0063350', ['tt']), {
    raw: 'tt0063350',
    imdbId: 'tt0063350',
    season: null,
    episode: null,
  });
  assert.equal(parseId('movie', 'tt0063350:1:2', ['tt']), null);
});

test('series ids parse into imdbId, season, episode', () => {
  assert.deepEqual(parseId('series', 'tt0903747:5:14', ['tt']), {
    raw: 'tt0903747:5:14',
    imdbId: 'tt0903747',
    season: 5,
    episode: 14,
  });
  assert.equal(parseId('series', 'tt0903747', ['tt']), null);
});

test('rejects anything else', () => {
  for (const bad of [
    '',
    'tt',
    'ttabc',
    'tt1:a:b',
    'tt1:1',
    '../etc/passwd',
    'tt1\n',
    'TT123',
    'tt1:1:2:3',
    'tt1:999999999:1',
  ]) {
    assert.equal(parseId('series', bad, ['tt']), null, bad);
    assert.equal(parseId('movie', bad, ['tt']), null, bad);
  }
});

test('custom idPrefixes', () => {
  assert.equal(parseId('movie', 'my:abc-1', ['tt', 'my:'])?.imdbId, null);
  assert.equal(parseId('movie', 'other:abc', ['tt', 'my:']), null);
  assert.equal(parseId('movie', 'my:a/b', ['tt', 'my:']), null);
  assert.equal(parseId('movie', 'my:abc', ['tt']), null);
});
