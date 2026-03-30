import React, { useMemo, useRef } from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import { SvgXml } from 'react-native-svg';

/**
 * Per-instance gradient id so fill="url(#…)" never clashes on web when multiple
 * routes/screens mount (Expo Router can keep trees alive; duplicate SVG ids break paints).
 */
function arbiterLogoXml(gradientId: string): string {
  return `
<svg width="800" height="118" viewBox="0 62 800 118" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="${gradientId}" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%"   stop-color="#c8a882"/>
      <stop offset="45%"  stop-color="#e8c9a0"/>
      <stop offset="65%"  stop-color="#c8a882"/>
      <stop offset="100%" stop-color="#9a7a58"/>
    </linearGradient>
  </defs>
  <rect x="0" y="62" width="800" height="118" fill="#000000"/>
  <text
    x="400"
    y="155"
    font-family="'Palatino Linotype', 'Palatino', 'Book Antiqua', Georgia, serif"
    font-size="110"
    font-weight="700"
    fill="url(#${gradientId})"
    text-anchor="middle"
    letter-spacing="12"
  >ARBITER</text>
</svg>
`.trim();
}

type ArbiterLogoProps = {
  width?: number;
  height?: number;
  style?: StyleProp<ViewStyle>;
};

export function ArbiterLogo({ width = 280, height = 41, style }: ArbiterLogoProps) {
  const idRef = useRef<string | null>(null);
  if (idRef.current == null) {
    idRef.current = `ag${Math.random().toString(36).slice(2, 11)}`;
  }
  const xml = useMemo(() => arbiterLogoXml(idRef.current!), []);
  return <SvgXml xml={xml} width={width} height={height} style={style} />;
}
