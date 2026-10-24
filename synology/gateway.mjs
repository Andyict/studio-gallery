// Public entry point of the DSM package, playing the role nginx plays in Docker:
// /api/* goes straight to the backend (ZIP downloads never pass through Next.js)
// and everything else to the Next.js server. Both upstreams listen on loopback.
//
// The backend rate-limits by client address and trusts X-Forwarded-For only
// from loopback, so this gateway always overwrites that header with the real
// peer address. A client-supplied value is honoured only when the peer itself
// is loopback, i.e. DSM's own Reverse Proxy running on the same NAS.
import http from 'node:http';
import {pipeline} from 'node:stream';
import {pathToFileURL} from 'node:url';

const loopback=address=>/^(127\.|::1$|::ffff:127\.)/.test(address||'');

export function clientAddress(req){
  const peer=req.socket.remoteAddress||'';
  if(!loopback(peer))return peer;
  const forwarded=String(req.headers['x-forwarded-for']||'').split(',').map(v=>v.trim()).filter(Boolean);
  return forwarded.at(-1)||peer;
}

export function createGateway({api,web}){
  return http.createServer((req,res)=>{
    const target=/^\/api(?:\/|\?|$)/.test(req.url||'')?api:web;
    const headers={...req.headers,'x-forwarded-for':clientAddress(req)};
    const upstream=http.request({host:target.host,port:target.port,method:req.method,path:req.url,headers},response=>{
      res.writeHead(response.statusCode||502,response.rawHeaders);
      // If the backend dies mid-response (restart, crash), end the client's connection too so
      // EventSource reconnects and a ZIP download fails visibly instead of hanging.
      response.on('aborted',()=>res.destroy());
      pipeline(response,res,err=>{if(err)res.destroy();});
    });
    upstream.on('error',()=>{
      if(res.headersSent)return res.destroy();
      res.writeHead(502,{'content-type':'text/plain; charset=utf-8','cache-control':'no-store'});
      res.end('Studio Gallery đang khởi động hoặc không phản hồi. Vui lòng thử lại.');
    });
    res.on('close',()=>upstream.destroy());
    req.pipe(upstream);
  });
}

if(import.meta.url===pathToFileURL(process.argv[1]||'').href){
  const env=process.env;
  const server=createGateway({
    api:{host:'127.0.0.1',port:Number(env.API_PORT||3211)},
    web:{host:'127.0.0.1',port:Number(env.WEB_PORT||3210)}
  });
  server.listen(Number(env.PORT||3215),env.HOST||'0.0.0.0');
  // Open event streams never go idle, so close them explicitly instead of waiting for the kill.
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{server.close(()=>process.exit(0));server.closeAllConnections();});
}
