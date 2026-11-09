// Desktop layout: on a wide screen with a mouse the main tabs sit inside the
// header, aligned with the content column, and sub-tabs shrink to fit. On a
// phone (and a touch-only tablet) the stacked phone layout must not change.
import { BASE, chromium, reporter } from './lib.mjs';

const { step, done } = reporter();
const browser = await (await chromium()).launch();

async function measure(page) {
  return page.evaluate(() => {
    const r = (s) => document.querySelector(s).getBoundingClientRect();
    const header = r('.app-header');
    const tabbar = r('.tabbar');
    const title = r('.app-title');
    const view = document.querySelector('.view');
    const pad = parseFloat(getComputedStyle(view).paddingLeft);
    return {
      header, tabbar, title,
      contentLeft: view.getBoundingClientRect().left + pad,
      contentRight: view.getBoundingClientRect().right - pad,
      gear: r('#settings-btn'),
      seg: r('.segmented'),
      tap: getComputedStyle(document.documentElement).getPropertyValue('--tap').trim(),
      doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
}

async function open(viewport, opts = {}) {
  const ctx = await browser.newContext({ viewport, ...opts });
  const page = await ctx.newPage();
  await page.goto(BASE + '#/logs');
  await page.evaluate(() => localStorage.setItem('ft.welcomed', '1'));
  await page.reload();
  await page.waitForSelector('.segmented button');
  return page;
}

// ---- desktop ----
let page = await open({ width: 1440, height: 900 });
let m = await measure(page);
step('desktop: main tabs share the header row', m.tabbar.top < m.header.bottom && m.tabbar.bottom <= m.header.bottom + 1,
  `tabbar ${m.tabbar.top}-${m.tabbar.bottom}, header ends ${m.header.bottom}`);
step('desktop: title lines up with the content column', Math.abs(m.title.left - m.contentLeft) <= 1,
  `${m.title.left} vs ${m.contentLeft}`);
step('desktop: settings button lines up with its right edge', Math.abs(m.gear.right - m.contentRight) <= 1,
  `${m.gear.right} vs ${m.contentRight}`);
step('desktop: tabs do not overlap the title or actions', m.tabbar.left > m.title.right && m.tabbar.right < m.gear.left);
step('desktop: sub-tabs shrink to fit', m.seg.width < (m.contentRight - m.contentLeft) / 2, `${m.seg.width}px`);
step('desktop: denser controls', m.tap === '36px', m.tap);
await page.click('.tabbar button:has-text("Plans")');
const navigated = await page.waitForSelector('.tabbar button.active:has-text("Plans")', { timeout: 3000 }).then(() => true, () => false);
step('desktop: header tabs still navigate', navigated && (await page.evaluate(() => location.hash)) === '#/plans');
await page.mouse.wheel(0, 2000);
m = await measure(page);
step('desktop: tabs stay put while scrolling', m.tabbar.top === 0 && m.header.top === 0);

// The narrowest width the desktop layout applies at.
page = await open({ width: 960, height: 700 });
m = await measure(page);
step('960px: nothing collides', m.tabbar.left > m.title.right && m.tabbar.right < m.gear.left && m.doc <= 0);

// ---- phone: unchanged ----
page = await open({ width: 390, height: 820 }, { hasTouch: true, isMobile: true });
m = await measure(page);
step('phone: tabs stay below the header', m.tabbar.top >= m.header.bottom - 1);
step('phone: sub-tabs span the width', m.seg.width >= (m.contentRight - m.contentLeft) - 1);
step('phone: touch-sized controls', m.tap === '44px', m.tap);

// A wide touch-only tablet keeps the phone layout too.
page = await open({ width: 1180, height: 820 }, { hasTouch: true, isMobile: true });
m = await measure(page);
step('touch tablet: phone layout kept', m.tabbar.top >= m.header.bottom - 1 && m.tap === '44px');

await done(browser);
