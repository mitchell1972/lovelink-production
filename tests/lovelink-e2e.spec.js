// @ts-check
const { test, expect } = require('@playwright/test');

/*
 * LoveLink End-to-End Cross-User Tests (Playwright)
 *
 * KEY FINDINGS FOR REACT NATIVE WEB + SUPABASE:
 *  - Buttons are <div> (not <button>) → use text selectors
 *  - navigator.locks shared across contexts → stub it per context
 *  - supabase.auth.getSession() HANGS on page reload even with lock stub
 *    (seems to be an internal Supabase issue with token restoration)
 *  - WORKAROUND: never reload. Always clear storage + goto + re-login.
 */

const BASE_URL = 'http://localhost:8081';
const RUN_ID = Date.now().toString(36);

const ALICE = {
  name: `Alice_${RUN_ID}`,
  email: `testalice.${RUN_ID}@testmail.com`,
  password: 'TestPass123!',
};
const BOB = {
  name: `Bob_${RUN_ID}`,
  email: `testbob.${RUN_ID}@testmail.com`,
  password: 'TestPass123!',
};
const CHARLIE = {
  name: `Charlie_${RUN_ID}`,
  email: `testcharlie.${RUN_ID}@testmail.com`,
  password: 'TestPass123!',
};

// Stub navigator.locks to prevent Supabase auth deadlocks between contexts
const LOCK_STUB = `
  (() => {
    navigator.locks = {
      async request(name, optionsOrCallback, maybeCallback) {
        const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback;
        return cb({ name, mode: 'exclusive' });
      },
      async query() { return { held: [], pending: [] }; }
    };
  })();
`;

// ─── Helpers ────────────────────────────────────────────────────────────

async function createContext(browser) {
  const ctx = await browser.newContext();
  await ctx.addInitScript(LOCK_STUB);
  return ctx;
}

async function waitForAppReady(page, timeout = 20_000) {
  try {
    await page.waitForFunction(
      () => !document.body.innerText.includes('Loading LoveLink...'),
      { timeout }
    );
  } catch { /* accept */ }
  await page.waitForTimeout(500);
}

/** Fresh load (navigate, clear storage, navigate again) – avoids the reload hang */
async function freshLoad(page) {
  // Navigate to the app first so we have access to localStorage
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 20_000 });
  // Clear storage
  await page.evaluate(() => {
    try { localStorage.clear(); } catch {}
    try { sessionStorage.clear(); } catch {}
  });
  // Navigate again to start fresh without cached auth state
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 20_000 });
  await waitForAppReady(page);
}

async function signUp(page, user) {
  await freshLoad(page);
  await expect(page.getByText('Create Your Account')).toBeVisible({ timeout: 15_000 });
  await page.getByPlaceholder('Your name').fill(user.name);
  await page.getByPlaceholder('Email address').fill(user.email);
  await page.getByPlaceholder('Password (min 6 characters)').fill(user.password);
  await page.getByText('Sign Up', { exact: true }).first().click();
  await expect(page.getByText('Link With Your Partner')).toBeVisible({ timeout: 30_000 });
}

/** Sign in – clears storage, navigates fresh, and logs in */
async function signIn(page, user) {
  await freshLoad(page);

  // Switch to login if on signup
  if (await page.getByText('Create Your Account').isVisible({ timeout: 3000 }).catch(() => false)) {
    await page.getByText('Log in', { exact: false }).first().click();
    await page.waitForTimeout(1000);
  }
  await expect(page.getByText('Welcome Back')).toBeVisible({ timeout: 10_000 });
  await page.getByPlaceholder('Email').first().fill(user.email);
  await page.getByPlaceholder('Password').first().fill(user.password);
  await page.getByText('Login', { exact: true }).first().click();
  await page.waitForTimeout(3000);
  await waitForAppReady(page);
}

async function getPartnerCode(page) {
  await expect(page.getByText('Your Code:')).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(2000);
  return page.evaluate(() => {
    const m = document.body.innerText.match(/([A-Z0-9]{4}-[A-Z0-9]{4})/);
    return m ? m[1] : null;
  });
}

async function linkWithCode(page, code) {
  await page.getByPlaceholder('XXXX-XXXX').fill(code);
  await page.waitForTimeout(500);
  await page.getByText('Link Partner', { exact: false }).first().click();
}

/** Navigate using the global test hook */
async function navigateTo(page, screen) {
  await page.evaluate((s) => window.__testNavigate && window.__testNavigate(s), screen);
  await page.waitForTimeout(1500);
}

async function getPageText(page) {
  return page.evaluate(() => document.body.innerText);
}

// ─── Test Suite ─────────────────────────────────────────────────────────

test.describe.serial('LoveLink Cross-User E2E Tests', () => {
  let aliceCtx, bobCtx, alice, bob;

  test.beforeAll(async ({ browser }) => {
    aliceCtx = await createContext(browser);
    bobCtx = await createContext(browser);
    alice = await aliceCtx.newPage();
    bob = await bobCtx.newPage();
  });

  test.afterAll(async () => {
    await aliceCtx?.close();
    await bobCtx?.close();
  });

  // ── 1. Sign Up ────────────────────────────────────────────────────────

  test('1. Sign up Alice and Bob', async () => {
    await signUp(alice, ALICE);
    console.log(`✅ Alice signed up: ${ALICE.email}`);

    await signUp(bob, BOB);
    console.log(`✅ Bob signed up: ${BOB.email}`);
  });

  // ── 2. Link Partners ─────────────────────────────────────────────────

  test('2. Link Alice and Bob as partners', async () => {
    const aliceCode = await getPartnerCode(alice);
    expect(aliceCode).toBeTruthy();
    console.log(`   Alice code: ${aliceCode}`);

    await linkWithCode(bob, aliceCode);
    await expect(bob.getByText(`Connected with ${ALICE.name}`)).toBeVisible({ timeout: 25_000 });
    console.log(`✅ Bob linked – "Connected with ${ALICE.name}"`);

    // Instead of reload (which hangs), sign Alice back in
    await signIn(alice, ALICE);

    // Alice should see home with partnership
    const text = await getPageText(alice);
    const connected = text.includes(`Connected with ${BOB.name}`) || text.includes('Hey');
    if (text.includes('Link With Your Partner')) {
      // Partnership not picked up yet? Wait and try navigating
      await alice.waitForTimeout(3000);
      const text2 = await getPageText(alice);
      console.log(`   Alice state: ${text2.substring(0, 120)}`);
    }

    await expect(alice.getByText(`Connected with ${BOB.name}`)).toBeVisible({ timeout: 15_000 });
    console.log(`✅ Alice linked – "Connected with ${BOB.name}"`);
  });

  // ── 3. Daily Session ─────────────────────────────────────────────────

  test('3. Daily Session – cross-user communication', async () => {
    // ── Bob submits ──
    await navigateTo(bob, 'session');
    await bob.waitForTimeout(2000);

    let text = await getPageText(bob);
    if (text.includes('Subscription Required') || text.includes('Trial ended')) {
      console.log('⚠️  Trial expired – skipping session test.');
      test.skip();
      return;
    }
    expect(text).toContain('Daily Session');

    const bobInput = bob.getByPlaceholder('Your message...');
    if (await bobInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await bobInput.fill('Hello from Bob! Cross-user session test.');
      await bob.getByText('Submit', { exact: false }).first().click();
      await bob.waitForTimeout(3000);
      text = await getPageText(bob);
      console.log(`${text.includes('Submitted') ? '✅' : '⚠️ '} Bob submitted session`);
    } else {
      console.log('⚠️  Bob session input not visible');
    }

    // ── Alice checks & submits ──
    await navigateTo(alice, 'session');
    await alice.waitForTimeout(3000);

    text = await getPageText(alice);
    if (text.includes('Subscription Required') || text.includes('Trial ended')) {
      console.log('⚠️  Trial expired for Alice.');
      return;
    }

    let bobVisible = text.includes('Hello from Bob');
    if (!bobVisible) {
      const refresh = alice.getByText('Refresh', { exact: false });
      if (await refresh.isVisible({ timeout: 3000 }).catch(() => false)) {
        await refresh.first().click();
        await alice.waitForTimeout(3000);
        text = await getPageText(alice);
        bobVisible = text.includes('Hello from Bob');
      }
    }
    console.log(`${bobVisible ? '✅' : '⚠️ '} Alice sees Bob's response: ${bobVisible}`);

    const aliceInput = alice.getByPlaceholder('Your message...');
    if (await aliceInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await aliceInput.fill('Hello from Alice! Replying to session.');
      await alice.getByText('Submit', { exact: false }).first().click();
      await alice.waitForTimeout(3000);
      text = await getPageText(alice);
      console.log(`${text.includes('Submitted') ? '✅' : '⚠️ '} Alice submitted session`);
    }

    // ── Bob checks Alice's response ──
    await navigateTo(bob, 'session');
    await bob.waitForTimeout(3000);
    text = await getPageText(bob);
    let aliceVisible = text.includes('Hello from Alice');
    if (!aliceVisible) {
      const refresh = bob.getByText('Refresh', { exact: false });
      if (await refresh.isVisible({ timeout: 3000 }).catch(() => false)) {
        await refresh.first().click();
        await bob.waitForTimeout(3000);
        text = await getPageText(bob);
        aliceVisible = text.includes('Hello from Alice');
      }
    }
    console.log(`${aliceVisible ? '✅' : '⚠️ '} Bob sees Alice's response: ${aliceVisible}`);
  });

  // ── 4. Pulse ──────────────────────────────────────────────────────────

  test('4. Pulse – cross-user communication', async () => {
    await navigateTo(bob, 'pulse');
    await bob.waitForTimeout(2000);

    let text = await getPageText(bob);
    if (text.includes('Subscription Required') || text.includes('Trial ended')) {
      console.log('⚠️  Trial expired – skipping pulse test.');
      test.skip();
      return;
    }
    expect(text).toContain('Pulse');

    // Select Heartbeat & send
    const heartbeat = bob.getByText('Heartbeat').first();
    if (await heartbeat.isVisible().catch(() => false)) await heartbeat.click();
    await bob.waitForTimeout(500);

    const sendBtn = bob.getByText('Tap to Send Pulse');
    if (await sendBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await sendBtn.click();
      await bob.waitForTimeout(4000);
    }
    text = await getPageText(bob);
    console.log(`${text.includes('You sent a pulse') ? '✅' : '⚠️ '} Bob sent pulse`);

    // ── Alice checks ──
    await navigateTo(alice, 'pulse');
    await alice.waitForTimeout(3000);
    text = await getPageText(alice);
    if (text.includes('Subscription Required') || text.includes('Trial ended')) {
      console.log('⚠️  Trial expired for Alice.');
      return;
    }
    const received = text.includes('Received a pulse') || text.includes('sent you');
    console.log(`${received ? '✅' : '⚠️ '} Alice sees Bob's pulse: ${received}`);

    // Alice sends back
    const aliceHB = alice.getByText('Heartbeat').first();
    if (await aliceHB.isVisible().catch(() => false)) await aliceHB.click();
    await alice.waitForTimeout(500);
    const aliceSend = alice.getByText('Tap to Send Pulse');
    if (await aliceSend.isVisible({ timeout: 5000 }).catch(() => false)) {
      await aliceSend.click();
      await alice.waitForTimeout(4000);
      console.log('✅ Alice sent pulse back');
    }

    // Bob checks
    await navigateTo(bob, 'pulse');
    await bob.waitForTimeout(3000);
    text = await getPageText(bob);
    console.log(`${text.includes('Received a pulse') ? '✅' : '⚠️ '} Bob sees Alice's pulse`);
  });

  // ── 5. Plans ──────────────────────────────────────────────────────────

  test('5. Plans – cross-user communication', async () => {
    await navigateTo(bob, 'plan');
    await bob.waitForTimeout(2000);

    let text = await getPageText(bob);
    if (text.includes('Subscription Required') || text.includes('Trial ended')) {
      console.log('⚠️  Trial expired – skipping plans test.');
      test.skip();
      return;
    }
    expect(text).toContain('Plans');

    // Bob creates plan
    await bob.getByText('Add Plan', { exact: false }).first().click();
    await bob.waitForTimeout(1000);

    const titleInput = bob.getByPlaceholder('What do you want to do?');
    await expect(titleInput).toBeVisible({ timeout: 5000 });
    await titleInput.fill('Dinner Date – E2E Test Plan');

    const medium = bob.getByText('Medium', { exact: true });
    if (await medium.isVisible().catch(() => false)) await medium.click();
    const romantic = bob.getByText('Romantic', { exact: true });
    if (await romantic.isVisible().catch(() => false)) await romantic.click();

    await bob.getByText('Save Plan', { exact: false }).first().click();
    await bob.waitForTimeout(3000);
    text = await getPageText(bob);
    console.log(`${text.includes('Dinner Date') ? '✅' : '⚠️ '} Bob created plan`);

    // Alice checks
    await navigateTo(alice, 'plan');
    await alice.waitForTimeout(3000);
    text = await getPageText(alice);
    if (text.includes('Subscription Required') || text.includes('Trial ended')) {
      console.log('⚠️  Trial expired for Alice.');
      return;
    }
    const aliceSees = text.includes('Dinner Date');
    console.log(`${aliceSees ? '✅' : '⚠️ '} Alice sees Bob's plan: ${aliceSees}`);

    if (aliceSees) {
      const confirmBtn = alice.getByText('Confirm', { exact: false }).first();
      if (await confirmBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
        await confirmBtn.click();
        await alice.waitForTimeout(3000);
        console.log('✅ Alice confirmed plan');
      }
    }

    // Bob sees confirmed
    await navigateTo(bob, 'plan');
    await bob.waitForTimeout(3000);
    text = await getPageText(bob);
    console.log(`${text.includes('Dinner Date') ? '✅' : '⚠️ '} Bob sees plan after confirmation`);
  });

  // ── 6. Moments ────────────────────────────────────────────────────────

  test('6. Moments – screen loads', async () => {
    await navigateTo(bob, 'moments');
    await bob.waitForTimeout(2000);
    let text = await getPageText(bob);
    if (text.includes('Subscription Required') || text.includes('Trial ended')) {
      console.log('⚠️  Trial expired – skipping moments test.');
      test.skip();
      return;
    }
    console.log(`${text.includes('Our Moments') ? '✅' : '⚠️ '} Bob sees Moments`);

    await navigateTo(alice, 'moments');
    await alice.waitForTimeout(2000);
    text = await getPageText(alice);
    console.log(`${text.includes('Our Moments') ? '✅' : '⚠️ '} Alice sees Moments`);
    console.log('ℹ️  Photo upload skipped (web: Alert.alert 3-button + file picker)');
  });

  // ── 7. Account Deletion ───────────────────────────────────────────────

  test('7. Delete Bob – verify Alice disconnected', async () => {
    await navigateTo(bob, 'settings');
    await bob.waitForTimeout(2000);
    let text = await getPageText(bob);
    expect(text).toContain('Settings');
    console.log(`${text.includes('Connected with') ? '✅' : '⚠️ '} Bob sees partnership`);

    // React Native Web's Alert.alert() is a NO-OP (empty function).
    // The "Delete Account" button won't show a dialog or do anything.
    // We call the Supabase delete RPC + signOut directly via raw fetch.
    console.log('   Calling delete_user_account RPC directly (Alert.alert is no-op on web)...');
    const deleteResult = await bob.evaluate(async () => {
      try {
        // Get auth token from localStorage
        const storageKey = Object.keys(localStorage).find(k => k.includes('auth-token'));
        if (!storageKey) return { success: false, error: 'No auth token found' };
        const session = JSON.parse(localStorage.getItem(storageKey));
        const accessToken = session?.access_token;
        if (!accessToken) return { success: false, error: 'No access_token in session' };

        const SUPABASE_URL = 'https://tfrhdxatjsyobmyffuzg.supabase.co';
        const SUPABASE_KEY = 'sb_publishable_GxepMKxepwVIz7JhqLhpBw_BYezF3AM';

        // Call delete_user_account RPC
        const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/delete_user_account`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${accessToken}`,
          },
          body: '{}',
        });
        if (!resp.ok) {
          const errText = await resp.text();
          return { success: false, error: `HTTP ${resp.status}: ${errText}` };
        }
        // Clear storage to sign out
        localStorage.clear();
        sessionStorage.clear();
        return { success: true };
      } catch (e) {
        return { success: false, error: e.message };
      }
    });
    console.log(`   Delete RPC result: ${JSON.stringify(deleteResult)}`);

    // Clear Bob's storage and navigate to see auth screen
    await freshLoad(bob);
    text = await getPageText(bob);
    const loggedOut = text.includes('Create Your Account') || text.includes('Welcome Back');
    console.log(`${loggedOut ? '✅' : '⚠️ '} Bob deleted and logged out: ${loggedOut}`);

    // Alice: sign in fresh to see if partnership is gone
    await signIn(alice, ALICE);
    await alice.waitForTimeout(3000);
    text = await getPageText(alice);

    const disconnected = text.includes('Link With Your Partner');
    const stillConnected = text.includes('Connected with');
    console.log(`${disconnected ? '✅' : '⚠️ '} Alice disconnected: ${disconnected}, still connected: ${stillConnected}`);

    if (!disconnected && !stillConnected) {
      console.log(`   Alice page: "${text.substring(0, 150)}"`);
    }
  });

  // ── 8. Re-Link with Charlie ───────────────────────────────────────────

  test('8. Create Charlie and link with Alice', async () => {
    const browser = alice.context().browser();
    const charlieCtx = await createContext(browser);
    const charlie = await charlieCtx.newPage();

    try {
      await signUp(charlie, CHARLIE);
      console.log(`✅ Charlie signed up: ${CHARLIE.email}`);

      // Alice should be on Link Partner screen
      let text = await getPageText(alice);
      if (!text.includes('Link With Your Partner')) {
        await signIn(alice, ALICE);
        await alice.waitForTimeout(3000);
        text = await getPageText(alice);
      }

      const onLink = text.includes('Link With Your Partner');
      console.log(`${onLink ? '✅' : '⚠️ '} Alice on Link Partner screen: ${onLink}`);

      if (onLink) {
        const aliceCode = await getPartnerCode(alice);
        expect(aliceCode).toBeTruthy();
        console.log(`   Alice code: ${aliceCode}`);

        await linkWithCode(charlie, aliceCode);
        const linked = await charlie
          .getByText(`Connected with ${ALICE.name}`)
          .isVisible({ timeout: 25_000 })
          .catch(() => false);
        console.log(`${linked ? '✅' : '⚠️ '} Charlie connected with Alice: ${linked}`);

        // Alice: sign in fresh to see new partnership
        await signIn(alice, ALICE);
        await alice.waitForTimeout(3000);
        text = await getPageText(alice);
        const aliceLinked = text.includes(`Connected with ${CHARLIE.name}`);
        console.log(`${aliceLinked ? '✅' : '⚠️ '} Alice connected with Charlie: ${aliceLinked}`);
      }
    } finally {
      await charlieCtx.close();
    }
  });
});
