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
// headless Chrome has no audio device, which WebAudio reports as a console error
page.on('console', m => { if (m.type() === 'error' && !/AudioContext encountered an error/.test(m.text())) errors.push('console: ' + m.text()); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
// a save lives in localStorage and IndexedDB, so a clean start clears both
const wipeSaves = () => page.evaluate(() => { localStorage.clear(); return new Promise(res => { const r = indexedDB.open('thistlewick', 1); r.onupgradeneeded = () => r.result.createObjectStore('saves'); r.onsuccess = () => { const tx = r.result.transaction('saves', 'readwrite'); tx.objectStore('saves').clear(); tx.oncomplete = () => { r.result.close(); res(); }; }; r.onerror = () => res(); }); });
const ready = () => page.waitForFunction(() => { const b = document.getElementById('goBtn'); return b && !b.disabled; }, { timeout: 90000 });
const text = sel => page.$eval(sel, e => e.textContent);
const visible = sel => page.$eval(sel, e => !e.classList.contains('hidden'));

await page.goto(pathToFileURL(html).href, { waitUntil: 'load' });
await wipeSaves();
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
check(arcs === 5, 'five arcs shown, got ' + arcs);
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

// save round trip (v3, with the world identity), then a v1 save must still load
await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
const saved = await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('thistlewick-save-v1') || 'null'); return d ? { v: d.v, inv: d.inv.length, journal: Array.isArray(d.journal) ? d.journal.length : -1, worldSeed: d.worldSeed, genVersion: d.genVersion } : null; });
check(saved && saved.v >= 4 && saved.journal >= 1, 'save is v4 or newer with a journal: ' + JSON.stringify(saved));
check(saved && saved.worldSeed !== 0 && saved.genVersion >= 2, 'a new world gets its own seed and the current generator: ' + JSON.stringify(saved));
await page.reload({ waitUntil: 'load' });
await ready();
const label2 = await text('#goBtn');
check(label2 === 'Continue', 'reload offers Continue, got ' + label2);
await page.click('#goBtn');
await sleep(1500);
await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
const resaved = await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('thistlewick-save-v1')); return { worldSeed: d.worldSeed, genVersion: d.genVersion }; });
check(resaved.worldSeed === saved.worldSeed && resaved.genVersion === saved.genVersion, 'Continue keeps the same world: ' + JSON.stringify(resaved));

// leave the running game first: its pagehide save would overwrite the tampered save on reload
await page.goto(pathToFileURL(html).href + '?idle', { waitUntil: 'load' });
await page.evaluate(() => {
  const d = JSON.parse(localStorage.getItem('thistlewick-save-v1'));
  delete d.journal; delete d.events; delete d.worldSeed; delete d.genVersion; d.edits = []; d.v = 1; d.inv[0] = ['wood', 5, undefined]; localStorage.setItem('thistlewick-save-v1', JSON.stringify(d));
});
await page.reload({ waitUntil: 'load' });
await ready();
await page.click('#goBtn');
await sleep(1500);
const goalAfterV1 = await text('#goalStep');
check(goalAfterV1 !== 'Punch a tree to gather wood', 'v1 save infers progress, goal is "' + goalAfterV1 + '"');
await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
const v1World = await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('thistlewick-save-v1')); return { v: d.v, worldSeed: d.worldSeed, genVersion: d.genVersion }; });
check(v1World.v >= 4 && v1World.worldSeed === 0 && v1World.genVersion === 1, 'an old save stays the original world: ' + JSON.stringify(v1World));

// gardening end to end through the debug hooks: plant, sleep a few nights, the crop grows and the dawn card says so
await page.goto(pathToFileURL(html).href + '?debug', { waitUntil: 'load' });
await wipeSaves();
await page.reload({ waitUntil: 'load' });
await ready();
await page.click('#goBtn');
await sleep(1500);
await page.evaluate(() => window.__tw.plant());
await sleep(300);
const planted = await page.evaluate(() => ({ crops: window.__tw.crops(), progress: window.__tw.progress() }));
check(planted.crops.length === 1 && planted.crops[0].stage === 0, 'one fresh crop planted: ' + JSON.stringify(planted.crops));
check(planted.progress.includes('place:crop') && planted.progress.includes('got:seed'), 'planting is recorded in the journal');
// the chronicle: digging and placing are recorded with the day, and feed the dawn card
const chron0 = await page.evaluate(() => window.__tw.chronicle());
await page.evaluate(() => window.__tw.dig());
const chron1 = await page.evaluate(() => window.__tw.chronicle());
check(chron1.events === chron0.events + 2 && chron1.sinceDawn.dug === chron0.sinceDawn.dug + 1 && chron1.sinceDawn.placed === chron0.sinceDawn.placed + 1, 'dig and place land in the chronicle: ' + JSON.stringify([chron0, chron1]));
let dawn = '', dawnAll = '', stage = 0, nights = 0;
while (stage < 1 && nights < 3) {
  await page.evaluate(() => window.__tw.sleepNow());
  await page.waitForFunction(() => window.__tw.night() > 0.5, { timeout: 30000 });
  await page.evaluate(() => window.__tw.bedAndSleep());
  await sleep(2600);
  nights++;
  dawn = await page.$eval('#dawn', e => (e.classList.contains('show') ? e.textContent : ''));
  dawnAll += ' | ' + dawn;
  stage = (await page.evaluate(() => window.__tw.crops()))[0].stage;
}
check(stage >= 1, 'crop grew after ' + nights + ' night(s), stage ' + stage);
check(/Day \d+ begins/.test(dawn), 'dawn card shown: "' + dawn + '"');
check(/Your garden: 1 crop grew/.test(dawn), 'dawn card mentions the garden: "' + dawn + '"');
check((await page.evaluate(() => window.__tw.progress())).includes('slept'), 'sleeping is recorded');
check(/Dug 1 block, placed 1/.test(dawnAll), 'the dawn card reports the reshaped land: "' + dawnAll + '"');
await page.screenshot({ path: 'dist/smoke-garden.png' });

// cottage end to end: a sealed room with bed, light and workbench attracts Bramble; doors keep it sealed; breaking the roof sends him away
const cot = await page.evaluate(() => window.__tw.buildCottage());
const closed = await page.evaluate(c => window.__tw.toggleDoor(c), cot); // first toggle opens it
check(closed.open && !closed.solidLow && !closed.solidHigh, 'an open door lets you through: ' + JSON.stringify(closed));
await page.evaluate(() => window.__tw.checkHomesNow());
const moved = await page.evaluate(() => ({ r: window.__tw.residents(), p: window.__tw.progress() }));
check(moved.r.length === 1 && moved.r[0].id === 'bramble', 'Bramble moved into the cottage with the door open: ' + JSON.stringify(moved.r));
check(moved.p.includes('cottage') && moved.p.includes('resident:bramble'), 'move-in is recorded in the journal');
const shut = await page.evaluate(c => window.__tw.toggleDoor(c), cot);
check(!shut.open && shut.solidLow && shut.solidHigh, 'a closed door blocks both cells: ' + JSON.stringify(shut));
await page.evaluate(() => window.__tw.talk());
const spoke = await page.evaluate(() => ({ text: window.__tw.speech(), f: window.__tw.friend('bramble') }));
check(spoke.text.length > 10 && spoke.f === 1, 'Bramble talks and friendship is 1: ' + JSON.stringify(spoke));
await page.evaluate(() => window.__tw.gift('croot'));
const gifted = await page.evaluate(() => ({ text: window.__tw.speech(), f: window.__tw.friend('bramble'), p: window.__tw.progress() }));
check(gifted.f === 5 && gifted.p.includes('gift:bramble') && gifted.p.includes('talk:bramble'), 'a loved gift adds 4 friendship: ' + JSON.stringify(gifted.f));
await page.screenshot({ path: 'dist/smoke-cottage.png' });
await page.evaluate(c => { window.__tw.breakRoof(c); window.__tw.checkHomesNow(); }, cot);
const left = await page.evaluate(() => ({ n: window.__tw.residents().length, f: window.__tw.friend('bramble') }));
check(left.n === 0 && left.f === 5, 'Bramble leaves when the roof is open, friendship is kept: ' + JSON.stringify(left));
await page.evaluate(c => { window.__tw.checkHomesNow(); }, cot);

// the chronicle survives a save and reload untouched
const chronBefore = await page.evaluate(() => window.__tw.chronicle().events);
await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
await page.reload({ waitUntil: 'load' });
await ready();
await page.click('#goBtn');
await sleep(1500);
const chronAfter = await page.evaluate(() => window.__tw.chronicle().events);
check(chronBefore >= 2 && chronAfter === chronBefore, 'chronicle reloads intact: ' + chronBefore + ' -> ' + chronAfter);

// a world too big for localStorage keeps saving: fill it to the brim, grow the save, and Continue must still restore everything from IndexedDB
const idbSave = () => page.evaluate(() => new Promise(res => { const r = indexedDB.open('thistlewick', 1); r.onsuccess = () => { const g = r.result.transaction('saves').objectStore('saves').get('thistlewick-save-v1'); g.onsuccess = () => res(g.result ? { v: JSON.parse(g.result.text).v, savedAt: g.result.savedAt } : null); }; r.onerror = () => res(null); }));
await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
await sleep(400);
const idb0 = await idbSave();
check(idb0 && idb0.v >= 4 && idb0.savedAt > 0, 'the save is also in IndexedDB: ' + JSON.stringify(idb0));
await page.evaluate(() => { let chunk = 1 << 20, k = 0; while (chunk >= 1) { try { localStorage.setItem('fill' + k++, 'x'.repeat(chunk)); } catch (e) { chunk >>= 1; } } });
await page.evaluate(() => { window.__tw.dig(); window.__tw.dig(); });
const chronBig = await page.evaluate(() => window.__tw.chronicle().events);
await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
await sleep(400);
const lsAfter = await page.evaluate(() => localStorage.getItem('thistlewick-save-v1'));
check(lsAfter === null, 'a save that does not fit does not leave a stale copy in localStorage');
await page.reload({ waitUntil: 'load' });
await ready();
check((await text('#goBtn')) === 'Continue', 'Continue is offered when only IndexedDB holds the save');
await page.click('#goBtn');
await sleep(1500);
const chronRestored = await page.evaluate(() => window.__tw.chronicle().events);
check(chronRestored === chronBig, 'the save restored from IndexedDB is the newest one: ' + chronBig + ' -> ' + chronRestored);
await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('fill')) localStorage.removeItem(k); });

// Elder Beetle: wakes, shows a health bar, takes damage, drops its carapace when beaten
await page.evaluate(() => window.__tw.travel(60, 3)); // Bosses cannot enter the starting sanctuary.
const woke = await page.evaluate(() => window.__tw.spawnBoss());
check(woke, 'the Elder Beetle can be spawned');
const barShown = await page.waitForFunction(() => !document.getElementById('boss').classList.contains('hidden'), { timeout: 30000 }).then(() => true, () => false);
check(barShown, 'the boss health bar is shown');
const b0 = await page.evaluate(() => window.__tw.boss());
await page.evaluate(() => window.__tw.hitBoss(30));
const b1 = await page.evaluate(() => window.__tw.boss());
check(b0 && b1 && b0.max === 240 && b1.hp <= b0.hp - 30, 'the boss takes at least 30 damage: ' + JSON.stringify([b0, b1]));
await page.evaluate(() => window.__tw.hitBoss(1000));
await page.waitForFunction(() => window.__tw.boss() === null, { timeout: 60000 });
const beaten = await page.evaluate(() => ({ p: window.__tw.progress(), eshell: window.__tw.count('eshell') }));
check(beaten.p.includes('kill:elder') && beaten.eshell >= 2, 'beating it is recorded and drops Elder carapace: ' + JSON.stringify(beaten.eshell));
check(await page.$eval('#boss', e => e.classList.contains('hidden')), 'the boss bar hides once it is gone');

console.log(JSON.stringify({ label, goalStep, arcs, logCount, invOpen, saved, label2, resaved, goalAfterV1, v1World, planted: planted.crops, nights, stage, dawn, cottage: { closed, moved: moved.r, spoke, gifted: gifted.f, left }, errors }, null, 1));
await browser.close();
process.exit(errors.length ? 1 : 0);
