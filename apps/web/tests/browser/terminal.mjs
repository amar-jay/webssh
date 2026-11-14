// Invoked by the opt-in native agent integration test. Never print credentials.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { readFile, access } from 'node:fs/promises';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
const [recordFile, workspace] = process.argv.slice(2);
const descriptor = JSON.parse(await readFile(recordFile, 'utf8'));
const port = await new Promise(resolve => { const server=createServer();server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));}); });
const origin=`http://127.0.0.1:${port}`;
const vite=spawn('pnpm',['exec','vite','dev','--host','127.0.0.1','--port',String(port),'--strictPort'],{cwd:resolve(import.meta.dirname,'../..'),stdio:'ignore'});
let browser, page;
async function until(check, label, timeout=30_000) {
 const deadline=Date.now()+timeout;
 while(Date.now()<deadline) { if(await check())return;await new Promise(r=>setTimeout(r,50)); }
 throw new Error(`Timed out: ${label}`);
}
try {
 await until(async()=>{try{return (await fetch(origin)).ok;}catch{return false;}},'web startup');
 browser=await chromium.launch({executablePath:process.env.CHROME_BIN || '/snap/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--ignore-certificate-errors']});
 page=await browser.newPage({viewport:{width:1000,height:700},ignoreHTTPSErrors:true});
 const errors=[];page.on('pageerror',error=>{ errors.push('browser error'); console.error(error.message.replaceAll(descriptor.address,'[redacted]').replaceAll(descriptor.token,'[redacted]')); });
 const text=()=>page.locator('.xterm-accessibility').innerText();
 async function see(value){await until(async()=>{try{const content=await text();return content.includes(value);}catch{return false;}},value);}
 async function command(value){await page.locator('.xterm-helper-textarea').focus();await page.keyboard.type(value);await page.keyboard.press('Enter');}
 async function connect(record) {
  await page.goto(origin+'/dev/connect');
  await page.locator('#record').fill(JSON.stringify(record));
  await page.getByRole('button',{name:'Connect',exact:true}).click();
  await page.waitForURL(/\/s\/[a-z0-9-]+$/);
  assert(!page.url().includes(record.token));
 }
 await connect({...descriptor,token:'invalid-token-that-is-long-enough-to-pass-form'});
 await see('Connection failed.');assert(!(await text()).includes('webssh-mock'));
 await connect(descriptor);await see('Connected.');
 await command('cat unicode.txt');await see('TAILCAT_BROWSER_OK café İstanbul 日本語');
 // Exercise xterm's actual paste handler, including a multi-line paste.
 await page.locator('.xterm-helper-textarea').evaluate(element=>{
  const clipboardData=new DataTransfer();clipboardData.setData('text/plain',"printf 'paste-one\\n' > paste.txt\nprintf 'paste-two\\n' >> paste.txt\n");
  element.dispatchEvent(new ClipboardEvent('paste',{clipboardData,bubbles:true,cancelable:true}));
 });
 await until(async()=>{try{return (await readFile(resolve(workspace,'paste.txt'),'utf8'))==='paste-one\npaste-two\n';}catch{return false;}},'multi-line paste');
 await command('sleep 30');await new Promise(r=>setTimeout(r,150));await page.keyboard.press('Control+c');
 await command('cat interrupt.txt');await see('INTERRUPT_OK');
 await page.setViewportSize({width:740,height:460});await new Promise(r=>setTimeout(r,150));
 await command('stty size > dimensions.txt');
 await until(async()=>{try{return /^\d+ \d+\s*$/.test(await readFile(resolve(workspace,'dimensions.txt'),'utf8'));}catch{return false;}},'terminal resize');
 const [rows,cols]=(await readFile(resolve(workspace,'dimensions.txt'),'utf8')).trim().split(' ').map(Number);
 assert(rows>5 && rows<40 && cols>20 && cols<100);
 await command('vi browser.txt');await new Promise(r=>setTimeout(r,400));
 await page.keyboard.press('i');await page.keyboard.type('FULLSCREEN_OK');await page.keyboard.press('Escape');await page.keyboard.type(':wq');await page.keyboard.press('Enter');
 await until(async()=>{try{return (await readFile(resolve(workspace,'browser.txt'),'utf8')).includes('FULLSCREEN_OK');}catch{return false;}},'full-screen editor');
 await command('exit 7');await see('Shell exited (7).');
 await page.reload();await see('No local connection available.');
 await connect(descriptor);await see('Connected.');await command('echo $$ > shell.pid');
 await until(async()=>{try{await access(resolve(workspace,'shell.pid'));return true;}catch{return false;}},'shell PID');
 const pid=Number((await readFile(resolve(workspace,'shell.pid'),'utf8')).trim());
 await page.goBack();await page.waitForURL(/\/dev\/connect$/);
 await until(()=>{try{process.kill(pid,0);return false;}catch(error){return error.code==='ESRCH';}},'route disposal reaps shell');
 await page.getByRole('button',{name:'Open mock terminal'}).click();await see('webssh-mock');
 assert.equal(errors.length,0);
 console.log('Browser/DERP/native PTY: auth, Unicode, paste, Ctrl+C, resize, vi, exit and disposal passed.');
} catch(error) {
 if(page) console.error('terminal test snapshot', (await page.locator('.xterm-accessibility').innerText().catch(()=>'' )).replaceAll(descriptor.address,'[redacted]').replaceAll(descriptor.token,'[redacted]'));
 throw error;
} finally {
 await browser?.close();vite.kill('SIGTERM');
}
