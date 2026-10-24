// Ready-to-send Zalo/SMS text for a customer, built from what the studio just created.
export function inviteMessage({ customer, album, origin, phone, pin, url, studio }: {
  customer?: string | null; album?: string | null; origin: string; phone?: string | null; pin?: string | null; url?: string | null; studio?: string | null;
}) {
  const lines = [`Chào ${customer || "anh/chị"},`];
  lines.push(album ? `Album "${album}" đã sẵn sàng để anh/chị xem và chọn ảnh.` : "Studio đã mở tài khoản xem ảnh cho anh/chị.");
  if (pin) {
    lines.push(`Mở ${origin} và đăng nhập:`);
    lines.push(`• Số điện thoại: ${phone || "số anh/chị đã đăng ký với studio"}`);
    lines.push(`• Mã PIN: ${pin}`);
  } else if (phone) lines.push(`Mở ${origin} và đăng nhập bằng số điện thoại ${phone} cùng mã PIN đã nhận.`);
  if (url) lines.push(`Hoặc mở trực tiếp: ${url}`);
  lines.push(`Cảm ơn anh/chị${studio ? ` – ${studio}` : ""}!`);
  return lines.join("\n");
}
