// Regression playthrough for harvesting, persistence, the horizon and spawn safety.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
try {
  const page = await browser.newPage(), errors = [];
  await page.setViewport({ width: 1100, height: 700 });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/AudioContext encountered an error/.test(m.text())) errors.push(m.text()); });
  const ready = () => page.waitForFunction(() => !document.getElementById('goBtn').disabled, { timeout: 90000 });
  await page.goto(pathToFileURL(path.resolve('dist/thistlewick.html')).href + '?debug', { waitUntil: 'load' });
  await ready(); await page.click('#goBtn');
  await page.waitForFunction(() => window.__tw.survival().horizon > 200);
  const initial = await page.evaluate(() => window.__tw.survival());
  assert(initial.safe && initial.renderDistance === 320 && initial.far > initial.skyRadius);
  assert(initial.fog < 0.007);
  await page.evaluate(() => window.__tw.sleepNow());
  await page.waitForFunction(() => window.__tw.night() > 0.5);
  assert.equal(await page.evaluate(() => window.__tw.spawnTrial().added), 0);
  assert.equal(await page.evaluate(() => window.__tw.spawnBoss()), false);
  await page.evaluate(() => window.__tw.travel(65, 3));
  const wild = await page.evaluate(() => window.__tw.spawnTrial());
  assert(wild.added > 0 && wild.forbidden === 0, JSON.stringify(wild));
  await page.evaluate(() => { window.__tw.travel(0, 3); window.__tw.safetyTick(); });
  assert.equal(await page.evaluate(() => window.__tw.survival().enemies), 0);

  const resources = (await page.evaluate(() => window.__tw.resources())).filter(p => Math.abs(p.x) < 80 && Math.abs(p.z) < 80);
  const labels = ['Grass', 'Fern', 'Leaf litter', 'Twig', 'Loose stone', 'Red mushroom', 'Brown mushroom', 'Wildflower'];
  const harvested = [];
  for (const label of labels) {
    const p = resources.find(p => p.label === label);
    assert(p, 'generated resource: ' + label);
    assert.equal(await page.evaluate(id => window.__tw.fullPackGather(id), p.id), false);
    assert.equal((await page.evaluate(id => window.__tw.resourceState(id), p.id)).dead, false);
    const before = await page.evaluate(item => window.__tw.count(item), p.item);
    assert.equal(await page.evaluate(id => window.__tw.gather(id), p.id), true);
    assert.equal(await page.evaluate(item => window.__tw.count(item), p.item), before + 1);
    assert.deepEqual(await page.evaluate(id => window.__tw.resourceState(id), p.id), { dead: true, hidden: true });
    await page.evaluate(id => window.__tw.gather(id), p.id);
    assert.equal(await page.evaluate(item => window.__tw.count(item), p.item), before + 1, 'cannot duplicate a harvest');
    harvested.push(p.id);
  }
  // Use the actual camera ray and E interaction, including aiming down onto low plants.
  let aimed = false;
  for (const p of resources.filter(p => p.label === 'Grass' && !harvested.includes(p.id)).slice(0, 20)) {
    const result = await page.evaluate(id => window.__tw.aimResource(id), p.id);
    if (result === p.id) { assert.equal((await page.evaluate(id => window.__tw.resourceState(id), p.id)).dead, true); aimed = true; break; }
  }
  assert(aimed, 'camera targeting reaches harvestable grass');
  await page.evaluate(() => window.__tw.travel(0, 3));
  const woodSources = (await page.evaluate(() => window.__tw.woodSources())).filter(n => Math.abs(n.x) < 80 && Math.abs(n.z) < 80);
  const chopped = [];
  for (const label of ['Ancient trunk', 'Fallen log']) {
    const n = woodSources.find(n => n.label === label); assert(n, 'generated wood source: ' + label);
    await page.evaluate(n => window.__tw.travel(n.x, n.z), n);
    const before = await page.evaluate(() => window.__tw.count('wood'));
    assert(await page.evaluate(id => window.__tw.chopSource(id), n.id));
    assert((await page.evaluate(() => window.__tw.count('wood'))) > before);
    assert.deepEqual(await page.evaluate(id => window.__tw.woodState(id), n.id), { dead: true, colliders: 0 });
    chopped.push(n.id);
  }
  await page.evaluate(() => window.__tw.travel(0, 3));
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await page.reload({ waitUntil: 'load' }); await ready(); await page.click('#goBtn');
  await page.waitForFunction(() => document.getElementById('start').classList.contains('hidden'));
  for (const id of harvested) assert.deepEqual(await page.evaluate(id => window.__tw.resourceState(id), id), { dead: true, hidden: true }, 'harvest persists: ' + id);
  for (const id of chopped) assert.deepEqual(await page.evaluate(id => window.__tw.woodState(id), id), { dead: true, colliders: 0 }, 'wood clearing persists: ' + id);
  await page.screenshot({ path: 'dist/smoke-survival.png' });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ initial, wildernessSpawns: wild.added, harvested: labels, chopped, aimed, persistence: 'passed', errors }, null, 2));
} finally { await browser.close(); }
