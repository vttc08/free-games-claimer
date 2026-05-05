import { datetime, notify, markdown_game_list } from './src/util.js';
import { fetchEpicFreeGames, compareEpicOwnership } from './src/epic-games-library.js';
import { getEpicLibraryItems } from './src/epic-auth.js';

console.log(datetime(), 'started checking epic games library against current free offers');

try {
  const [{ account, records }, offers] = await Promise.all([
    getEpicLibraryItems(),
    fetchEpicFreeGames(),
  ]);

  console.log(`Signed in as ${account.displayName || account.id}`);
  console.log(`Found ${records.length} owned Epic library item(s).`);

  const results = compareEpicOwnership(offers, records);
  if (!results.length) {
    console.log('No current free Epic offers found.');
  } else {
    console.log(`Found ${results.length} current free Epic offer(s).`);
    for (const offer of results) {
      console.log(`- ${offer.title}: ${offer.status}${offer.url ? ` (${offer.url})` : ''}`);
    }
  }

  const missingOffers = results.filter(offer => !offer.owned);
  if (missingOffers.length) {
    await notify(`epic-games-library:\n${markdown_game_list(missingOffers.map(offer => ({
      title: offer.title,
      status: offer.status,
      url: offer.url || 'https://store.epicgames.com/en-US/free-games',
    })))}`, 'markdown').catch(_ => {});
  }
} catch (error) {
  console.error('Failed to check Epic library:', error.message);
  await notify(`epic-games-library failed: ${error.message}`).catch(_ => {});
  process.exitCode = 1;
}
