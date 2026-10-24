import {redirect} from 'next/navigation';
// Source management lives in Manager → Cài đặt → Nguồn ảnh; DSM has its own Console app.
export default function Page(){redirect('/manager');}
