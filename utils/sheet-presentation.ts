import type { ThemeColorPalette } from '@/constants/theme';

/**
 * Shared native iOS form-sheet (UISheetPresentationController, via
 * expo-router/@react-navigation/native-stack) screen options — every bottom
 * sheet in the app should render `<Stack.Screen options={sheetScreenOptions(...)} />`
 * as its first child instead of hand-rolling `presentation`/`sheetAllowedDetents`/
 * etc. so they all look and behave consistently.
 *
 * `detents`:
 * - 'fitToContents' — short forms that size to their own content.
 * - [1] — full screen (search/keyboard-heavy sheets).
 * - [0.6, 1] — long-content sheets (detail views, lists) that start at 60%
 *   and can be dragged up to full height.
 */
export function sheetScreenOptions(
  colors: ThemeColorPalette,
  detents: 'fitToContents' | number[] = 'fitToContents',
) {
  return {
    headerShown: false,
    presentation: 'formSheet' as const,
    sheetAllowedDetents: detents,
    sheetGrabberVisible: true,
    sheetCornerRadius: 24,
    sheetExpandsWhenScrolledToEdge: true,
    contentStyle: { backgroundColor: colors.background },
  };
}
