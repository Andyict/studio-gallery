"use client";
import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

type Props = React.InputHTMLAttributes<HTMLInputElement>;
export default function PasswordField({ className = "", ...props }: Props) {
  const [visible, setVisible] = useState(false);
  return <span className={`password-field ${className}`}>
    <input {...props} type={visible ? "text" : "password"} />
    <button type="button" className="password-toggle" aria-label={visible ? "Ẩn mật khẩu" : "Hiện mật khẩu"} onClick={() => setVisible(v => !v)}>
      {visible ? <EyeOff size={17} /> : <Eye size={17} />}
    </button>
  </span>;
}
