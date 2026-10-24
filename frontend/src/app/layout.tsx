import './globals.css';
import './studio-theme.css';
import type { Viewport } from 'next';
import ThemeSync from '@/components/ThemeSync';
export const metadata={title:'Studio Gallery',description:'Không gian chọn ảnh riêng của bạn',robots:{index:false,follow:false},
  appleWebApp:{capable:true,title:'Album ảnh',statusBarStyle:'default' as const},icons:{apple:'/icons/apple-touch-icon.png',icon:'/icons/icon-192.png'}};
export const viewport:Viewport={themeColor:'#365c48',width:'device-width',initialScale:1};
export default function RootLayout({children}:{children:React.ReactNode}) {return <html lang="vi"><body><ThemeSync/>{children}</body></html>;}
