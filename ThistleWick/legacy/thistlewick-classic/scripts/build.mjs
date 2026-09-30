// Bundles src/main.ts with esbuild into dist/game.js and an inlined single-file dist/thistlewick.html.
// Usage: node scripts/build.mjs [--watch]
import { build, context } from 'esbuild';
import fs from 'node:fs';

const opts = { entryPoints: ['src/main.ts'], bundle: true, format: 'iife', target: 'es2020', outfile: 'dist/game.js', minify: !process.argv.includes('--watch'), sourcemap: false, logLevel: 'info' };

function inline() {
  const html = fs.readFileSync('index.html', 'utf8');
  const tag = '<script src="dist/game.js"></script>';
  if (!html.includes(tag)) throw new Error('index.html is missing ' + tag);
  const js = fs.readFileSync('dist/game.js', 'utf8').replace(/<\/script/gi, '<\/script');
  fs.writeFileSync('dist/thistlewick.html', html.replace(tag, () => '<script>\n' + js + '\n</script>'));
  console.log('wrote dist/thistlewick.html', fs.statSync('dist/thistlewick.html').size, 'bytes');
}

if (process.argv.includes('--watch')) {
  const ctx = await context({ ...opts, plugins: [{ name: 'inline', setup(b) { b.onEnd(() => inline()); } }] });
  await ctx.watch();
} else {
  await build(opts);
  inline();
}
