import { ctx2d } from './dom';
import { TAU } from './constants';
import { ITEMS } from './items';
const iconCache: Record<string, string> = {};
export function icon(id: string): string {
  if (iconCache[id]) return iconCache[id];
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = ctx2d(c), d = ITEMS[id];
  const tc = ({ 1: '#b58a55', 2: '#9a9c9f', 3: '#d5dbe2', 4: '#5a3f86' } as Record<number, string>)[d.tier || 1];
  g.lineCap = 'round'; g.lineJoin = 'round';
  const line = (x1: number, y1: number, x2: number, y2: number, w: number, col: string) => { g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); };
  const poly = (pts: number[][], col: string, stroke?: string) => { g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.closePath(); g.fillStyle = col; g.fill(); if (stroke) { g.strokeStyle = stroke; g.lineWidth = 2; g.stroke(); } };
  const circ = (x: number, y: number, r: number, col: string) => { g.fillStyle = col; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); };
  if (d.tool === 'axe') { line(14, 54, 42, 16, 6, '#7a5230'); poly([[36, 8], [58, 16], [52, 34], [42, 26], [40, 18]], tc, '#2b2118'); }
  else if (d.tool === 'pick') { line(14, 54, 42, 16, 6, '#7a5230'); g.strokeStyle = tc; g.lineWidth = 8; g.beginPath(); g.moveTo(20, 20); g.quadraticCurveTo(44, -2, 60, 26); g.stroke(); }
  else if (d.tool === 'shovel') { line(14, 56, 38, 22, 6, '#7a5230'); poly([[36, 4], [58, 14], [52, 34], [30, 22]], tc, '#2b2118'); line(34, 12, 50, 26, 2, 'rgba(255,255,255,.35)'); }
  else if (d.tool === 'sword') { line(16, 48, 52, 12, 8, tc); line(16, 48, 52, 12, 2, 'rgba(255,255,255,.55)'); line(14, 38, 30, 54, 6, '#7a5230'); line(10, 54, 20, 44, 6, '#4a3020'); }
  else if (d.k === 'shield') { poly([[32, 5], [55, 13], [54, 38], [32, 60], [10, 38], [9, 13]], id === 'cshield' ? '#33254d' : tc, '#2b2118'); if (id === 'wshield') { line(21, 10, 21, 46, 2, '#5a3a1a'); line(43, 10, 43, 46, 2, '#5a3a1a'); } circ(32, 30, 8, id === 'cshield' ? '#8f6bd6' : '#d8b04a'); circ(32, 30, 4, 'rgba(0,0,0,.25)'); }
  else switch (id) {
    case 'wood': poly([[10, 22], [54, 22], [54, 46], [10, 46]], '#7b5330', '#2b1a0c'); g.fillStyle = '#c99a5a'; g.beginPath(); g.ellipse(54, 34, 5, 12, 0, 0, TAU); g.fill(); g.strokeStyle = '#8a5a2a'; g.beginPath(); g.ellipse(54, 34, 2.5, 6, 0, 0, TAU); g.stroke(); break;
    case 'stick': line(12, 52, 52, 12, 6, '#7a5230'); line(30, 34, 44, 40, 3, '#7a5230'); break;
    case 'plank': for (let i = 0; i < 3; i++) poly([[8, 12 + i * 16], [56, 12 + i * 16], [56, 24 + i * 16], [8, 24 + i * 16]], i % 2 ? '#c69258' : '#b98450', '#5a3a1a'); break;
    case 'stone': poly([[10, 44], [16, 22], [34, 12], [52, 22], [56, 42], [36, 54]], '#8d8f93', '#3a3b3d'); poly([[22, 24], [34, 16], [44, 24], [30, 30]], '#b4b6ba'); break;
    case 'ladder': line(18, 6, 18, 58, 6, '#9a6a3a'); line(46, 6, 46, 58, 6, '#9a6a3a'); for (let q = 0; q < 5; q++) line(18, 12 + q * 11, 46, 12 + q * 11, 5, '#b98450'); break;
    case 'meat': case 'cmeat': g.fillStyle = id === 'meat' ? '#d9707a' : '#8a4a2a'; g.beginPath(); g.ellipse(28, 26, 20, 16, -0.4, 0, TAU); g.fill(); g.fillStyle = id === 'meat' ? '#f0a0a8' : '#b5703e'; g.beginPath(); g.ellipse(24, 22, 9, 6, -0.4, 0, TAU); g.fill(); line(38, 38, 52, 54, 7, '#efe6cf'); circ(54, 56, 5, '#efe6cf'); break;
    case 'coal': poly([[10, 44], [16, 22], [34, 12], [52, 22], [56, 42], [36, 54]], '#2a2a2e', '#0d0d10'); poly([[22, 24], [34, 17], [42, 25], [30, 30]], '#5a5a64'); break;
    case 'sand': poly([[6, 10], [58, 10], [58, 56], [6, 56]], '#dccb8b', '#8a7a48'); for (let q = 0; q < 14; q++) circ(10 + (q * 31) % 46, 14 + (q * 19) % 40, 1.6, q % 2 ? '#b9a765' : '#efe0a4'); break;
    case 'gravel': poly([[6, 10], [58, 10], [58, 56], [6, 56]], '#7d7d7f', '#3a3a3c'); for (let q = 0; q < 9; q++) circ(12 + (q * 29) % 42, 16 + (q * 17) % 36, 4 + q % 3, q % 2 ? '#a4a4a8' : '#5a5a5d'); break;
    case 'snow': poly([[6, 10], [58, 10], [58, 56], [6, 56]], '#eef3f8', '#9db0c4'); poly([[6, 10], [58, 10], [58, 20], [6, 20]], '#ffffff'); break;
    case 'crystal': poly([[32, 4], [50, 28], [32, 60], [14, 28]], '#4fd6f2', '#1a6a86'); poly([[32, 4], [50, 28], [32, 30]], '#b8f6ff'); poly([[32, 30], [50, 28], [32, 60]], '#2a9ab8'); break;
    case 'torch': line(32, 58, 32, 26, 7, '#7a5230'); g.fillStyle = '#ffb02e'; g.beginPath(); g.moveTo(32, 4); g.quadraticCurveTo(46, 20, 40, 30); g.quadraticCurveTo(32, 34, 24, 30); g.quadraticCurveTo(18, 20, 32, 4); g.fill(); g.fillStyle = '#ffe58a'; g.beginPath(); g.moveTo(32, 16); g.quadraticCurveTo(38, 26, 32, 30); g.quadraticCurveTo(26, 26, 32, 16); g.fill(); break;
    case 'dirt': poly([[6, 10], [58, 10], [58, 56], [6, 56]], '#6b5034', '#2b1c0e'); poly([[6, 10], [58, 10], [58, 22], [6, 22]], '#8a5a2a'); for (let q = 0; q < 12; q++) circ(10 + (q * 37) % 46, 26 + (q * 23) % 28, 2, q % 2 ? '#4a3622' : '#93754a'); break;
    case 'brick': for (let r = 0; r < 3; r++) for (let b = 0; b < 2; b++) poly([[6 + b * 26 + (r % 2 ? 13 : 0), 10 + r * 16], [30 + b * 26 + (r % 2 ? 13 : 0), 10 + r * 16], [30 + b * 26 + (r % 2 ? 13 : 0), 24 + r * 16], [6 + b * 26 + (r % 2 ? 13 : 0), 24 + r * 16]], '#8f9296', '#3a3b3d'); break;
    case 'fiber': for (let i = 0; i < 5; i++) { g.strokeStyle = i % 2 ? '#c9d67a' : '#9bb14a'; g.lineWidth = 4; g.beginPath(); g.moveTo(32, 56); g.quadraticCurveTo(14 + i * 9, 30, 6 + i * 13, 8 + (i % 2) * 8); g.stroke(); } break;
    case 'berries': circ(22, 40, 11, '#c0223a'); circ(42, 38, 11, '#d92a44'); circ(32, 22, 11, '#a91c33'); line(32, 12, 36, 4, 3, '#3f7a2a'); break;
    case 'mushroom': case 'cmush': g.fillStyle = id === 'cmush' ? '#8a4a1e' : '#c9a066'; g.beginPath(); g.ellipse(32, 28, 24, 16, 0, Math.PI, 0); g.fill(); poly([[26, 28], [38, 28], [40, 54], [24, 54]], '#efe6cf', '#7a6a4a'); if (id === 'cmush') { circ(24, 22, 3, '#5a2c0e'); circ(40, 20, 3, '#5a2c0e'); } break;
    case 'ore': poly([[10, 44], [16, 22], [34, 12], [52, 22], [56, 42], [36, 54]], '#6f7175', '#2a2b2d'); circ(24, 32, 5, '#d9762a'); circ(40, 26, 4, '#e88a3a'); circ(38, 42, 5, '#c9601c'); break;
    case 'ingot': poly([[8, 44], [20, 22], [50, 22], [58, 44]], '#e3e8ee', '#4a5058'); poly([[8, 44], [58, 44], [58, 52], [8, 52]], '#a9b0b8', '#4a5058'); break;
    case 'shell': g.fillStyle = '#33254d'; g.beginPath(); g.ellipse(32, 34, 24, 18, 0, 0, TAU); g.fill(); g.strokeStyle = '#8f6bd6'; g.lineWidth = 3; g.beginPath(); g.moveTo(32, 16); g.lineTo(32, 52); g.stroke(); g.beginPath(); g.ellipse(32, 34, 24, 18, 0, 0, TAU); g.stroke(); break;
    case 'seed': for (let q = 0; q < 5; q++) { g.fillStyle = q % 2 ? '#c9a066' : '#a8814a'; g.beginPath(); g.ellipse(18 + (q * 13) % 34, 22 + (q * 17) % 26, 7, 4.5, q * 0.7, 0, TAU); g.fill(); g.strokeStyle = '#4a3320'; g.lineWidth = 1.5; g.stroke(); } break;
    case 'root': case 'croot': g.fillStyle = id === 'croot' ? '#a8642c' : '#8a4f9e'; g.beginPath(); g.ellipse(32, 36, 17, 19, 0, 0, TAU); g.fill(); g.fillStyle = id === 'croot' ? '#c98a4a' : '#b479c4'; g.beginPath(); g.ellipse(27, 30, 7, 9, -0.4, 0, TAU); g.fill(); line(32, 18, 24, 6, 4, '#4f8f2c'); line(32, 18, 34, 5, 4, '#6fb03a'); line(32, 18, 44, 8, 4, '#4f8f2c'); break;
    case 'bandage': poly([[8, 22], [56, 22], [56, 42], [8, 42]], '#f1ece0', '#7a746a'); line(32, 26, 32, 38, 5, '#d9483b'); line(26, 32, 38, 32, 5, '#d9483b'); break;
    case 'workbench': poly([[6, 26], [58, 26], [58, 34], [6, 34]], '#c69258', '#4a2f14'); line(12, 34, 12, 56, 6, '#8a5a2a'); line(52, 34, 52, 56, 6, '#8a5a2a'); line(20, 20, 34, 20, 4, '#9aa0a8'); break;
    case 'furnace': poly([[8, 12], [56, 12], [56, 58], [8, 58]], '#8c8e92', '#33343a'); poly([[20, 32], [44, 32], [44, 54], [20, 54]], '#1a1210'); poly([[26, 42], [38, 42], [38, 54], [26, 54]], '#f08a2a'); break;
    case 'campfire': line(10, 52, 54, 40, 7, '#6b4526'); line(10, 40, 54, 52, 7, '#7b5330'); g.fillStyle = '#f7a233'; g.beginPath(); g.moveTo(32, 6); g.quadraticCurveTo(52, 30, 40, 42); g.quadraticCurveTo(32, 46, 24, 42); g.quadraticCurveTo(14, 30, 32, 6); g.fill(); g.fillStyle = '#ffe07a'; g.beginPath(); g.moveTo(32, 24); g.quadraticCurveTo(42, 38, 32, 44); g.quadraticCurveTo(22, 38, 32, 24); g.fill(); break;
    case 'bed': poly([[6, 34], [58, 34], [58, 50], [6, 50]], '#8a5a2a', '#3a2410'); poly([[8, 26], [58, 26], [58, 36], [8, 36]], '#c9483b', '#5a1a14'); poly([[10, 20], [28, 20], [28, 30], [10, 30]], '#f4efe4', '#7a746a'); break;
    default: circ(32, 32, 16, '#999');
  }
  return iconCache[id] = c.toDataURL();
}
