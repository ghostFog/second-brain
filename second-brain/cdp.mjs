/* 最小 CDP 客户端（临时诊断） Author: huobing */
import { createConnection } from 'net';
import crypto from 'crypto';
const url = process.argv[2];
const expr = process.argv[3] || '1+1';
const u = new URL(url);
const sock = createConnection(Number(u.port), u.hostname);
const key = crypto.randomBytes(16).toString('base64');
sock.on('connect', () => {
  sock.write(`GET ${u.pathname+u.search} HTTP/1.1\r\nHost: ${u.hostname}:${u.port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
});
let hs = true, id = 0, buffer = Buffer.alloc(0);
function send(d){const p=Buffer.from(d);const m=crypto.randomBytes(4);const l=p.length;let h;if(l<126)h=Buffer.from([0x81,0x80|l]);else if(l<65536){h=Buffer.from([0x81,0x80|126,(l>>8)&255,l&255]);}else{h=Buffer.from([0x81,0x80|127]);}const msk=Buffer.alloc(l);for(let i=0;i<l;i++)msk[i]=p[i]^m[i%4];sock.write(Buffer.concat([h,m,msk]));}
sock.on('data',(c)=>{if(hs){const s=c.toString('latin1');if(!s.includes('\r\n\r\n'))return;hs=false;const i=s.indexOf('\r\n\r\n');buffer=c.subarray(i+4);if(buffer.length)F(buffer);send(JSON.stringify({id:++id,method:'Runtime.enable'}));send(JSON.stringify({id:++id,method:'Runtime.evaluate',params:{expression:`(async()=>{const r=eval(${JSON.stringify(expr)});return JSON.stringify(await r)})()`,returnByValue:true,awaitPromise:true}}));}else{buffer=Buffer.concat([buffer,c]);F(buffer);}});
function F(b){const b0=b[0],op=b0&15;let off=2,len=b[1]&127;if(len===126){len=b.readUInt16BE(2);off=4;}else if(len===127){len=Number(b.readBigUInt64BE(2));off=10;}if(b.length<off+len)return;const masked=(b[1]&128)===128;if(masked)off+=4;const pay=b.subarray(off,off+len);let t;if(masked){const mm=b.subarray(off-4,off);const o=Buffer.alloc(len);for(let i=0;i<len;i++)o[i]=pay[i]^mm[i%4];t=o.toString('utf8');}else t=pay.toString('utf8');try{const m2=JSON.parse(t);if(m2.id===2){console.log(m2.result&&m2.result.result&&m2.result.result.value);process.exit(0);}}catch(e){}buffer=b.subarray(off+len);if(buffer.length)F(buffer);}
sock.on('error',e=>{console.error('ERR',e.message);process.exit(1);});
setTimeout(()=>{console.error('TIMEOUT');process.exit(2);},10000);