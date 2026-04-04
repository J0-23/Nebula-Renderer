# Nebula Renderer

_Because watching math make pretty pictures is endlessly satisfying._

Feed it a fractal formula, let it trace a few million escape paths, watch an image emerge from the noise. Like a slow-motion firework show, but it's just equations.

**Try it**: https://nebularenderer.netlify.app/

## How it works

1. Pick a starting point in the complex plane
2. Iterate the formula — does it escape to infinity?
3. If yes, trace every step of its path
4. Repeat a few million times
5. Collect all the hits into a heatmap
6. Tone map, color, post-process
7. Something beautiful appears

Web Workers spread the work across every CPU core you have. SharedArrayBuffer makes it even faster if your browser supports it.

## Presets to start with

Galaxy Cloud · Twisted · Buddhabrot · Anti-Buddhabrot · Burning Ship · Tricorn · Celtic

## Fun things to try

- Crank quality to **Ultra** and watch your CPU melt
- Toggle **Julia mode** and adjust C values
- Stack symmetry modes for kaleidoscope effects
- Build a custom formula in the editor and break everything

## Stack

Vanilla JS · Web Workers · zero dependencies · no build step

---

Made with curiosity and too much coffee.
