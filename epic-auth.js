import { datetime, prompt, notify, handleSIGINT } from './src/util.js';
import { cfg } from './src/config.js';
import { createEpicAuthServer, exchangeEpicAuthorizationCode, fetchEpicAccount, loadEpicAuth, refreshEpicAuth, saveEpicAuth, isEpicAuthExpired, EPIC_AUTH_CODE_URL, EPIC_LOGIN_URL } from './src/epic-auth.js';

console.log(datetime(), 'starting epic auth setup');

const codeArgIndex = process.argv.indexOf('--code');
const codeArg = codeArgIndex >= 0 ? process.argv[codeArgIndex + 1] : null;
const refreshArg = process.argv.includes('--refresh');
const forceRefreshArg = process.argv.includes('--force-refresh');

const saveAuthInput = async input => {
  const auth = await exchangeEpicAuthorizationCode(input);
  await saveEpicAuth(auth);
  const account = await fetchEpicAccount(auth);
  console.log(`Epic auth saved to ${cfg.epic.auth_file}`);
  console.log(`Signed in as ${account.displayName || account.id}`);
  return account;
};

const refreshSavedAuth = async ({ force = false } = {}) => {
  const savedAuth = await loadEpicAuth();
  if (!savedAuth) {
    return null;
  }

  const auth = force || isEpicAuthExpired(savedAuth)
    ? await refreshEpicAuth(savedAuth)
    : savedAuth;

  if (auth !== savedAuth) {
    await saveEpicAuth(auth);
  }

  const account = await fetchEpicAccount(auth);
  console.log(auth === savedAuth ? `Epic auth is still valid at ${cfg.epic.auth_file}` : `Epic auth refreshed at ${cfg.epic.auth_file}`);
  console.log(`Signed in as ${account.displayName || account.id}`);
  return { auth, account, refreshed: auth !== savedAuth };
};

handleSIGINT();

try {
  let account;
  if (codeArg) {
    account = await saveAuthInput(codeArg);
  } else if (refreshArg || forceRefreshArg) {
    const result = await refreshSavedAuth({ force: forceRefreshArg });
    if (!result) {
      throw new Error(`No saved Epic auth found at ${cfg.epic.auth_file}. Run interactive setup first.`);
    }
    account = result.account;
  } else if (cfg.epic.auth_mode === 'browser') {
    const result = await refreshSavedAuth().catch(error => {
      console.log(`Saved Epic auth could not be reused automatically: ${error.message}`);
      return null;
    });
    if (result) {
      account = result.account;
    } else {
    const authServer = createEpicAuthServer();
    await authServer.listen();
    try {
      console.log(`Open this auth page in your desktop browser: ${authServer.url}`);
      console.log(`If you want to do it manually instead, sign in at ${EPIC_LOGIN_URL}`);
      console.log(`Then open ${EPIC_AUTH_CODE_URL} and paste the response into the auth page.`);
      console.log('For remote/container use, prefer `EPIC_AUTH_MODE=manual node epic-auth.js` or `node epic-auth.js --code "<code>"`.');
      ({ account } = await authServer.waitForCompletion());
    } finally {
      await authServer.close();
    }
    }
  } else {
    const result = await refreshSavedAuth().catch(error => {
      console.log(`Saved Epic auth could not be reused automatically: ${error.message}`);
      return null;
    });
    if (result) {
      account = result.account;
    } else {
    console.log(`1. Sign in at ${EPIC_LOGIN_URL}`);
    console.log(`2. Open ${EPIC_AUTH_CODE_URL}`);
    console.log('3. Paste the returned authorization code, redirect URL, or JSON response below.');
    const input = await prompt({ type: 'text', message: 'Enter Epic authorization code or response' });
    if (!input) {
      throw new Error('No Epic authorization code was provided.');
    }
    account = await saveAuthInput(input);
    }
  }

  await notify(`epic-auth: saved Epic auth for ${account.displayName || account.id}`).catch(_ => {});
} catch (error) {
  console.error('Failed to configure Epic auth:', error.message);
  await notify(`epic-auth failed: ${error.message}`).catch(_ => {});
  process.exitCode = 1;
}
