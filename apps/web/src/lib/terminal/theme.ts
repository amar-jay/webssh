import type { ITheme } from '@xterm/xterm';

/** Tokyo Night Moon. https://github.com/folke/tokyonight.nvim extras/alacritty */
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
  brightRed: '#ff8d94',
  brightGreen: '#c7fb6d',
  brightYellow: '#ffd8ab',
  brightBlue: '#9ab8ff',
  brightMagenta: '#caabff',
  brightCyan: '#b2ebff',
  brightWhite: '#c8d3f5'
} satisfies ITheme;

/** Moon accents that xterm does not map onto ITheme. */
export const tokyoNightMoonAccents = {
  bold: '#4fd6be',
  link: '#4fd6be',
  badge: '#ff966c',
  cursorGuide: '#c8d3f5'
};
