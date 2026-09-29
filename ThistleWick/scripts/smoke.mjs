// Headless browser smoke test: boots dist/thistlewick.html, plays a few seconds, exercises the journal UI and saves,
// and fails on any console error. Usage: node scripts/smoke.mjs [html-path] [screenshot-path]
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';

const html = path.resolve(process.argv[2] || 'dist/thistlewick.html');
const shot = process.argv[3] || 'dist/smoke.png';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
const browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1100, height: 700 });
const errors = [];
const check = (ok, msg) => { if (!ok) errors.push('check failed: ' + msg); };
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ready = () => page.waitForFunction(() => { const b = document.getElementById('goBtn'); return b && !b.disabled; }, { timeout: 90000 });
const text = sel => page.$eval(sel, e => e.textContent);
const visible = sel => page.$eval(sel, e => !e.classList.contains('hidden'));

await page.goto(pathToFileURL(html).href, { waitUntil: 'load' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'load' });
await ready();
const label = await text('#goBtn');
await page.click('#goBtn');
for (const k of ['KeyW', 'KeyD']) await page.keyboard.down(k);
await sleep(4000);
for (const k of ['KeyW', 'KeyD']) await page.keyboard.up(k);

// goal panel and journal overlay
const goalStep = await text('#goalStep');
check(goalStep === 'Punch a tree to gather wood', 'first goal is "' + goalStep + '"');
await page.keyboard.press('KeyJ');
await sleep(300);
check(await visible('#journal'), 'J opens the journal');
const arcs = await page.$$eval('.arc', a => a.length);
check(arcs === 4, 'four arcs shown, got ' + arcs);
await page.click('#jtLog');
const logCount = await text('#jCount');
check(/^\d+\/\d+$/.test(logCount), 'log count "' + logCount + '"');
await page.screenshot({ path: shot });
await page.keyboard.press('Escape');
await sleep(200);
check(!(await visible('#journal')), 'Escape closes the journal');

// pack still works, and Tab closes the journal instead of stacking
await page.keyboard.press('Tab');
await sleep(300);
const invOpen = await visible('#inv');
check(invOpen, 'Tab opens the pack');
await page.keyboard.press('Tab');

// save round trip (v2), then a v1 save must still load
await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
const saved = await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('thistlewick-save-v1') || 'null'); return d ? { v: d.v, inv: d.inv.length, journal: Array.isArray(d.journal) ? d.journal.length : -1 } : null; });
check(saved && saved.v === 2 && saved.journal >= 1, 'save is v2 with a journal: ' + JSON.stringify(saved));
await page.reload({ waitUntil: 'load' });
await ready();
const label2 = await text('#goBtn');
check(label2 === 'Continue', 'reload offers Continue, got ' + label2);

await page.evaluate(() => {
  const d = JSON.parse(localStorage.getItem('thistlewick-save-v1'));
  delete d.journal; d.v = 1; d.inv[0] = ['wood', 5, undefined]; localStorage.setItem('thistlewick-save-v1', JSON.stringify(d));
});
await page.reload({ waitUntil: 'load' });
await ready();
await page.click('#goBtn');
await sleep(1500);
const goalAfterV1 = await text('#goalStep');
check(goalAfterV1 !== 'Punch a tree to gather wood', 'v1 save infers progress, goal is "' + goalAfterV1 + '"');

// gardening end to end through the debug hooks: plant, sleep a few nights, the crop grows and the dawn card says so
await page.goto(pathToFileURL(html).href + '?debug', { waitUntil: 'load' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'load' });
await ready();
await page.click('#goBtn');
await sleep(1500);
await page.evaluate(() => window.__tw.plant());
await sleep(300);
const planted = await page.evaluate(() => ({ crops: window.__tw.crops(), progress: window.__tw.progress() }));
check(planted.crops.length === 1 && planted.crops[0].stage === 0, 'one fresh crop planted: ' + JSON.stringify(planted.crops));
check(planted.progress.includes('place:crop') && planted.progress.includes('got:seed'), 'planting is recorded in the journal');
let dawn = '', stage = 0, nights = 0;
while (stage < 1 && nights < 3) {
  await page.evaluate(() => window.__tw.sleepNow());
  await page.waitForFunction(() => window.__tw.night() > 0.5, { timeout: 30000 });
  await page.evaluate(() => window.__tw.bedAndSleep());
  await sleep(2600);
  nights++;
  dawn = await page.$eval('#dawn', e => (e.classList.contains('show') ? e.textContent : ''));
  stage = (await page.evaluate(() => window.__tw.crops()))[0].stage;
}
check(stage >= 1, 'crop grew after ' + nights + ' night(s), stage ' + stage);
check(/Day \d+ begins/.test(dawn), 'dawn card shown: "' + dawn + '"');
check(/Your garden: 1 crop grew/.test(dawn), 'dawn card mentions the garden: "' + dawn + '"');
check((await page.evaluate(() => window.__tw.progress())).includes('slept'), 'sleeping is recorded');
await page.screenshot({ path: 'dist/smoke-garden.png' });

console.log(JSON.stringify({ label, goalStep, arcs, logCount, invOpen, saved, label2, goalAfterV1, planted: planted.crops, nights, stage, dawn, errors }, null, 1));
await browser.close();
process.exit(errors.length ? 1 : 0);
