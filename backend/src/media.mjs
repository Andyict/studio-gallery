import path from 'node:path';
import {spawn} from 'node:child_process';
import {stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {fail} from './security.mjs';
export const rawExtensions=new Set([
 '.3fr','.arw','.bay','.bmq','.cap','.cine','.cr2','.cr3','.crw','.cs1','.dc2','.dcr','.dng','.drf','.eip','.erf','.fff','.gpr',
 '.iiq','.k25','.kdc','.mdc','.mef','.mos','.mrw','.nef','.nrw','.orf','.pef','.ptx','.pxn','.raf','.raw','.rdc','.rwl','.rw2',
 '.rwz','.sr2','.srf','.srw','.x3f'
]);
export const videoExtensions=new Set([
 '.3g2','.3gp','.asf','.avi','.divx','.dv','.f4v','.flv','.h264','.hevc','.m2t','.m2ts','.m2v','.m4v','.mjpeg','.mjpg','.mkv',
 '.mod','.mov','.mp4','.mpe','.mpeg','.mpg','.mts','.mxf','.ogv','.rm','.rmvb','.tod','.ts','.vob','.webm','.wmv','.y4m'
]);
export const imageExtensions=new Set([
 '.apng','.avif','.bmp','.cin','.dds','.dpx','.exr','.gif','.hdr','.heic','.heif','.icns','.ico','.jfif','.jpe','.jpeg','.jpg',
 '.j2c','.j2k','.jp2','.jpc','.jpf','.jpm','.jpx','.pam','.pbm','.pcx','.pgm','.png','.pnm','.ppm','.psb','.psd','.qoi',
 '.sgi','.tga','.tif','.tiff','.webp'
]);
export const extensions=new Set([...imageExtensions,...rawExtensions,...videoExtensions]);
export const isVideo=p=>videoExtensions.has(p.extension || path.extname(p.filename||'').toLowerCase());
export const supportedFile=name=>extensions.has(path.extname(name).toLowerCase());
export function runMedia(binary,args,timeoutMs=30*60*1000){
 return new Promise((resolve,reject)=>{
  const proc=spawn(binary,args,{windowsHide:true,stdio:['ignore','ignore','pipe']});let error='';
  proc.stderr.on('data',d=>{error=(error+d).slice(-2000);});
  const timer=setTimeout(()=>{proc.kill();},timeoutMs);
  proc.on('error',e=>{clearTimeout(timer);reject(e);});
  proc.on('close',code=>{clearTimeout(timer);code===0?resolve():reject(new Error(`Media conversion failed (${code}): ${error}`));});
 });
}
export async function serveVideo(req,reply,file){
 const {size}=await stat(file);const range=req.headers.range;
 reply.type('video/mp4').header('Accept-Ranges','bytes').header('Cache-Control','private, no-store');
 if(!range)return reply.header('Content-Length',size).send(createReadStream(file));
 const m=/^bytes=(\d*)-(\d*)$/.exec(range);
 if(!m||(!m[1]&&!m[2]))return reply.code(416).header('Content-Range',`bytes */${size}`).send();
 const start=m[1]?Number(m[1]):Math.max(0,size-Number(m[2]));
 const end=m[1]?(m[2]?Math.min(Number(m[2]),size-1):size-1):size-1;
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=size)return reply.code(416).header('Content-Range',`bytes */${size}`).send();
 return reply.code(206).header('Content-Range',`bytes ${start}-${end}/${size}`).header('Content-Length',end-start+1).send(createReadStream(file,{start,end}));
}
