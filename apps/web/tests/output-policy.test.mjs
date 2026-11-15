import assert from 'node:assert/strict';
import test from 'node:test';
import xterm from '@xterm/headless';
import { installOutputPolicy, safeTerminalLink, terminalLinkHandler,terminalLimits } from '../src/lib/terminal/output-policy.ts';
const {Terminal}=xterm;
const write=(terminal,text)=>new Promise(resolve=>terminal.write(text,resolve));

test('real xterm parser consumes untrusted OSC clipboard/title and window requests',async()=>{
 const terminal=new Terminal({allowProposedApi:true,cols:80,rows:24,scrollback:terminalLimits.scrollback});
 let clipboard=0,title=0,window=0;
 terminal.parser.registerOscHandler(52,()=>{clipboard++;return true;});
 terminal.parser.registerOscHandler(2,()=>{title++;return true;});
 terminal.parser.registerCsiHandler({final:'t'},()=>{window++;return true;});
 const output=[];terminal.onData(value=>output.push(value));
 const policy=installOutputPolicy(terminal);
 try{
  // Query and write, split across frames, including ST and BEL terminators.
  await write(terminal,'\x1b]52;c;?\x07\x1b]52;c;cHJpdmF0ZQ==\x1b');
  await write(terminal,'\\\x1b]2;spoofed title\x07\x1b[21t\x1b[8;10000;10000t');
  await write(terminal,'\x1b]8;;javascript:alert(1)\x1b\\<img src=x onerror=alert(1)>\x1b]8;;\x1b\\');
  assert.equal(clipboard,0);assert.equal(title,0);assert.equal(window,0);assert.deepEqual(output,[]);
  assert.equal(terminal.cols,80);assert.equal(terminal.rows,24);
  assert.match(terminal.buffer.active.getLine(0).translateToString(true),/<img src=x onerror=alert\(1\)>/);
 }finally{policy.dispose();terminal.dispose();}
});

test('all terminal links share a trusted-click and safe destination policy',()=>{
 const calls=[];const handler=terminalLinkHandler({confirm:value=>{calls.push(['confirm',value]);return true;},open:(...args)=>calls.push(['open',...args])});
 const click={isTrusted:true,button:0,ctrlKey:true,metaKey:false};
 for(const uri of ['javascript:alert(1)','data:text/html,hello','file:///etc/passwd','https://user:secret@example.com','https://exa\nmple.com','https://example.com/\u202eexe','https://example.com/'+ 'a'.repeat(2048)]){assert.equal(safeTerminalLink(uri),undefined);handler.activate(click,uri);}
 assert.deepEqual(calls,[]);
 handler.activate({...click,isTrusted:false},'https://example.com');handler.activate({...click,ctrlKey:false},'https://example.com');assert.deepEqual(calls,[]);
 handler.activate(click,'https://example.com/path');assert.deepEqual(calls[1],['open','https://example.com/path','_blank','noopener,noreferrer']);
});

test('scrollback and escape parser remain bounded under repeated remote output',async()=>{
 const terminal=new Terminal({allowProposedApi:true,cols:80,rows:24,scrollback:terminalLimits.scrollback});const policy=installOutputPolicy(terminal);
 try{await write(terminal,('untrusted output\r\n').repeat(3000));assert(terminal.buffer.active.length<=1024);}
 finally{policy.dispose();terminal.dispose();}
});
