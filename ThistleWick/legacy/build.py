#!/usr/bin/env python3
"""Builds one self-contained dist/thistlewick.html from index.html + worldgen.js + game.js.
Usage: python build.py"""
import os, sys
here = os.path.dirname(os.path.abspath(__file__))
read = lambda n: open(os.path.join(here, n), encoding='utf-8').read()
html = read('index.html')
for name in ('worldgen.js', 'game.js'):
    tag = '<script src="%s"></script>' % name
    if tag not in html: sys.exit('missing %s in index.html' % tag)
    html = html.replace(tag, '<script>\n' + read(name).strip('\n') + '\n</script>')
os.makedirs(os.path.join(here, 'dist'), exist_ok=True)
out = os.path.join(here, 'dist', 'thistlewick.html')
open(out, 'w', encoding='utf-8').write(html)
print('wrote', out, len(html), 'bytes')
