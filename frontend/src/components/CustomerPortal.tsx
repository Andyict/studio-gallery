'use client';
import {useEffect,useState} from 'react';
import {ArrowRight,Images,Phone,ShieldCheck} from 'lucide-react';
import {api,json} from '@/lib/api';
import BrandMark from './BrandMark';

export default function CustomerPortal(){
 const [config,setConfig]=useState<any>({name:'Studio Gallery'}),[phone,setPhone]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{api('/config').then(setConfig).catch(()=>{});},[]);
 return <main className="client-home"><div className="client-home-orbit"/><header className="client-home-header"><div className="brand light"><BrandMark logoUrl={config.logoUrl}/>{config.name}</div><a href="/manager">Studio Manager</a></header><section className="client-home-content"><span className="portal-icon"><Images/></span><span className="eyebrow">PRIVATE CLIENT GALLERY</span><h1>Kỷ niệm của bạn,<br/>được giữ trọn vẹn.</h1><p>Xem album, chọn ảnh yêu thích, gửi ghi chú chỉnh sửa và tải ảnh từ studio.</p><form className="client-access-form" onSubmit={e=>{e.preventDefault();setBusy(true);setError('');api('/access',json('POST',{phone})).then(d=>location.assign(d.url)).catch(e=>setError(e.message)).finally(()=>setBusy(false));}}><label htmlFor="client-phone">Mở album bằng số điện thoại</label><div className="client-access-row"><div className="input-icon"><Phone/><input id="client-phone" autoFocus required inputMode="tel" autoComplete="tel" value={phone} onChange={e=>setPhone(e.target.value)} placeholder="090 123 4567"/></div><button className="primary" disabled={busy}>Xem album <ArrowRight size={18}/></button></div>{error&&<p className="alert" role="alert">{error}</p>}</form><div className="client-trust"><ShieldCheck/><span>Ảnh được lưu riêng tại studio</span><i/><span>Truy cập dành riêng cho khách hàng</span></div></section><footer className="client-home-footer">© {new Date().getFullYear()} {config.studioName||config.name}</footer></main>;
}
