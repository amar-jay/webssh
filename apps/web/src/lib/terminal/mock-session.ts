import type { Terminal } from '@xterm/xterm';

const reset = '\x1b[0m';
const prompt = '\x1b[32mdev@webssh-mock\x1b[0m:\x1b[34m~/workspace\x1b[0m$ ';
const files: Record<string, string> = {
  'README.md': '# Example workspace\r\n\r\nThis is mock terminal data for building WebSSH.\r\nNo remote machine is connected.\r\n',
  'package.json': '{\r\n  "name": "example-workspace",\r\n  "private": true,\r\n  "scripts": { "dev": "vite" }\r\n}\r\n'
};

/** Temporary browser-only session adapter. Never executes commands on a host. */
export function attachMockSession(terminal: Terminal, sessionId: string): () => void {
  let line: string[] = [];
  let cursor = 0;
  const history: string[] = [];
  let historyIndex = 0;
  let draft = '';
  // Route parameters are untrusted; never interpret them as terminal sequences.
  const label = sessionId.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 80);

  const write = (text: string) => terminal.write(text);
  function redraw() {
    write('\r\x1b[2K' + prompt + line.join(''));
    const tail = line.length - cursor;
    if (tail) write(`\x1b[${tail}D`);
  }
  function setLine(value: string) {
    line = Array.from(value);
    cursor = line.length;
    redraw();
  }
  function run(command: string) {
    const [name, ...args] = command.trim().split(/\s+/);
    switch (name) {
      case '': break;
      case 'help':
        write('Mock commands (no shell execution):\r\n' +
          '  help       Show commands\r\n  ls         List sample files\r\n' +
          '  pwd        Show sample directory\r\n  whoami     Show sample user\r\n' +
          '  uname      Show sample system\r\n  cat FILE   Read sample file\r\n' +
          '  echo TEXT  Print text\r\n  history    Show command history\r\n' +
          '  demo       Show colors, links, Unicode and progress\r\n  clear      Clear the screen\r\n');
        break;
      case 'ls': write('\x1b[34msrc/\x1b[0m  README.md  package.json\r\n'); break;
      case 'pwd': write('/home/dev/workspace\r\n'); break;
      case 'whoami': write('dev\r\n'); break;
      case 'uname': write('Linux webssh-mock 6.8.0 x86_64 (sample system)\r\n'); break;
      case 'echo': write(args.join(' ') + '\r\n'); break;
      case 'cat':
        if (!args.length) write('Usage: cat README.md | cat package.json\r\n');
        for (const file of args) write(Object.hasOwn(files, file) ? files[file] : `cat: ${file}: No such sample file\r\n`);
        break;
      case 'history': history.forEach((entry, index) => write(`${String(index + 1).padStart(4)}  ${entry}\r\n`)); break;
      case 'clear': write('\x1b[2J\x1b[H'); break;
      case 'demo':
        write('\r\n\x1b[1mTerminal rendering samples\x1b[0m\r\n');
        for (let color = 0; color < 16; color++) write(`\x1b[48;5;${color}m  ${reset}`);
        write('\r\n\x1b[32mPASS\x1b[0m  ANSI colors and styles\r\n' +
          '\x1b[33mWARN\x1b[0m  Tailcat transport is not connected\r\n' +
          'Unicode: café · İstanbul · 日本語 · λ → ✓\r\n' +
          'Links: https://xtermjs.org\r\n' +
          'Search: select a word, then press F3 / Shift+F3\r\n' +
          '\x1b]9;4;1;100\x07Mock build  [####################] 100%\r\n' +
          '\x1b]9;4;0\x07\r\n');
        break;
      default: write(`${name}: command unavailable in mock session. Type help.\r\n`);
    }
  }

  write(`\x1b[1mWebSSH mock session\x1b[0m  ${label}\r\n` +
    '\x1b[90mBrowser-only sample data. No remote shell is connected.\x1b[0m\r\n' +
    'Type help for commands or demo for rendering samples.\r\n\r\n' + prompt);

  const input = terminal.onData((data) => {
    if (data === '\x1b[A' || data === '\x1b[B') {
      if (historyIndex === history.length) draft = line.join('');
      historyIndex = Math.max(0, Math.min(history.length, historyIndex + (data === '\x1b[A' ? -1 : 1)));
      setLine(historyIndex === history.length ? draft : history[historyIndex]);
      return;
    }
    if (data === '\x1b[D' || data === '\x1b[C') {
      cursor = Math.max(0, Math.min(line.length, cursor + (data === '\x1b[D' ? -1 : 1)));
      redraw();
      return;
    }
    if (data === '\x1b[3~') {
      line.splice(cursor, 1);
      redraw();
      return;
    }
    // Ignore other key escape sequences rather than printing their fragments.
    if (data.startsWith('\x1b')) return;
    for (const char of Array.from(data.replace(/\r\n/g, '\r'))) {
      if (char === '\r' || char === '\n') {
        const command = line.join('');
        write('\r\n');
        if (command.trim()) history.push(command);
        run(command);
        line = [];
        cursor = 0;
        historyIndex = history.length;
        draft = '';
        write(prompt);
      } else if (char === '\x7f' || char === '\b') {
        if (cursor > 0) line.splice(--cursor, 1);
        redraw();
      } else if (char === '\x03') {
        write('^C\r\n' + prompt);
        line = [];
        cursor = 0;
        historyIndex = history.length;
        draft = '';
      } else if (char === '\x0c') {
        write('\x1b[2J\x1b[H');
        redraw();
      } else if (char >= ' ' && !/[\u007f-\u009f]/.test(char)) {
        line.splice(cursor++, 0, char);
        redraw();
      }
    }
  });
  return () => input.dispose();
}
