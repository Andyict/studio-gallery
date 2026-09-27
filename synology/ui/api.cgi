#!/var/packages/Node.js_v22/target/usr/local/bin/node
'use strict';
// Same-origin transport only. Studio authentication and authorization stay in the backend.
const http = require('node:http');
const fs = require('node:fs');
const env = process.env;
function fail(code, message) {
  process.stdout.write(`Status: ${code}\r\nContent-Type: application/json\r\nCache-Control: no-store\r\n\r\n${JSON.stringify({message})}`);
}
const route = new URLSearchParams(env.QUERY_STRING || '').get('route') || '';
const method = env.REQUEST_METHOD || 'GET';
const allowed = /^(admin\/(me|login|sources|directories|shares)|admin\/sources\/[a-zA-Z0-9-]+(?:\/discover)?)(?:\?[^\r\n]*)?$/.test(route);
if (!allowed || !['GET','POST','PATCH'].includes(method)) { fail(404, 'Không tìm thấy API'); }
else if (method !== 'GET' && (!env.HTTP_ORIGIN || new URL(env.HTTP_ORIGIN).host !== env.HTTP_HOST)) { fail(403, 'Origin không hợp lệ'); }
else {
  const cookies = (env.HTTP_COOKIE || '').split(';').filter(c => c.trim().startsWith('proof_admin=')).join(';');
  const config = JSON.parse(fs.readFileSync(__dirname + '/transport.json', 'utf8'));
  const request = http.request({host:'127.0.0.1',port:3211,path:'/api/'+route,method,
    headers:{'content-type':'application/json',cookie:cookies,origin:config.origin}}, response => {
    let headers = 'Content-Type: application/json; charset=utf-8\r\nCache-Control: no-store\r\n';
    for (const cookie of response.headers['set-cookie'] || []) headers += 'Set-Cookie: '+cookie+'\r\n';
    let body='';response.on('data', chunk => body+=chunk);
    response.on('end', () => {let data;try{data=JSON.parse(body);}catch{data={message:'Phản hồi backend không hợp lệ'};}process.stdout.write(headers+'\r\n'+JSON.stringify({status:response.statusCode,data}));});
  });
  request.setTimeout(15000, () => request.destroy());
  request.on('error', () => fail(502, 'Không kết nối được dịch vụ Studio Gallery'));
  let size=0;
  const length=Number(env.CONTENT_LENGTH||0);
  if (!length) request.end();
  else process.stdin.on('data', chunk => {
    size+=chunk.length;
    if(size>65536) request.destroy(); else request.write(chunk);
    if(size>=length){process.stdin.pause();request.end();}
  });
}
