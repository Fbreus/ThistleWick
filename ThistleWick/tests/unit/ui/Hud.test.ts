// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import { dayOf, formatClock, Hud, timeOfDayLabel } from '@/ui/Hud';

import { createRoot } from './helpers';

function rowValue(key: string): string {
  const row = document.querySelector<HTMLElement>(`[data-testid="hud-row"][data-row="${key}"]`);
  return row?.querySelector('.hud__value')?.textContent ?? '';
}

describe('Hud time formatting', () => {
  it('maps tick 0 to 06:00 and 6000 to 12:00', () => {
    expect(formatClock(0)).toBe('06:00');
    expect(formatClock(6000)).toBe('12:00');
    expect(formatClock(12000)).toBe('18:00');
    expect(formatClock(18000)).toBe('00:00');
  });

  it('wraps out-of-range and negative ticks', () => {
    expect(formatClock(24000)).toBe('06:00');
    expect(formatClock(-6000)).toBe('00:00');
    expect(dayOf(-1)).toBe(1);
  });

  it('counts days from one and names the four phases', () => {
    expect(dayOf(0)).toBe(1);
    expect(dayOf(24000)).toBe(2);
    expect(timeOfDayLabel(0)).toBe('Dawn');
    expect(timeOfDayLabel(6000)).toBe('Day');
    expect(timeOfDayLabel(12000)).toBe('Dusk');
    expect(timeOfDayLabel(16000)).toBe('Night');
  });
});

describe('Hud', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders one row per reading and starts hidden', () => {
    const hud = new Hud(createRoot());

    const element = document.querySelector<HTMLElement>('[data-testid="hud"]');
    expect(element).not.toBeNull();
    expect(element?.hidden).toBe(true);
    expect(element?.dataset['position']).toBe('bottom-left');
    expect(document.querySelectorAll('[data-testid="hud-row"]')).toHaveLength(6);
    expect(hud.visible).toBe(false);
  });

  it('writes the snapshot into the rows', () => {
    const hud = new Hud(createRoot());
    hud.show();
    hud.update({
      position: { x: 12.34, y: 68, z: -31.8 },
      chunk: { x: 0, z: -2 },
      biome: 'Plains',
      timeTicks: 6000,
      facing: 'North',
      fps: 59.6,
    });

    expect(hud.visible).toBe(true);
    expect(rowValue('position')).toBe('12.3 68.0 -31.8');
    expect(rowValue('chunk')).toBe('0, -2');
    expect(rowValue('biome')).toBe('Plains');
    expect(rowValue('time')).toBe('12:00 · Day · Day 1');
    expect(rowValue('facing')).toBe('North');
    expect(rowValue('fps')).toBe('60 FPS');
  });

  it('hides the optional rows when the data is absent', () => {
    const hud = new Hud(createRoot());
    hud.update({
      position: { x: 0, y: 0, z: 0 },
      chunk: { x: 0, z: 0 },
      biome: 'Ocean',
      timeTicks: 0,
    });

    const facing = document.querySelector<HTMLElement>(
      '[data-testid="hud-row"][data-row="facing"]',
    );
    const fps = document.querySelector<HTMLElement>('[data-testid="hud-row"][data-row="fps"]');
    expect(facing?.hidden).toBe(true);
    expect(fps?.hidden).toBe(true);
    expect(rowValue('biome')).toBe('Ocean');
  });

  it('never prints NaN for a non-finite coordinate', () => {
    const hud = new Hud(createRoot());
    hud.update({
      position: { x: Number.NaN, y: 1, z: Number.POSITIVE_INFINITY },
      chunk: { x: 1.7, z: 2.2 },
      biome: '',
      timeTicks: 0,
      fps: null,
    });

    expect(rowValue('position')).toBe('— 1.0 —');
    expect(rowValue('chunk')).toBe('1, 2');
    expect(rowValue('biome')).toBe('Unknown');
  });

  it('honours the top-left variant and removes itself on dispose', () => {
    const root = createRoot();
    const hud = new Hud(root, { position: 'top-left' });
    const element = document.querySelector<HTMLElement>('[data-testid="hud"]');
    expect(element?.classList.contains('hud--top-left')).toBe(true);

    hud.dispose();
    expect(root.querySelector('[data-testid="hud"]')).toBeNull();
  });
});
