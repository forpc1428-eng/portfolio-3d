# Nebula Drift — Vedant Bhayani

A scroll-driven 3D portfolio built with three.js. Scrolling flies the camera through a procedural nebula, past one planet per section.

**Live site:** https://forpc1428-eng.github.io/portfolio-3d/

## Features
- Fullscreen raymarched-style nebula (domain-warped fractal noise) whose colours shift per section
- 15k twinkling stars with real stellar colour temperatures
- Five shader planets with banded surfaces, fresnel rim light, glowing atmospheres and particle rings
- Volumetric cloud billboards you fly through
- Bloom, film grain, vignette and chromatic aberration post-processing
- Live HUD (depth, velocity, sector) and smooth scroll-driven camera with mouse parallax
- Quality tiers and adaptive resolution for phones, plus reduced-motion and no-WebGL fallbacks

## Editing
- All text lives in `index.html`. Project cards link to GitHub repos; replace descriptions and add email or socials in the Contact section.
- 3D scene and shaders are in `main.js`. Section colours are in the `PALETTES` array.

## Run locally
No build step. Serve the folder with any static server:
```bash
npx serve .
```
