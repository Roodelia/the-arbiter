export const COLOURS = {
  // Backgrounds
  background:     '#0b0a1a',   // ink black (page bg)
  surface:        '#14122b',   // midnight violet (cards, inputs, containers)
  bgAccent:       '#1C1526',   // warm violet tint (ruling card fill, rule tags, chip accents)

  // Brand identity (dark goldenrod ramp)
  brand:          '#a67c2e',   // ruling border, logo, featured titles, carousel arrows
  brandSoft:      '#cbb89d',   // ruling verdict text, carousel dots
  brandDim:       '#7A5B23',   // rule tag border/text

  // Actions & emphasis (dark amaranth)
  action:         '#7a1c2e',   // primary CTAs, appeal button, RULING label, remove marks

  // Error feedback
  error:          '#B85C38',   // validation and error states

  // Confirmation (dark emerald)
  confirm:        '#1F3D36',   // share button fill, selected category chip fill

  // Text hierarchy
  text:           '#f0f0f0',   // primary text, button text on dark fills
  textSecondary:  '#A0A6B0',   // card chip text, helper text, step labels, tertiary button text
  textMuted:      '#6F7682',   // section labels, chevrons, placeholders

  // Borders
  border:         '#2a2535',   // container/input/chip borders
  chipBorder:     '#2a2535',   // unselected chip borders (same as border)

  // Utility
  placeholder:    '#3a3a3a',   // input placeholder text
} as const;

export const TITLE_FONT = 'serif';
export const BODY_FONT = 'sans-serif';
export const GENERIC_ERROR_MESSAGE = 'Something went wrong. Please try again.';
/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import { Platform } from 'react-native';

const tintColorLight = '#0a7ea4';
const tintColorDark = '#fff';

export const Colors = {
  light: {
    text: '#11181C',
    background: '#fff',
    tint: tintColorLight,
    icon: '#687076',
    tabIconDefault: '#687076',
    tabIconSelected: tintColorLight,
  },
  dark: {
    text: '#ECEDEE',
    background: '#151718',
    tint: tintColorDark,
    icon: '#9BA1A6',
    tabIconDefault: '#9BA1A6',
    tabIconSelected: tintColorDark,
  },
};

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});
