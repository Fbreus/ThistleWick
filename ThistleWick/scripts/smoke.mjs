// Headless browser smoke test: boots dist/thistlewick.html, starts a game, plays a few seconds, reports console errors.
// Usage: node scripts/smoke.mjs [html-path] [screenshot-path]
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
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.goto(pathToFileURL(html).href, { waitUntil: 'load' });
await page.evaluate(() => localStorage.clear());
await page.goto(pathToFileURL(html).href, { waitUntil: 'load' });
await page.waitForFunction(() => { const b = document.getElementById('goBtn'); return b && !b.disabled; }, { timeout: 90000 });
const label = await page.$eval('#goBtn', b => b.textContent);
await page.click('#goBtn');
for (const k of ['KeyW', 'KeyD']) await page.keyboard.down(k);
await new Promise(r => setTimeout(r, 4000));
await page.keyboard.press('Tab');
await new Promise(r => setTimeout(r, 500));
const inv = await page.$eval('#inv', e => !e.classList.contains('hidden'));
await page.screenshot({ path: shot });
const hud = await page.$eval('#clockS', e => e.textContent);
// save round trip: pagehide saves, a reload must offer Continue
await page.keyboard.press('Tab');
await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
const saved = await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('thistlewick-save-v1') || 'null'); return d ? { v: d.v, inv: d.inv.length, hasP: !!d.P } : null; });
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => { const b = document.getElementById('goBtn'); return b && !b.disabled; }, { timeout: 90000 });
const label2 = await page.$eval('#goBtn', b => b.textContent);
if (label2 !== 'Continue' || !saved) errors.push('save round trip failed: ' + JSON.stringify({ saved, label2 }));
console.log(JSON.stringify({ label, invOpen: inv, hud, saved, label2, errors }, null, 1));
await browser.close();
process.exit(errors.length ? 1 : 0);
