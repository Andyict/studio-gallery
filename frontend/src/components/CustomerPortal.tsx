'use client';
import {useCallback,useEffect,useState} from 'react';
import {ArrowRight,CalendarClock,Images,KeyRound,LoaderCircle,LogOut,MessageCircle,Phone,ShieldCheck} from 'lucide-react';
import {api,json} from '@/lib/api';
import BrandMark from './BrandMark';
import {Modal,STATUS_TEXT} from './Gallery';
import {useI18n,LangSwitch} from '@/lib/i18n';

type Album={link_id:string;label:string;project:{id:string;name:string;status:string;due_at:string|null;max_edit:number};photo_count:number;cover:boolean;unread:number;expires_at:string|null};

// Studio home for customers: sign in with phone + PIN, then pick one of "my albums".
export default function CustomerPortal(){
 const {t,locale}=useI18n();
 const [config,setConfig]=useState<any>({name:'Studio Gallery'});
 const [me,setMe]=useState<{name:string;phone_last4:string}|null>(null),[albums,setAlbums]=useState<Album[]>([]),[checking,setChecking]=useState(true);
 const [phone,setPhone]=useState(''),[pin,setPin]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [pinOpen,setPinOpen]=useState(false),[currentPin,setCurrentPin]=useState(''),[newPin,setNewPin]=useState(''),[notice,setNotice]=useState('');
 const load=useCallback(async()=>{const [m,a]=await Promise.all([api('/customer/me'),api<Album[]>('/customer/albums')]);setMe(m);setAlbums(a);},[]);
 useEffect(()=>{api('/config').then(setConfig).catch(()=>{});load().catch(()=>setMe(null)).finally(()=>setChecking(false));},[load]);
 useEffect(()=>{if(!notice)return;const t=setTimeout(()=>setNotice(''),3500);return()=>clearTimeout(t);},[notice]);
 async function run(fn:()=>Promise<void>){setBusy(true);setError('');try{await fn();}catch(e:any){setError(e.message);}finally{setBusy(false);}}
 const open=(album:Album)=>run(async()=>{const d=await api(`/customer/albums/${album.link_id}/open`,json('POST',{}));location.assign(d.url);});
 const header=<header className="client-home-header"><div className="brand light"><BrandMark logoUrl={config.logoUrl}/>{config.name}</div>
  {me?<div className="portal-account"><span>{me.name}</span><button className="portal-link" onClick={()=>{setCurrentPin('');setNewPin('');setPinOpen(true);}}><KeyRound size={14}/>{t('Đổi PIN')}</button><button className="portal-link" onClick={()=>void run(async()=>{await api('/logout',json('POST',{}));setMe(null);setAlbums([]);setPin('');})}><LogOut size={14}/>{t('Đăng xuất')}</button><LangSwitch className="light"/></div>:<div className="portal-account"><LangSwitch className="light"/><a href="/manager">Studio Manager</a></div>}</header>;
 return <main className="client-home"><div className="client-home-orbit"/>{header}
  {checking?<section className="client-home-content"><LoaderCircle className="spin"/></section>:me?
   <section className="client-home-content portal-albums">
    <span className="eyebrow">{t('ALBUM CỦA TÔI')}</span><h1>{t('Xin chào, {name}.',{name:me.name})}</h1>
    <p>{t(albums.length?'Chọn album để xem ảnh, thả tim, gửi ghi chú và trò chuyện với studio.':'Hiện chưa có album nào đang mở cho bạn. Studio sẽ báo khi album sẵn sàng.')}</p>
    <div className="portal-album-grid">{albums.map(a=><button key={a.link_id} className="portal-album" disabled={busy} onClick={()=>void open(a)}>
     <span className="portal-album-cover">{a.cover?<img src={`/api/customer/albums/${a.link_id}/cover`} alt=""/>:<Images size={34}/>}
      {a.unread>0&&<b className="portal-unread"><MessageCircle size={13}/>{a.unread}</b>}</span>
     <span className="portal-album-body"><strong>{a.project.name}</strong>
      <small>{t('{n} ảnh · {status}',{n:a.photo_count,status:t((STATUS_TEXT as Record<string,string>)[a.project.status]||a.project.status)})}</small>
      {a.project.due_at&&<small><CalendarClock size={12}/>{t('Dự kiến trả ảnh {date}',{date:new Date(a.project.due_at).toLocaleDateString(locale)})}</small>}
      <span className="portal-album-open">{t('Mở album')} <ArrowRight size={15}/></span></span>
    </button>)}</div>
    {error&&<p className="alert" role="alert">{error}</p>}
   </section>:
   <section className="client-home-content"><span className="portal-icon"><Images/></span><span className="eyebrow">PRIVATE CLIENT GALLERY</span><h1>{t('Kỷ niệm của bạn,')}<br/>{t('được giữ trọn vẹn.')}</h1><p>{t('Xem album, chọn ảnh yêu thích, gửi ghi chú chỉnh sửa và tải ảnh từ studio.')}</p>
    <form className="client-access-form" onSubmit={e=>{e.preventDefault();void run(async()=>{await api('/customer/login',json('POST',{phone,pin}));await load();});}}>
     <label htmlFor="client-phone">{t('Đăng nhập bằng số điện thoại và mã PIN studio đã gửi')}</label>
     <div className="client-access-row portal-login-row">
      <div className="input-icon"><Phone/><input id="client-phone" autoFocus required inputMode="tel" autoComplete="tel" value={phone} onChange={e=>setPhone(e.target.value)} placeholder="090 123 4567" aria-label={t('Số điện thoại')}/></div>
      <div className="input-icon"><KeyRound/><input required inputMode="numeric" autoComplete="one-time-code" maxLength={12} value={pin} onChange={e=>setPin(e.target.value.replace(/\D/g,''))} placeholder={t('Mã PIN')} aria-label={t('Mã PIN')}/></div>
      <button className="primary" disabled={busy}>{t('Xem album')} <ArrowRight size={18}/></button>
     </div>
     {error&&<p className="alert" role="alert">{error}</p>}
     <small className="muted portal-help">{t('Chưa có hoặc quên mã PIN? Liên hệ studio để được cấp lại.')}</small>
    </form>
    <div className="client-trust"><ShieldCheck/><span>{t('Ảnh được lưu riêng tại studio')}</span><i/><span>{t('Truy cập dành riêng cho khách hàng')}</span></div></section>}
  <footer className="client-home-footer">© {new Date().getFullYear()} {config.studioName||config.name}</footer>
  {pinOpen&&<Modal title={t('Đổi mã PIN')} closeLabel={t('Đóng')} close={()=>setPinOpen(false)}><form onSubmit={e=>{e.preventDefault();void run(async()=>{await api('/customer/pin',json('POST',{currentPin,pin:newPin}));setPinOpen(false);setNotice(t('Đã đổi mã PIN'));});}}>
   <label>{t('PIN hiện tại')}<input type="password" inputMode="numeric" required value={currentPin} onChange={e=>setCurrentPin(e.target.value)} autoComplete="current-password"/></label>
   <label>{t('PIN mới (6–12 chữ số)')}<input type="password" inputMode="numeric" required pattern="\d{6,12}" value={newPin} onChange={e=>setNewPin(e.target.value.replace(/\D/g,''))} autoComplete="new-password"/></label>
   <button className="primary wide" disabled={busy}>{t('Lưu PIN mới')}</button>{error&&<p className="alert">{error}</p>}</form></Modal>}
  {notice&&<div role="status" className="toast">{notice}</div>}
 </main>;
}
