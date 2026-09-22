import {chromium} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://localhost:3210/');
 await page.getByLabel('Mở album bằng số điện thoại').fill('090 123 4567');
 await mkdir('artifacts',{recursive:true});
 await page.screenshot({path:'artifacts/customer-portal.png',fullPage:true});
 await Promise.all([page.waitForURL('**/album'),page.getByRole('button',{name:'Xem album'}).click()]);
 await page.getByRole('button',{name:/Chọn IMG_001.jpg để tải/}).click();
 await page.getByRole('button',{name:/Yêu thích IMG_002.jpg/}).click();
 const selected=page.getByRole('button',{name:/Chọn IMG_001.jpg để tải/});
 if(await selected.getAttribute('aria-pressed')!=='true')throw new Error('Download selection was not retained');
 const heart=page.getByRole('button',{name:/Yêu thích IMG_002.jpg/});
 if(await heart.getAttribute('aria-pressed')!=='true')throw new Error('Favorite was not retained');
 if(await page.getByRole('button',{name:/Yêu thích IMG_001.jpg/}).getAttribute('aria-pressed')!=='false')throw new Error('Download selection changed favorite');
 await page.screenshot({path:'artifacts/customer-gallery-selection.png',fullPage:true});
 await page.getByRole('button',{name:'Tải ảnh'}).click();
 await page.getByRole('button',{name:/Tải 1 ảnh đang tích chọn/}).waitFor();
 await page.getByRole('button',{name:/Tải tất cả ảnh được cấp quyền/}).waitFor();
 await page.screenshot({path:'artifacts/customer-download-options.png',fullPage:true});
 if(errors.length)throw new Error(errors.join('\n'));
 console.log('PASS: portal login, separate favorite/download selection, selected and all download options.');
}finally{await browser.close();}
