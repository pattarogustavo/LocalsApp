import { Colors, type ColorScheme, type ThemeColorPalette } from "@/constants/theme";
import { useColorScheme } from "./use-color-scheme";
import { useAuthStore } from "@/store/auth";

/**
 * Returns the current theme's color palette.
 * Usage: const colors = useColors(); then colors.text, colors.background, etc.
 *
 * Priority: explicit `colorSchemeOverride` param > user's saved theme choice
 * (Configurações > Tema) > the device's system color scheme.
 */
export function useColors(colorSchemeOverride?: ColorScheme): ThemeColorPalette {
  const colorSchema = useColorScheme();
  const themeMode = useAuthStore((s) => s.themeMode);
  const userChoice = themeMode === "light" || themeMode === "dark" ? themeMode : undefined;
  const scheme = (colorSchemeOverride ?? userChoice ?? colorSchema ?? "light") as ColorScheme;
  return Colors[scheme];
}
