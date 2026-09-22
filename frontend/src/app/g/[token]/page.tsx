import Gallery from '@/components/Gallery';
export default async function Page({params}:{params:Promise<{token:string}>}){const {token}=await params;return <Gallery token={token}/>;}
