import {readFile,readdir} from 'node:fs/promises';
import {safePath,cleanRelative,fail} from './security.mjs';
export async function sharedFolders(){
  if(process.env.SYNOLOGY_NATIVE!=='1')return [];
  const text=await readFile('/etc/samba/smb.share.conf','utf8');
  const shares=[];let current;
  for(const line of text.split(/\r?\n/)){
    const section=line.match(/^\[([^\]]+)\]$/);
    if(section){current={name:section[1]};continue;}
    const entry=line.match(/^\s*path\s*=\s*(.*?)\s*$/);
    if(current&&entry&&/^\/volume\d+\/[^/]+$/.test(entry[1])){
      const share={...current,path:entry[1],relative_path:'__nas_shares__/'+encodeURIComponent(current.name),readable:false};
      try{await readdir(share.path);share.readable=true;}catch{}
      shares.push(share);current=null;
    }
  }return shares;
}
export async function photoPath(root,relative=''){
  cleanRelative(relative);
  if(process.env.SYNOLOGY_NATIVE==='1'&&relative.startsWith('__nas_shares__/')){
    const parts=relative.split('/');const share=(await sharedFolders()).find(s=>s.relative_path===parts.slice(0,2).join('/'));
    if(!share)fail(404,'Shared folder không còn tồn tại');
    return safePath(share.path,parts.slice(2).join('/'));
  }return safePath(root,relative);
}
