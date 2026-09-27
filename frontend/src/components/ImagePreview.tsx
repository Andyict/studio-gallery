"use client";
import {useEffect,useRef,useState} from "react";

export default function ImagePreview({src,name}:{src:string;name:string}) {
  const [zoom,setZoom]=useState(1),[offset,setOffset]=useState({x:0,y:0});
  const [loaded,setLoaded]=useState(false),[failed,setFailed]=useState(false);
  const stage=useRef<HTMLDivElement>(null),img=useRef<HTMLImageElement>(null);
  const drag=useRef<{x:number;y:number;ox:number;oy:number}|null>(null);
  const fit=()=>{setZoom(1);setOffset({x:0,y:0});};
  const change=(amount:number)=>setZoom(v=>Math.min(8,Math.max(1,v*amount)));
  const actual=()=>{const node=img.current;if(node){setZoom(Math.min(8,Math.max(1,node.naturalWidth/node.clientWidth)));setOffset({x:0,y:0});}};
  useEffect(()=>{const node=stage.current;if(!node)return;const wheel=(e:WheelEvent)=>{e.preventDefault();change(e.deltaY<0?1.15:1/1.15);};node.addEventListener("wheel",wheel,{passive:false});return()=>node.removeEventListener("wheel",wheel);},[]);
  useEffect(()=>{if(zoom===1)setOffset({x:0,y:0});},[zoom]);
  return <div className="image-preview-viewer">
    <div className="image-preview-toolbar">
      <button onClick={()=>change(1/1.25)} disabled={zoom<=1} aria-label="Thu nhỏ">−</button>
      <span>{Math.round(zoom*100)}% mức vừa</span>
      <button onClick={()=>change(1.25)} disabled={zoom>=8} aria-label="Phóng to">+</button>
      <button onClick={fit}>Vừa màn hình</button><button onClick={actual} disabled={!loaded}>100% ảnh preview</button>
      <small>Cuộn để zoom · Kéo để di chuyển</small>
    </div>
    <div ref={stage} className="image-preview-stage" tabIndex={0} role="region" aria-label="Ảnh xem trước, dùng dấu cộng trừ để zoom và phím 0 để đặt lại"
      style={{cursor:zoom>1?"grab":"zoom-in"}}
      onKeyDown={e=>{if(e.key==='+'||e.key==='='){e.preventDefault();change(1.25);}if(e.key==='-'){e.preventDefault();change(1/1.25);}if(e.key==='0')fit();}}
      onDoubleClick={()=>zoom>1?fit():actual()}
      onPointerDown={e=>{if(zoom<=1)return;e.currentTarget.setPointerCapture(e.pointerId);drag.current={x:e.clientX,y:e.clientY,ox:offset.x,oy:offset.y};}}
      onPointerMove={e=>{const d=drag.current;if(d)setOffset({x:d.ox+e.clientX-d.x,y:d.oy+e.clientY-d.y});}}
      onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}}>
      {!loaded&&!failed&&<span className="preview-status">Đang tải ảnh…</span>}
      {failed?<span className="preview-status">Không tải được ảnh xem trước.</span>:<img ref={img} src={src} alt={name} draggable={false} onLoad={()=>setLoaded(true)} onError={()=>setFailed(true)} style={{transform:`translate(${offset.x}px,${offset.y}px) scale(${zoom})`}}/>}
    </div>
  </div>;
}

