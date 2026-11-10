# Asset sources

## Logo and deck illustrations

The logo in `logo/` and the cover illustrations in `deck-art/` were generated with AI specifically for Deckmate. The maintainer confirmed on 2026-11-07 that no third-party source images were used. These project assets are distributed under the repository's [AGPL-3.0-only license](../LICENSE).

The `characters`, `levels`, `story`, `agents`, `releases` and `ideas` covers were generated with OpenAI GPT Image 2 on 2026-11-09 using existing Deckmate covers as style references, then palette-quantized on a 100×70 pixel grid and saved as 600×420 lossless WebP.

The `backend`, `database`, `api`, `tests`, `security`, `pipelines`, `deploy`, `performance`, `mobile` and `analytics` covers were generated with OpenAI GPT Image 2 on 2026-11-10 using existing Deckmate covers as style references, then palette-quantized on a 100×70 pixel grid and saved as 600×420 lossless WebP.

## Screenshots and social preview

The images in `docs/screenshots/`, `docs/social-cards.png` and `docs/social-preview.png` are captured from Deckmate's fictional Moonwake Studio demo. The people, cards and project shown are sample content. Regenerate them from a fresh build with `npm run shots`; the social composition is defined in `docs/social-preview.html`.

## Fonts and bundled libraries

Fonts retain their upstream licenses and attribution:

- [Source Sans 3](fonts/source-sans-3/OFL.txt) — Adobe. The Latin and Cyrillic subsets come from `@fontsource-variable/source-sans-3` 5.2.9 and identify as font version 3.052; the notice reproduces their embedded copyright attribution.
- [Roboto Mono](fonts/roboto-mono/OFL.txt) — Google and its font authors.
- [Geist Mono](fonts/geist/OFL.txt) — the Geist project authors.
- [Assistant](fonts/assistant/OFL.txt) — the Assistant and Source Sans Pro authors; used by the bundled Excalidraw interface.

On first use, the Vision canvas downloads Excalidraw's handwritten fonts (Excalifont, Nunito and others) from esm.sh. These fonts are not included in the package.

The production build also emits `dist/client/third-party-licenses.md` for bundled JavaScript packages. Some of them (`@radix-ui/*`, `@excalidraw/excalidraw`, `fastdom`, `format`, `react-remove-scroll-bar`) ship no LICENSE file in their npm tarball, so their notices come from [third-party-notices.json](third-party-notices.json), keyed by package name and sourced from each upstream repository; the build fails when a bundled package has neither. The npm package includes the emitted file and the font license notices.

Notices for code embedded in prebuilt packages live in the `vendored` array of the same JSON file. The build fails on undeclared embedded code or an empty license section.
