export async function api<T=any>(url:string,options:RequestInit={}):Promise<T>{
  const controller=new AbortController();
  const abort=()=>controller.abort();
  if(options.signal?.aborted)abort();
  options.signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(abort,30000);
  try{
    const res=await fetch(`/api${url}`,{...options,signal:controller.signal,headers:{'Content-Type':'application/json',...options.headers},cache:'no-store'});
    const body=await res.json().catch(()=>({error:'Máy chủ trả về dữ liệu không hợp lệ'}));
    if(!res.ok)throw Object.assign(new Error(body.error||'Không thể kết nối'),{status:res.status});return body;
  }catch(e){
    if(controller.signal.aborted)throw new Error('Yêu cầu quá lâu hoặc đã bị hủy. Vui lòng thử lại.');
    throw e;
  }finally{clearTimeout(timer);options.signal?.removeEventListener('abort',abort);}

}
export const json=(method:string,data:unknown):RequestInit=>({method,body:JSON.stringify(data)});
export async function copy(value:string){if(!navigator.clipboard)throw new Error('Trình duyệt cần HTTPS để sao chép. Bạn có thể chọn và copy chuỗi hiển thị.');await navigator.clipboard.writeText(value);}
