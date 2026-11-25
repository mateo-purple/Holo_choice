import { MEMBERS, TOPICS } from './allowed.js';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY = 16384;
const HOST = 'mateo-purple.github.io';
const ORIGIN = 'https://' + HOST;
const headers = { 'Access-Control-Allow-Origin': ORIGIN, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff' };
const json = (data, status=200, extra={}) => new Response(JSON.stringify(data), {status, headers:{...headers, 'Cache-Control':'no-store', ...extra}});
async function readBody(request) {
  const reader=request.body?.getReader(); if (!reader) throw new Error('empty body');
  const chunks=[]; let size=0;
  while(true){const {done,value}=await reader.read(); if(done)break; size+=value.length; if(size>MAX_BODY){await reader.cancel(); throw new Error('too large');} chunks.push(value);}
  const bytes=new Uint8Array(size); let pos=0; for(const chunk of chunks){bytes.set(chunk,pos);pos+=chunk.length;}
  return JSON.parse(new TextDecoder().decode(bytes));
}
export default { async fetch(request, env, ctx) {
  const url=new URL(request.url);
  if(request.method==='OPTIONS') return new Response(null,{status:204,headers:{...headers,'Access-Control-Max-Age':'86400'}});
  try {
    if(request.method==='GET' && url.pathname==='/ranking') {
      const key=new Request(url.origin+'/ranking');
      const cached=await caches.default.match(key); if(cached)return cached;
      const {results}=await env.DB.prepare('SELECT topic,member,wins,appearances FROM ranking WHERE wins > 0').all();
      const response=json({rows:results.map(r=>[r.topic,r.member,r.wins,r.appearances])},200,{'Cache-Control':'public, max-age=300'});
      ctx.waitUntil(caches.default.put(key,response.clone()).catch(()=>{})); return response;
    }
    if(request.method!=='POST'||url.pathname!=='/votes') return json({error:'not found'},404);
    if(request.headers.get('Origin')!==ORIGIN) return json({error:'origin'},403);
    if(!env.TURNSTILE_SECRET || !env.VOTE_LIMIT) return json({error:'not configured'},503);
    const ip=request.headers.get('CF-Connecting-IP')||'unknown';
    if(!(await env.VOTE_LIMIT.limit({key:'vote:'+ip})).success) return json({error:'rate limited'},429,{'Retry-After':'60'});
    let body; try {body=await readBody(request);} catch {return json({error:'invalid body'},400);}
    if(!body || typeof body.id!=='string'||!UUID.test(body.id)||!Array.isArray(body.votes)||body.votes.length<1||body.votes.length>100||typeof body.token!=='string'||body.token.length>2048) return json({error:'invalid batch'},400);
    if(!body.votes.every(v=>Array.isArray(v)&&v.length===3&&TOPICS.has(v[0])&&MEMBERS.has(v[1])&&MEMBERS.has(v[2])&&v[1]!==v[2])) return json({error:'invalid vote'},400);
    const verify=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',body:new URLSearchParams({secret:env.TURNSTILE_SECRET,response:body.token,remoteip:ip})});
    const check=await verify.json();
    if(!check.success||check.hostname!==HOST||check.action!=='vote')return json({error:'verification failed'},403);
    const votes=JSON.stringify(body.votes); const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(votes));
    const digest=Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
    // Trigger applies counters in the same transaction; duplicate ID cannot increment twice.
    await env.DB.prepare('INSERT OR IGNORE INTO batches (id,digest,votes) VALUES (?,?,?)').bind(body.id,digest,votes).run();
    const receipt=await env.DB.prepare('SELECT digest FROM batches WHERE id=?').bind(body.id).first();
    if(!receipt||receipt.digest!==digest)return json({error:'batch ID collision'},409);
    return json({ok:true,id:body.id});
  } catch(err) { console.error('request failed',err.message); return json({error:'temporarily unavailable'},503); }
}};
