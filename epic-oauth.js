import fs from 'node:fs/promises';
import path from 'node:path';
import { datetime, prompt, notify, markdown_game_list, handleSIGINT, dataDir } from './src/util.js';
import { cfg } from './src/config.js';
import { createEpicAuthServer, ensureEpicAuth, exchangeEpicAuthorizationCode, fetchEpicAccount, saveEpicAuth, EPIC_AUTH_CODE_URL, EPIC_LOGIN_URL } from './src/epic-auth.js';
import { getEpicLibraryItems } from './src/epic-auth.js';
import { fetchEpicFreeGames, compareEpicOwnership } from './src/epic-games-library.js';

const reportPath = cfg.epic_oauth_report_file || dataDir('epic-free-games-status.json');
const args = new Set(process.argv.slice(2));
const codeArgIndex = process.argv.indexOf('--code');
const codeArg = codeArgIndex >= 0 ? process.argv[codeArgIndex + 1] : null;
const authOnly = args.has('--auth-only');

const saveAuthInput = async input => {
  const auth = await exchangeEpicAuthorizationCode(input);
  await saveEpicAuth(auth);
  const account = await fetchEpicAccount(auth);
  console.log(`Epic auth saved to ${cfg.epic.auth_file}`);
  console.log(`Signed in as ${account.displayName || account.id}`);
  return { auth, account };
};

const configureAuthInteractively = async () => {
  if (codeArg) {
    return saveAuthInput(codeArg);
  }

  if (cfg.epic.auth_mode === 'browser') {
    const authServer = createEpicAuthServer();
    await authServer.listen();
    try {
      console.log(`Open this auth page in your desktop browser: ${authServer.url}`);
      console.log(`If you want to do it manually instead, sign in at ${EPIC_LOGIN_URL}`);
      console.log(`Then open ${EPIC_AUTH_CODE_URL} and paste the response into the auth page.`);
      console.log('For remote/container use, prefer `EPIC_AUTH_MODE=manual node epic-oauth.js` or `node epic-oauth.js --code "<code>"`.');
      return await authServer.waitForCompletion();
    } finally {
      await authServer.close();
    }
  }

  console.log(`1. Sign in at ${EPIC_LOGIN_URL}`);
  console.log(`2. Open ${EPIC_AUTH_CODE_URL}`);
  console.log('3. Paste the returned authorization code, redirect URL, or JSON response below.');
  const input = await prompt({ type: 'text', message: 'Enter Epic authorization code or response' });
  if (!input) {
    throw new Error('No Epic authorization code was provided.');
  }

  return saveAuthInput(input);
};

const ensureConfiguredEpicAuth = async () => {
  try {
    return await ensureEpicAuth();
  } catch (error) {
    console.log(`Saved Epic auth could not be reused automatically: ${error.message}`);
    return configureAuthInteractively();
  }
};

const writeStatusReport = async report => {
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
};

handleSIGINT();
console.log(datetime(), 'started checking Epic free games via OAuth');

try {
  const { account } = await ensureConfiguredEpicAuth();
  await notify(`epic-oauth: ready as ${account.displayName || account.id}`).catch(_ => {});

  if (authOnly) {
    console.log('Epic auth is ready. Skipping free games check because --auth-only was set.');
    process.exit(0);
  }

  const [{ records }, offers] = await Promise.all([
    getEpicLibraryItems(),
    fetchEpicFreeGames(),
  ]);

  const results = compareEpicOwnership(offers, records);
  const missingOffers = results.filter(offer => !offer.owned);
  const report = {
    generatedAt: new Date().toISOString(),
    account: {
      id: account.id,
      displayName: account.displayName,
      country: account.country,
    },
    rawLibraryRecordCount: records.length,
    currentFreeOfferCount: results.length,
    missingOfferCount: missingOffers.length,
    offers: results,
  };

  await writeStatusReport(report);

  console.log(`Signed in as ${account.displayName || account.id}`);
  console.log(`Found ${records.length} owned Epic library record(s).`);
  console.log(`Found ${results.length} current free Epic offer(s).`);
  console.log(`Report written to ${reportPath}`);

  if (!results.length) {
    console.log('No current free Epic offers found.');
  } else {
    for (const offer of results) {
      console.log(`- ${offer.title}: ${offer.status}${offer.url ? ` (${offer.url})` : ''}`);
    }
  }

  if (missingOffers.length) {
    await notify(`epic-oauth:\n${markdown_game_list(missingOffers.map(offer => ({
      title: offer.title,
      status: offer.status,
      url: offer.url || 'https://store.epicgames.com/en-US/free-games',
    })))}`, 'markdown').catch(_ => {});
  } else {
    console.log('All current free Epic offers are already in the library.');
    await notify('epic-oauth: all current Epic free offers are already in the library.').catch(_ => {});
  }
} catch (error) {
  console.error('Failed to check Epic free games via OAuth:', error.message);
  await notify(`epic-oauth failed: ${error.message}`).catch(_ => {});
  process.exitCode = 1;
}
