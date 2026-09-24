"use client";
import {useEffect,useState} from 'react';
import {api,json} from '@/lib/api';
export default function Console(){
 const [sources,setSources]=useState<any[]>([]),[path,setPath]=useState(''),[label,setLabel]=useState(''),[error,setError]=useState('');
 const load=()=>api('/admin/sources').then(setSources).catch(e=>setError(e.message)); useEffect(()=>{void load()},[]);
 async function add(e:any){e.preventDefault();try{await api('/admin/sources',json('POST',{label:label||path.split('/').pop()||'Nguồn ảnh',relative_path:path}));setPath('');setLabel('');await load()}catch(e:any){setError(e.message)}}
 async function toggle(s:any){await api('/admin/sources/'+s.id,json('PATCH',{enabled:!s.enabled}));await load()}
 return <main className="console-page"><header><div className="eyebrow">STUDIO GALLERY CONSOLE</div><h1>Quản lý quyền thư mục</h1><p>Bật nguồn ảnh trên NAS và kiểm soát thư mục được phép quét thành album.</p></header><section className="console-card"><h2>Thêm share folder</h2><form onSubmit={add} className="console-form"><input value={label} onChange={e=>setLabel(e.target.value)} placeholder="Tên nguồn, ví dụ Studio"/><input value={path} onChange={e=>setPath(e.target.value)} placeholder="Đường dẫn, ví dụ /volume1/Studio" required/><button className="primary">Cấp quyền & quét</button></form></section><section className="console-card"><div className="console-heading"><h2>Share folder đã cấp quyền</h2><button onClick={()=>void load()}>Làm mới</button></div>{error&&<p className="alert">{error}</p>}{sources.length===0?<p className="muted">Chưa có nguồn ảnh nào.</p>:sources.map(s=><div className="source-row" key={s.id}><div><strong>{s.label}</strong><small>{s.relative_path}</small></div><label className="switch"><input type="checkbox" checked={s.enabled} onChange={()=>void toggle(s)}/><span/></label></div>)}</section></main>
}
