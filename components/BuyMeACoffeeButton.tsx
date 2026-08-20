import { useEffect, useRef } from 'react';
import { Platform, View, type ViewStyle } from 'react-native';

// The official https://cdnjs.buymeacoffee.com/1.0.0/button.prod.min.js embed renders via
// document.writeln, which browsers refuse once a script is inserted after the initial parse
// (exactly what happens when a script tag is added from a mounted React component). This
// reproduces that script's output markup directly instead, matching its `data-*` config.
const FONTS: Record<string, { google: string; css: string; bold: boolean }> = {
  Cookie: { google: 'Cookie', css: "'Cookie', cursive", bold: false },
};

type BuyMeACoffeeButtonProps = {
  slug?: string;
  text?: string;
  emoji?: string;
  font?: keyof typeof FONTS;
  bgColor?: string;
  fontColor?: string;
  outlineColor?: string;
  coffeeColor?: string;
  style?: ViewStyle;
};

export function BuyMeACoffeeButton({
  slug = 'manajudge',
  text = 'Buy me a coffee',
  emoji = '☕',
  font = 'Cookie',
  bgColor = '#cbb89d',
  fontColor = '#000000',
  outlineColor = '#000000',
  coffeeColor = '#FFDD00',
  style,
}: BuyMeACoffeeButtonProps) {
  const containerRef = useRef<View>(null);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const container = containerRef.current as unknown as HTMLElement | null;
    if (!container) return;

    const fontInfo = FONTS[font] ?? FONTS.Cookie;

    if (!document.head.querySelector(`link[data-bmc-font="${fontInfo.google}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = `https://fonts.googleapis.com/css?family=${fontInfo.google}&display=swap`;
      link.setAttribute('data-bmc-font', fontInfo.google);
      document.head.appendChild(link);
    }

    const fontSize = fontInfo.bold ? '24px' : '28px';
    const fontWeight = fontInfo.bold ? 'Bold' : 'Normal';

    container.innerHTML = `
      <style>
        .bmc-btn svg { height: 32px !important; margin-bottom: 0px !important; box-shadow: none !important; border: none !important; vertical-align: middle !important; transform: scale(0.9); flex-shrink: 0; }
        .bmc-btn { min-width: 210px; color: ${fontColor} !important; background-color: ${bgColor} !important; height: 60px; border-radius: 12px; font-size: ${fontSize}; font-weight: ${fontWeight}; border: none; padding: 0px 24px; line-height: 27px; text-decoration: none !important; display: inline-flex !important; align-items: center; font-family: ${fontInfo.css} !important; -webkit-box-sizing: border-box !important; box-sizing: border-box !important; }
        .bmc-btn:hover, .bmc-btn:active, .bmc-btn:focus { text-decoration: none !important; cursor: pointer; }
        .bmc-btn-text { text-align: left; margin-left: 8px; display: inline-block; line-height: 0; width: 100%; flex-shrink: 0; font-family: ${fontInfo.css} !important; white-space: nowrap; }
        .logo-outline { fill: ${outlineColor}; }
        .logo-coffee { fill: ${coffeeColor}; }
      </style>
      <div class="bmc-btn-container">
        <a class="bmc-btn" target="_blank" rel="noopener noreferrer" href="https://buymeacoffee.com/${slug}">${emoji}<span class="bmc-btn-text">${text}</span></a>
      </div>
    `;

    return () => {
      container.innerHTML = '';
    };
  }, [slug, text, emoji, font, bgColor, fontColor, outlineColor, coffeeColor]);

  if (Platform.OS !== 'web') return null;

  return <View ref={containerRef} style={style} />;
}
