import type { ITheme } from '@xterm/xterm';

export const tokyoNightMoon = {
  background: '#222436',
  foreground: '#c8d3f5',
  selectionBackground: '#2d3f76',
  selectionInactiveBackground: '#2d3f76',
  selectionForeground: '#c8d3f5',
  cursor: '#c8d3f5',
  cursorAccent: '#222436',
  black: '#1b1d2b',
  red: '#ff757f',
  green: '#c3e88d',
  yellow: '#ffc777',
  blue: '#82aaff',
  magenta: '#c099ff',
  cyan: '#86e1fc',
  white: '#828bb8',
  brightBlack: '#444a73',
  brightRed: '#ff757f',
  brightGreen: '#c3e88d',
  brightYellow: '#ffc777',
  brightBlue: '#82aaff',
  brightMagenta: '#c099ff',
  brightCyan: '#86e1fc',
  brightWhite: '#c8d3f5'
} satisfies ITheme;

// Supplied palette values without corresponding xterm ITheme properties.
export const tokyoNightMoonAccents = {
  bold: '#4fd6be',
  link: '#4fd6be',
  badge: '#ff2600',
  cursorGuide: '#c8d3f5'
};
