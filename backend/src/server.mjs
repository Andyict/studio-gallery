import { createApp } from './app.mjs';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const localFFmpeg=fileURLToPath(new URL('../../.runtime/media-tools/node_modules/ffmpeg-static/ffmpeg.exe',import.meta.url));
const app=await createApp({ffmpeg:process.env.FFMPEG||(process.platform==='win32'&&existsSync(localFFmpeg)?localFFmpeg:'ffmpeg')});
await app.listen({host:process.env.HOST||'0.0.0.0',port:Number(process.env.PORT||3211)});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await app.close();process.exit(0);});
