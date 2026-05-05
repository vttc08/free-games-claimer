import test from 'node:test';
import assert from 'node:assert/strict';
import { extractCurrentFreeGames, compareEpicOwnership } from '../src/epic-games-library.js';
import { html_game_list, text_game_list, markdown_game_list } from '../src/util.js';

test('extractCurrentFreeGames keeps only currently free base games', () => {
  const offers = extractCurrentFreeGames({
    data: {
      Catalog: {
        searchStore: {
          elements: [
            {
              id: 'free-now',
              namespace: 'ns-free',
              title: 'Free Now',
              offerType: 'BASE_GAME',
              isCodeRedemptionOnly: false,
              offerMappings: [{ pageSlug: 'free-now' }],
              items: [{ id: 'item-free', namespace: 'ns-free' }],
              price: { totalPrice: { discountPrice: 0 } },
              promotions: {
                promotionalOffers: [
                  {
                    promotionalOffers: [
                      { startDate: '2026-04-10T00:00:00.000Z', endDate: '2026-04-20T00:00:00.000Z' },
                    ],
                  },
                ],
              },
            },
            {
              id: 'discounted',
              namespace: 'ns-discount',
              title: 'Discounted',
              offerType: 'BASE_GAME',
              isCodeRedemptionOnly: false,
              price: { totalPrice: { discountPrice: 999 } },
              promotions: {
                promotionalOffers: [
                  {
                    promotionalOffers: [
                      { startDate: '2026-04-10T00:00:00.000Z', endDate: '2026-04-20T00:00:00.000Z' },
                    ],
                  },
                ],
              },
            },
            {
              id: 'upcoming',
              namespace: 'ns-upcoming',
              title: 'Upcoming',
              offerType: 'BASE_GAME',
              isCodeRedemptionOnly: false,
              price: { totalPrice: { discountPrice: 0 } },
              promotions: {
                promotionalOffers: [
                  {
                    promotionalOffers: [
                      { startDate: '2026-04-16T00:00:00.000Z', endDate: '2026-04-20T00:00:00.000Z' },
                    ],
                  },
                ],
              },
            },
          ],
        },
      },
    },
  }, new Date('2026-04-15T12:00:00.000Z'));

  assert.deepEqual(offers.map(offer => offer.id), ['free-now']);
  assert.equal(offers[0].url, 'https://store.epicgames.com/en-US/p/free-now');
});

test('compareEpicOwnership marks owned offers from library assets', () => {
  const results = compareEpicOwnership(
    [
      { id: 'free-now', namespace: 'ns-free', title: 'Free Now', url: 'https://example.com/free-now', items: [] },
      { id: 'not-owned', namespace: 'ns-other', title: 'Not Owned', url: 'https://example.com/not-owned', items: [] },
    ],
    [
      { namespace: 'ns-free', catalogItemId: 'free-now' },
    ],
  );

  assert.deepEqual(results.map(result => result.status), ['in library', 'not in library']);
});

test('html_game_list includes the raw URL in addition to the link', () => {
  const html = html_game_list([
    { title: 'Free Now', status: 'not in library', url: 'https://example.com/free-now' },
  ]);

  assert.match(html, /href="https:\/\/example\.com\/free-now"/);
  assert.match(html, /https:\/\/example\.com\/free-now/);
});

test('text_game_list uses plain text with raw URLs', () => {
  const text = text_game_list([
    { title: 'Free Now', status: 'not in library', url: 'https://example.com/free-now' },
  ]);

  assert.equal(text, '- Free Now (not in library) \n<https://example.com/free-now>');
});

test('markdown_game_list uses markdown links', () => {
  const markdown = markdown_game_list([
    { title: 'Free Now', status: 'not in library', url: 'https://example.com/free-now' },
  ]);

  assert.equal(markdown, '- [Free Now](https://example.com/free-now) (not in library)');
});
