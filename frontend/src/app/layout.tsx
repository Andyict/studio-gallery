import './globals.css';
import './studio-theme.css';
export const metadata={title:'Studio Gallery',description:'Không gian chọn ảnh riêng của bạn',robots:{index:false,follow:false}};
export default function RootLayout({children}:{children:React.ReactNode}) {return <html lang="vi"><body>{children}</body></html>;}
