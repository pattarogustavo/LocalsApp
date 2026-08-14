/**
 * Layout constants shared between the static splash image (assets/images/
 * splash-icon.png / splash-icon-dark.png, referenced from app.config.ts) and
 * AnimatedSplash (components/animated-splash.tsx), which needs to know
 * exactly where the compass sits on screen so its reveal circle can grow
 * from that same point.
 *
 * If the source PNGs are ever regenerated with a different layout, update
 * these values to match — they're the single source of truth for the
 * compass position within the splash image.
 */

// Must match the `imageWidth` set on the expo-splash-screen plugin in
// app.config.ts — the on-screen width (in points) the native splash scales
// the image to, with resizeMode: "contain".
export const SPLASH_IMAGE_WIDTH = 200;

// Source PNG dimensions (assets/images/splash-icon*.png), used to derive the
// on-screen aspect ratio once scaled to SPLASH_IMAGE_WIDTH.
export const SPLASH_IMAGE_SOURCE_WIDTH = 1000;
export const SPLASH_IMAGE_SOURCE_HEIGHT = 1300;

// Compass center, as a fraction of the image's own width/height. The compass
// is horizontally centered (0.5); vertically it sits above center to leave
// room for the "TheLocals" wordmark underneath.
export const SPLASH_COMPASS_CENTER_X_FRACTION = 0.5;
export const SPLASH_COMPASS_CENTER_Y_FRACTION = 460 / 1300;

// Compass size as a fraction of the image width (matches the source PNG
// generation and the <CompassLogo> size used in AnimatedSplash).
export const SPLASH_COMPASS_SIZE_FRACTION = 380 / 1000;

// Gap between the compass's bottom edge and the "TheLocals" wordmark below
// it, and the wordmark's font size — both expressed as a fraction of the
// compass size so AnimatedSplash can reproduce the static image's
// proportions at whatever on-screen size the compass ends up being.
export const SPLASH_TEXT_GAP_FRACTION = 46 / 380;
export const SPLASH_TEXT_FONT_SIZE_FRACTION = 118 / 380;
