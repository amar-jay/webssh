import test from 'node:test';
import assert from 'node:assert/strict';
import { readJSON,readForm } from '../src/lib/state/client.ts';

test('JSON and forms enforce actual byte and chunk limits even with misleading headers',async()=>{
 const tooBig=new Request('https://example.com',{method:'POST',body:'x'.repeat(16385),headers:{'content-length':'1'}});
 await assert.rejects(readJSON(tooBig),/request_too_large/);
 const form=new Request('https://example.com',{method:'POST',body:'runId='+ 'x'.repeat(16385),headers:{'content-type':'application/x-www-form-urlencoded'}});
 await assert.rejects(readForm(form),/request_too_large/);
 const stream=new ReadableStream({start(c){for(let i=0;i<1025;i++)c.enqueue(new Uint8Array());c.close();}});
 await assert.rejects(readJSON(new Request('https://example.com',{method:'POST',body:stream,duplex:'half'})),/request_too_large/);
 const valid=await readForm(new Request('https://example.com',{method:'POST',body:new URLSearchParams({runId:'opaque'})}));assert.equal(valid.get('runId'),'opaque');
});

test('an idle request body is canceled at the five-second deadline',async(context)=>{
 context.mock.timers.enable({apis:['setTimeout']});let canceled=false;
 const body=new ReadableStream({cancel(){canceled=true;}});
 const reading=readJSON(new Request('https://example.com',{method:'POST',body,duplex:'half'}));
 context.mock.timers.tick(5000);await assert.rejects(reading,/request_timeout/);assert(canceled);
});

test('public errors are an allowlist, not reflected backend identifiers',async()=>{
 const {jsonError}=await import('../src/lib/state/client.ts');
 assert.deepEqual(await jsonError('private_token_value').json(),{error:'request_failed'});
 assert.deepEqual(await jsonError('resource_limit',429).json(),{error:'resource_limit'});
});
