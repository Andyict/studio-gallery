import sharp from 'sharp';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

const root=path.resolve('.runtime/photos/Demo_Wedding');
await rm(path.resolve('.runtime'),{recursive:true,force:true});
const groups=[
  ['01_Le_Gia_Tien',['Bình minh','Chờ đợi','Lời hứa','Gia đình']],
  ['02_Tiec_Nha_Hang',['Đón khách','Ánh đèn','Nâng ly','Điệu nhảy']],
  ['03_Khach_Moi',['Bạn bè','Nụ cười','Khoảnh khắc','Tạm biệt']]
];
const colors=[['#35594a','#c8b99b'],['#71584c','#e6d5bd'],['#526778','#c9d8df'],['#7b6952','#d9c3a2']];
let index=1;
for(const [folder,names] of groups){
  const target=path.join(root,folder);await mkdir(target,{recursive:true});
  for(let i=0;i<names.length;i++){
    const portrait=(index%3)!==0,w=portrait?900:1400,h=portrait?1250:900,[a,b]=colors[i];
    const svg=`<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="${w*.72}" cy="${h*.25}" r="${Math.min(w,h)*.18}" fill="#fff" opacity=".16"/><path d="M0 ${h*.72} Q ${w*.35} ${h*.45}, ${w} ${h*.78} V${h} H0Z" fill="#18261e" opacity=".22"/><text x="${w*.08}" y="${h*.82}" font-family="Georgia" font-size="${Math.round(w*.045)}" fill="#fff">${names[i]}</text><text x="${w*.08}" y="${h*.88}" font-family="Arial" font-size="${Math.round(w*.018)}" fill="#fff" opacity=".72">DEMO COLLECTION · ${String(index).padStart(3,'0')}</text></svg>`;
    await sharp(Buffer.from(svg)).jpeg({quality:88}).toFile(path.join(target,`IMG_${String(index).padStart(3,'0')}.jpg`));index++;
  }
}
console.log(`Created ${index-1} demo images in ${root}`);
