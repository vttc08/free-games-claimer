import { firefox } from 'playwright'; // stealth plugin needs no outdated playwright-extra
import { authenticator } from 'otplib';
import path from 'path';
import { dirs, jsonDb, datetime, stealth, filenamify } from './util.js';
import { cfg } from './config.js';

import prompts from 'prompts'; // alternatives: enquirer, inquirer
// import enquirer from 'enquirer'; const { prompt } = enquirer;
// single prompt that just returns the non-empty value instead of an object - why name things if there's just one?
const prompt = async o => (await prompts({name: 'name', type: 'text', message: 'Enter value', validate: s => s.length, ...o})).name;

// const URL_LOGIN = 'https://www.amazon.de/ap/signin'; // wrong. needs some session args to be valid?
const URL_CLAIM = 'https://gaming.amazon.com/home';

console.log(datetime(), 'started checking prime-gaming');

const db = await jsonDb('prime-gaming.json');
db.data ||= {};
const migrateDb = (user) => {
  if (user in db.data || !('claimed' in db.data)) return;
  db.data[user] = {};
  for (const e of db.data.claimed) {
    db.data[user][e.title] = e;
  }
  delete db.data.claimed;
  delete db.data.runs;
}

// https://playwright.dev/docs/auth#multi-factor-authentication
const context = await firefox.launchPersistentContext(dirs.browser, {
  headless: cfg.headless,
  viewport: { width: cfg.width, height: cfg.height },
  locale: "en-US", // ignore OS locale to be sure to have english text for locators
});

// TODO test if needed
await stealth(context);

if (!cfg.debug) context.setDefaultTimeout(cfg.timeout);

const page = context.pages().length ? context.pages()[0] : await context.newPage(); // should always exist
// console.debug('userAgent:', await page.evaluate(() => navigator.userAgent));

try {
  await page.goto(URL_CLAIM, { waitUntil: 'domcontentloaded' }); // default 'load' takes forever
  // need to wait for some elements to exist before checking if signed in or accepting cookies:
  await Promise.any(['button:has-text("Sign in")', '[data-a-target="user-dropdown-first-name-text"]'].map(s => page.waitForSelector(s)));
  page.click('[aria-label="Cookies usage disclaimer banner"] button:has-text("Accept Cookies")').catch(_ => { }); // to not waste screen space when non-headless, TODO does not work reliably, need to wait for something else first?
  while (await page.locator('button:has-text("Sign in")').count() > 0) {
    console.error('Not signed in anymore.');
    await page.click('button:has-text("Sign in")');
    if (!cfg.debug) context.setDefaultTimeout(0); // give user time to log in without timeout
    console.info('Press ESC to skip if you want to login in the browser (not possible in default headless mode).');
    const email = cfg.pg_email || await prompt({message: 'Enter email'});
    const password = cfg.pg_password || await prompt({type: 'password', message: 'Enter password'});
    if (email && password) {
      await page.fill('[name=email]', email);
      await page.fill('[name=password]', password);
      await page.check('[name=rememberMe]');
      await page.click('input[type="submit"]');
      page.waitForNavigation({ url: '**/ap/signin**'}).then(async () => { // TODO check for wrong credentials
        console.error(await page.locator('.a-alert-content').first().innerText());
      }).catch(_ => { });
      // handle MFA, but don't await it
      page.waitForNavigation({ url: '**/ap/mfa**'}).then(async () => {
        console.log('Two-Step Verification - enter the One Time Password (OTP), e.g. generated by your Authenticator App');
        await page.check('[name=rememberDevice]');
        const otp = cfg.pg_otpkey && authenticator.generate(cfg.pg_otpkey) || await prompt({type: 'text', message: 'Enter two-factor sign in code', validate: n => n.toString().length == 6 || 'The code must be 6 digits!'}); // can't use type: 'number' since it strips away leading zeros and codes sometimes have them
        await page.type('input[name=otpCode]', otp.toString());
        await page.click('input[type="submit"]');
      }).catch(_ => { });
    } else {
      if (cfg.headless) {
        console.log('Please run `node prime-gaming show` to login in the opened browser.');
        await context.close(); // not needed?
        process.exit(1);
      }
      console.log('Waiting for you to login in the browser.');
    }
    await page.waitForNavigation({ url: 'https://gaming.amazon.com/home?signedIn=true' });
    if (!cfg.debug) context.setDefaultTimeout(cfg.timeout);
  }
  const user = await page.locator('[data-a-target="user-dropdown-first-name-text"]').first().innerText();
  console.log(`Signed in as ${user}`);
  // await page.click('button[aria-label="User dropdown and more options"]');
  // const twitch = await page.locator('[data-a-target="TwitchDisplayName"]').first().innerText();
  // console.log(`Twitch user name is ${twitch}`);
  migrateDb(user); // TODO remove this after some time since it will run fine without and people can still use this commit to adjust their data/prime-gaming.json
  db.data[user] ||= {};

  await page.click('button[data-type="Game"]');
  const games_sel = 'div[data-a-target="offer-list-FGWP_FULL"]';
  await page.waitForSelector(games_sel);
  console.log('Number of already claimed games (total):', await page.locator(`${games_sel} p:has-text("Collected")`).count());
  const game_sel = `${games_sel} [data-a-target="item-card"]:has-text("Claim game")`;
  console.log('Number of free unclaimed games (Prime Gaming):', await page.locator(game_sel).count());
  const games = await page.$$(game_sel);
  // for (let i=1; i<=n; i++) {
  for (const card of games) {
    // const card = page.locator(`:nth-match(${game_sel}, ${i})`); // this will reevaluate after games are claimed and index will be wrong
    // const title = await card.locator('h3').first().innerText();
    const title = await (await card.$('.item-card-details__body__primary')).innerText();
    console.log('Current free game:', title);
    if (cfg.dryrun) continue;
    // const img = await (await card.$('img.tw-image')).getAttribute('src');
    // console.log('Image:', img);
    const p = path.resolve(dirs.screenshots, 'prime-gaming', 'internal', `${filenamify(title)}.png`);
    await card.screenshot({ path: p });
    await (await card.$('button:has-text("Claim game")')).click();
    db.data[user][title] ||= { title, time: datetime(), store: 'internal' };
    // await page.pause();
  }
  // claim games in external/linked stores. Linked: origin.com, epicgames.com; Redeem-key: gog.com, legacygames.com, microsoft
  let n;
  const game_sel_ext = `${games_sel} [data-a-target="item-card"]:has(p:text-is("Claim"))`;
  do {
    n = await page.locator(game_sel_ext).count();
    console.log('Number of free unclaimed games (external stores):', n);
    const card = await page.$(game_sel_ext);
    if (!card) break;
    const title = await (await card.$('.item-card-details__body__primary')).innerText();
    console.log('Current free game:', title);
    if (cfg.dryrun) continue;
    await (await card.$('text=Claim')).click();
    // await page.waitForNavigation();
    await Promise.any([page.click('button:has-text("Claim now")'), page.click('button:has-text("Complete Claim")'), page.waitForSelector('div:has-text("Link game account")')]); // waits for navigation
    const store_text = await (await page.$('[data-a-target="hero-header-subtitle"]')).innerText();
    // Full game for PC [and MAC] on: gog.com, Origin, Legacy Games, EPIC GAMES, Battle.net
    // 3 Full PC Games on Legacy Games
    const store = store_text.toLowerCase().replace(/.* on /, '');
    console.log('  External store:', store);
    if (await page.locator('div:has-text("Link game account")').count()) {
      console.error('  Account linking is required to claim this offer!');
    } else {
      // print code if there is one
      const redeem = {
        // 'origin': 'https://www.origin.com/redeem', // TODO still needed or now only via account linking?
        'gog.com': 'https://www.gog.com/redeem',
        'legacy games': 'https://www.legacygames.com/primedeal',
        'microsoft games': 'https://redeem.microsoft.com',
      };
      let code;
      if (store in redeem) { // did not work for linked origin: && !await page.locator('div:has-text("Successfully Claimed")').count()
        code = await page.inputValue('input[type="text"]');
        console.log('  Code to redeem game:', code);
        if (store == 'legacy games') { // may be different URL like https://legacygames.com/primeday/puzzleoftheyear/
          redeem[store] = await (await page.$('li:has-text("Click here") a')).getAttribute('href');
        }
        console.log('  URL to redeem game:', redeem[store]);
      }
      db.data[user][title] ||= { title, time: datetime(), store, code, url: page.url() };
      // save screenshot of potential code just in case
      const p = path.resolve(dirs.screenshots, 'prime-gaming', 'external', `${filenamify(title)}.png`);
      await page.screenshot({ path: p, fullPage: true });
      // console.info('  Saved a screenshot of page to', p);
    }
    // await page.pause();
    await page.goto(URL_CLAIM, { waitUntil: 'domcontentloaded' });
    await page.click('button[data-type="Game"]');
  } while (n);
  const p = path.resolve(dirs.screenshots, 'prime-gaming', `${filenamify(datetime())}.png`);
  // await page.screenshot({ path: p, fullPage: true });
  await page.locator(games_sel).screenshot({ path: p });
} catch (error) {
  console.error(error); // .toString()?
} finally {
  await db.write(); // write out json db
}
await context.close();
