/**
 * Layout constants shared between the static splash image (assets/images/
 * splash-icon.png / splash-icon-dark.png, referenced from app.config.ts) and
 * AnimatedSplash (components/animated-splash.tsx).
 *
 * The static PNGs contain nothing but the "The Locals" wordmark, symmetrically
 * padded and centered within their own canvas — so once expo-splash-screen's
 * "contain" resize mode centers the image on screen, the wordmark's visual
 * center lands exactly on the screen's center. AnimatedSplash relies on that:
 * it renders the same wordmark centered on screen with a matching font size,
 * with no separate position math needed.
 *
 * If the source PNGs are ever regenerated at a different font size/padding,
 * update SPLASH_WORDMARK_FONT_SIZE_FRACTION (and the source dimensions) to
 * match — see the generation script notes below.
 */

// Must match the `imageWidth` set on the expo-splash-screen plugin in
// app.config.ts — the on-screen width (in points) the native splash scales
// the image to, with resizeMode: "contain".
export const SPLASH_IMAGE_WIDTH = 200;

// Source PNG dimensions (assets/images/splash-icon*.png). Generated at
// FONT_SIZE=220px per line, GAP=26px (12% of font size) between lines, and
// PAD_X=PAD_Y=77px (35% of font size) symmetric padding around the text
// block — see the wordmark generation notes in this file's git history.
export const SPLASH_IMAGE_SOURCE_WIDTH = 816;
export const SPLASH_IMAGE_SOURCE_HEIGHT = 522;

// Per-line font size as a fraction of the source image's width — applied
// against SPLASH_IMAGE_WIDTH to get the on-screen font size AnimatedSplash
// should render the wordmark at.
export const SPLASH_WORDMARK_FONT_SIZE_FRACTION = 220 / 816;
