export async function api<T=any>(url:string,options:RequestInit={}):Promise<T>{
  const res=await fetch(`/api${url}`,{...options,headers:{'Content-Type':'application/json',...options.headers},cache:'no-store'});
  const body=await res.json();if(!res.ok)throw Object.assign(new Error(body.error||'Không thể kết nối'),{status:res.status});return body;
}
export const json=(method:string,data:unknown):RequestInit=>({method,body:JSON.stringify(data)});
export async function copy(value:string){if(!navigator.clipboard)throw new Error('Trình duyệt cần HTTPS để sao chép. Bạn có thể chọn và copy chuỗi hiển thị.');await navigator.clipboard.writeText(value);}
