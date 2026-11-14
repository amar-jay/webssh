import assert from 'node:assert/strict';
import test from 'node:test';
import { attachMockSession } from '../src/lib/terminal/mock-session.ts';

function session(id = 'example') {
  let listener;
  let output = '';
  let disposed = false;
  const cleanup = attachMockSession({
    write(text) { output += text; },
    onData(callback) {
      listener = callback;
      return { dispose() { disposed = true; listener = undefined; } };
    }
  }, id);
  return {
    input(data) { listener?.(data); },
    output: () => output,
    disposed: () => disposed,
    cleanup
  };
}

test('mock is identified, handles pasted commands, and never runs unknown commands', () => {
  const mock = session();
  assert.match(mock.output(), /No remote shell is connected/);
  mock.input('pwd\r\ncat package.json\r\nrm -rf anything\r');
  assert.match(mock.output(), /\/home\/dev\/workspace\r\n/);
  assert.match(mock.output(), /"name": "example-workspace"/);
  assert.match(mock.output(), /rm: command unavailable in mock session/);
});

test('line editing and history replay commands', () => {
  const mock = session();
  mock.input('pwX');
  mock.input('\x7f');
  mock.input('d\r');
  mock.input('\x1b[A');
  mock.input('\r');
  assert.equal(mock.output().split('/home/dev/workspace\r\n').length - 1, 2);
  mock.input('echX');
  mock.input('\x1b[D');
  mock.input('\x1b[3~');
  mock.input('o hello\r');
  assert.match(mock.output(), /\r\nhello\r\n/);
});

test('session state is isolated and input listener is removed on cleanup', () => {
  const first = session();
  first.input('echo private\r');
  const second = session();
  second.input('history\r');
  assert.doesNotMatch(second.output(), /private/);
  first.cleanup();
  const before = first.output();
  first.input('help\r');
  assert.equal(first.output(), before);
  assert.equal(first.disposed(), true);
});

test('route IDs cannot inject terminal control sequences', () => {
  const mock = session('test\x1b[2J');
  assert.doesNotMatch(mock.output(), /\x1b\[2J/);
  assert.match(mock.output(), /test__2J/);
});
