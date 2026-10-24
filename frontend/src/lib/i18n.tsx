"use client";
import { useSyncExternalStore } from "react";

// Customer-facing pages in Vietnamese (default) or English. Vietnamese source text is the key, so
// untranslated strings simply show in Vietnamese. Placeholders use {name}. The choice is kept per
// browser. Studio-side screens stay Vietnamese.
export type Lang = "vi" | "en";
const KEY = "studio-lang";
const listeners = new Set<() => void>();
let current: Lang | null = null;

function read(): Lang {
  if (current) return current;
  try { const saved = localStorage.getItem(KEY); if (saved === "vi" || saved === "en") return (current = saved); } catch { /* storage blocked */ }
  return (current = "vi");
}
export function setLang(lang: Lang) {
  current = lang;
  try { localStorage.setItem(KEY, lang); } catch { /* storage blocked */ }
  document.documentElement.lang = lang;
  listeners.forEach(l => l());
}
const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l); };

export function translate(lang: Lang, text: string, vars?: Record<string, string | number>) {
  let out = lang === "en" ? EN[text] ?? text : text;
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, String(v));
  return out;
}
export function useI18n() {
  const lang = useSyncExternalStore(subscribe, read, () => "vi" as Lang);
  return {
    lang,
    t: (text: string, vars?: Record<string, string | number>) => translate(lang, text, vars),
    locale: lang === "en" ? "en-GB" : "vi-VN",
    setLang
  };
}

export function LangSwitch({ className = "" }: { className?: string }) {
  const { lang } = useI18n();
  return <div className={`lang-switch ${className}`} role="group" aria-label="Language / Ngôn ngữ">
    {(["vi", "en"] as const).map(l => <button key={l} type="button" className={lang === l ? "active" : ""} aria-pressed={lang === l} onClick={() => setLang(l)}>{l.toUpperCase()}</button>)}
  </div>;
}

const EN: Record<string, string> = {
  // entry / share link
  "Mỗi khoảnh khắc,": "Every moment,",
  "một câu chuyện.": "a story.",
  "DÀNH RIÊNG CHO BẠN": "JUST FOR YOU",
  "Bộ ảnh của bạn": "Your photos",
  "Xem lại những khoảnh khắc đẹp, chọn ảnh yêu thích và gửi lời nhắn cho studio.": "Relive your moments, pick your favourites and send notes to the studio.",
  "Tên của bạn": "Your name",
  "Để studio biết ai đang chọn ảnh": "So the studio knows who is choosing",
  "PIN / Mật khẩu": "PIN / Password",
  "Mở bộ ảnh": "Open gallery",
  "← Về trang studio": "← Back to studio",
  "Ảnh được lưu trữ riêng tại studio.": "Photos are stored privately at the studio.",
  "Phiên truy cập đã hết hạn. Hãy mở lại album từ trang studio.": "Your session has expired. Please open the album again from the studio page.",
  // gallery chrome
  "Về trang studio": "Back to studio",
  "Album của tôi": "My albums",
  "BỘ ẢNH RIÊNG TƯ": "PRIVATE GALLERY",
  "BỘ SƯU TẬP CỦA BẠN": "YOUR COLLECTION",
  "Những khoảnh khắc của bạn. Những lựa chọn của bạn.": "Your moments. Your choices.",
  // default list created by the server
  "Ảnh làm album": "Album picks",
  "Liên hệ studio": "Contact the studio",
  "Dự kiến trả ảnh {date}": "Expected delivery {date}",
  "{n} yêu thích": "{n} favourites",
  "{n} chọn tải": "{n} to download",
  "Tải xuống": "Download",
  "Thư mục ảnh": "Photo folders",
  "Ảnh hoàn thiện": "Finished photos",
  "Tất cả ảnh": "All photos",
  "Danh sách chọn ảnh": "Selection list",
  "Tạo danh sách": "New list",
  "Ảnh yêu thích": "Favourites",
  "Chọn edit {n}/{max}": "Edit picks {n}/{max}",
  "Chưa xem": "Not viewed",
  "{n} ảnh": "{n} photos",
  "Tìm tên file": "Search file name",
  "Tìm tên file…": "Search file name…",
  "Đóng thông báo": "Dismiss",
  "Đang chọn ảnh": "Choosing photos",
  "Đã gửi studio": "Sent to studio",
  "Studio đang chỉnh sửa": "Studio is editing",
  "Đã trả ảnh": "Delivered",
  // empty states
  "Chưa có ảnh trong danh sách": "No photos in this list yet",
  "Chưa chọn ảnh chỉnh sửa": "No photos picked for editing",
  "Bạn đã xem hết ảnh": "You have seen every photo",
  "Chưa có ảnh để hiển thị": "No photos to show yet",
  "Chạm trái tim trên ảnh bạn yêu thích.": "Tap the heart on photos you love.",
  "Chạm biểu tượng bút trên ảnh để chọn ảnh cần chỉnh sửa.": "Tap the pen on a photo to pick it for editing.",
  "Mọi ảnh trong mục này đều đã được mở.": "Every photo here has been opened.",
  "Studio có thể đang đồng bộ ảnh. Hãy thử tải lại.": "The studio may still be syncing photos. Try reloading.",
  "Tải lại": "Reload",
  "Đang tải bộ ảnh…": "Loading photos…",
  "Xem thêm ảnh": "Load more photos",
  // photo cards
  "Xem {name}": "View {name}",
  "Preview chưa hỗ trợ": "Preview not available",
  "Đang xử lý…": "Processing…",
  "Chọn {name} để tải": "Select {name} for download",
  "Chọn chỉnh sửa {name}": "Pick {name} for editing",
  "Yêu thích {name}": "Favourite {name}",
  "Có kèm file RAW": "Includes a RAW file",
  "Studio vừa trả lời": "The studio replied",
  "Bạn chỉ được chọn tối đa {n} ảnh để chỉnh sửa. Bỏ chọn một ảnh khác trước.": "You can pick up to {n} photos for editing. Unpick another photo first.",
  "Ảnh này chưa được tải trong danh sách hiện tại. Hãy chọn đúng thư mục hoặc tải thêm ảnh.": "This photo is not loaded in the current view. Open its folder or load more photos.",
  // proof bar
  "ẢNH CHỌN CHỈNH SỬA": "PHOTOS TO EDIT",
  "YÊU THÍCH GỬI STUDIO": "FAVOURITES FOR THE STUDIO",
  "Chọn edit": "Edit picks",
  "Export tên ảnh": "Export file names",
  "Ghi chú chung": "General note",
  "Gửi studio": "Send to studio",
  // lightbox
  "Xem ảnh và ghi chú": "Photo and notes",
  "Phát video và gửi ghi chú cho studio": "Play the video and send notes to the studio",
  "Chạm vào ảnh để ghim ghi chú": "Tap the photo to pin a note",
  "Ảnh trước": "Previous photo",
  "Ảnh tiếp": "Next photo",
  "Đóng ảnh": "Close photo",
  "Ảnh này chưa có preview.": "This photo has no preview yet.",
  "GHI CHÚ & TRAO ĐỔI": "NOTES & REPLIES",
  "Một chút hoàn thiện": "A finishing touch",
  "Nhập mốc thời gian và yêu cầu chỉnh sửa vào ghi chú.": "Add a timestamp and what you would like changed.",
  "Chọn vị trí trên ảnh và nhắn điều bạn muốn studio chỉnh sửa.": "Tap a spot on the photo and tell the studio what to adjust.",
  "Bạn": "You",
  "Studio đã xử lý": "Done by the studio",
  "Đang chờ studio": "Waiting for the studio",
  "Ghi chú cho video (có thể ghi mốc thời gian)": "Note for this video (you can add a timestamp)",
  "Đã ghim vị trí trên ảnh": "Spot pinned on the photo",
  "Ghi chú cho ảnh (có thể chạm để ghim vị trí)": "Note for this photo (tap to pin a spot)",
  "Ví dụ: Làm sáng vùng mặt một chút…": "e.g. Brighten the face a little…",
  "Gửi ghi chú": "Send note",
  "Đã gửi ghi chú cho studio": "Note sent to the studio",
  "Đã yêu thích": "Favourited",
  "Thêm vào yêu thích": "Add to favourites",
  "Đã chọn chỉnh sửa ({n}/{max})": "Picked for editing ({n}/{max})",
  "Chọn để chỉnh sửa ({n}/{max})": "Pick for editing ({n}/{max})",
  // modals
  "Đóng": "Close",
  "Gửi lựa chọn cho studio?": "Send your selection to the studio?",
  "Bạn đã chọn {n}/{max} ảnh để chỉnh sửa.": "You picked {n}/{max} photos for editing.",
  "Danh sách \"{name}\" có {n} ảnh yêu thích.": "The list \"{name}\" has {n} favourites.",
  "Sau khi gửi, lựa chọn sẽ được khoá để studio bắt đầu chỉnh sửa. Nếu cần đổi, hãy nhắn studio mở lại.": "After sending, your choices are locked so the studio can start editing. Message the studio if you need to change them.",
  "Bạn vẫn có thể chọn thêm {n} ảnh.": "You can still pick {n} more.",
  "Xác nhận gửi studio": "Send to the studio",
  "Đã gửi lựa chọn cho studio": "Your selection was sent to the studio",
  "Ghi chú chung cho cả album": "General note for the whole album",
  "Mong muốn chung (tông màu, phong cách, ảnh ưu tiên…)": "Overall wishes (colour tone, style, priority photos…)",
  "Ví dụ: tông màu ấm, da sáng tự nhiên, ưu tiên ảnh gia đình…": "e.g. warm tones, natural bright skin, family photos first…",
  "Lưu ghi chú": "Save note",
  "Đã lưu ghi chú cho studio": "Note saved for the studio",
  "Thêm danh sách chọn ảnh": "Add a selection list",
  "Tên danh sách": "List name",
  "Ảnh rửa, Ảnh đăng mạng xã hội…": "Prints, social media…",
  "Tải ảnh & video về thiết bị": "Download photos & videos",
  "Dấu tích chỉ dùng cho lượt tải hiện tại. Trái tim vẫn là danh sách yêu thích gửi cho studio.": "Ticks are only for this download. Hearts remain your favourites for the studio.",
  "Tải {n} ảnh đang tích chọn · Bản xem (ảnh WebP / video MP4)": "Download {n} ticked photos · Viewing copies (WebP / MP4)",
  "Tải toàn bộ tab hiện tại · Bản xem (ảnh WebP / video MP4)": "Download this tab · Viewing copies (WebP / MP4)",
  "Tải tất cả ảnh được cấp quyền · Bản xem (ảnh WebP / video MP4)": "Download everything shared with you · Viewing copies (WebP / MP4)",
  "Tải {n} ảnh đang tích chọn · File gốc": "Download {n} ticked photos · Original files",
  "Tải toàn bộ tab hiện tại · File gốc": "Download this tab · Original files",
  "Tải tất cả · File gốc": "Download everything · Original files",
  "Đang bắt đầu tải ZIP…": "Starting the ZIP download…",
  "Tên ảnh cho Lightroom / Bridge": "File names for Lightroom / Bridge",
  "Sao chép": "Copy",
  "Đã sao chép tên ảnh": "File names copied",
  // chat
  "Trò chuyện với studio": "Chat with the studio",
  "Trò chuyện với studio, {n} tin mới": "Chat with the studio, {n} new",
  "TRÒ CHUYỆN": "CHAT",
  "Nhắn với studio": "Message the studio",
  "Đóng trò chuyện": "Close chat",
  "Xem tin cũ hơn": "Show older messages",
  "Hỏi studio về lịch giao ảnh, yêu cầu chỉnh sửa hay bất cứ điều gì. Ghi chú trên từng ảnh cũng hiện ở đây.": "Ask the studio about delivery, edits or anything else. Notes on single photos show up here too.",
  "Tin nhắn gửi studio": "Message to the studio",
  "Nhắn cho studio…": "Write to the studio…",
  "Gửi": "Send",
  // portal
  "Studio Manager": "Studio Manager",
  "Đổi PIN": "Change PIN",
  "Đăng xuất": "Sign out",
  "ALBUM CỦA TÔI": "MY ALBUMS",
  "Xin chào, {name}.": "Hello, {name}.",
  "Chọn album để xem ảnh, thả tim, gửi ghi chú và trò chuyện với studio.": "Choose an album to view photos, heart favourites, leave notes and chat with the studio.",
  "Hiện chưa có album nào đang mở cho bạn. Studio sẽ báo khi album sẵn sàng.": "No album is open for you right now. The studio will let you know when one is ready.",
  "{n} ảnh · {status}": "{n} photos · {status}",
  "Mở album": "Open album",
  "Kỷ niệm của bạn,": "Your memories,",
  "được giữ trọn vẹn.": "kept whole.",
  "Xem album, chọn ảnh yêu thích, gửi ghi chú chỉnh sửa và tải ảnh từ studio.": "View your albums, pick favourites, send edit notes and download photos from the studio.",
  "Đăng nhập bằng số điện thoại và mã PIN studio đã gửi": "Sign in with your phone number and the PIN from the studio",
  "Số điện thoại": "Phone number",
  "Mã PIN": "PIN",
  "Xem album": "View albums",
  "Chưa có hoặc quên mã PIN? Liên hệ studio để được cấp lại.": "No PIN or forgot it? Ask the studio for a new one.",
  "Ảnh được lưu riêng tại studio": "Photos stored privately at the studio",
  "Truy cập dành riêng cho khách hàng": "Access for clients only",
  "Đổi mã PIN": "Change PIN",
  "PIN hiện tại": "Current PIN",
  "PIN mới (6–12 chữ số)": "New PIN (6–12 digits)",
  "Lưu PIN mới": "Save new PIN",
  "Đã đổi mã PIN": "PIN changed"
};
