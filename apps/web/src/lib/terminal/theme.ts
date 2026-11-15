import type { ITheme } from '@xterm/xterm';

export const tokyoNightMoon = {
  background: '#07080a',
  foreground: '#fff1e6',
  selectionBackground: '#744735',
  selectionInactiveBackground: '#744735',
  selectionForeground: '#fff1e6',
  cursor: '#fff1e6',
  cursorAccent: '#07080a',
  black: '#17100e',
  red: '#ff757f',
  green: '#c3e88d',
  yellow: '#ffc777',
  blue: '#82aaff',
  magenta: '#c099ff',
  cyan: '#86e1fc',
  white: '#e6b99c',
  brightBlack: '#aa7256',
  brightRed: '#ff757f',
  brightGreen: '#c3e88d',
  brightYellow: '#ffc777',
  brightBlue: '#82aaff',
  brightMagenta: '#c099ff',
  brightCyan: '#86e1fc',
  brightWhite: '#fff1e6'
} satisfies ITheme;

// Supplied palette values without corresponding xterm ITheme properties.
export const tokyoNightMoonAccents = {
  bold: '#4fd6be',
  link: '#4fd6be',
  badge: '#ff2600',
  cursorGuide: '#fff1e6'
};
