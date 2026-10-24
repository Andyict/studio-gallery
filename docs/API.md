# API và mô hình dữ liệu

Tất cả request ghi cần `Origin` khớp `PUBLIC_ORIGIN`. Cookie quản trị `proof_admin`, cookie khách `proof_client`: HttpOnly, SameSite Strict, Secure trên HTTPS. Không có upload endpoint. JSON body giới hạn 64 KiB.

## Admin

| Method | Route | Mục đích |
|---|---|---|
| POST | `/api/admin/login` | `{password}` |
| GET | `/api/admin/directories?path=...` | Duyệt root mount bằng relative path |
| GET/POST | `/api/admin/projects` | Danh sách / `{name,root,cron?,timezone?}` |
| PATCH | `/api/admin/projects/:id` | `{name,cron,timezone,editor?,internal_note?}`; cron 5 trường, ví dụ `*/10 * * * *` |
| PATCH | `/api/admin/projects/:id/workflow` | `{status?,max_edit?,due_at?,client_message?}`; status `selecting→submitted→editing→delivered`, về `selecting` mở khoá khách |
| GET | `/api/admin/projects/:id/worklist?format=csv` | Danh sách edit (ảnh chọn edit, hoặc ảnh đã tim khi `max_edit=0`), search string, CSV kèm ghi chú |
| PATCH | `/api/admin/photos/:id/done` | `{done}` editor đánh dấu đã chỉnh xong |
| POST | `/api/admin/projects/:id/sync` | Queue scan, 202 |
| POST | `/api/admin/projects/:id/retry` | Retry preview failed |
| GET | `/api/admin/projects/:id/folders` | Thư mục nguồn |
| GET/POST | `/api/admin/projects/:id/links` | Link / `{label,password?,phone?,customer_id?,customer_name?,folder_ids?,downloads?,originals?,expires_at?}`; có `phone` thì link gắn vào tài khoản khách (tạo mới kèm `pin` nếu chưa có) |
| POST | `/api/admin/links/:id/revoke` | Thu hồi |
| GET/POST | `/api/admin/customers` | Danh sách / `{name,phone,pin?,note?}` tạo tài khoản khách, trả PIN một lần |
| PATCH | `/api/admin/customers/:id` | `{name,note,disabled}` |
| POST | `/api/admin/customers/:id/pin` | `{pin?}` cấp PIN mới (mở khoá, đăng xuất phiên cũ) |
| POST | `/api/admin/customers/:id/unlock` | Gỡ khoá do nhập sai |
| POST | `/api/admin/notify/test` | Gửi thử tới các kênh thông báo đã cấu hình (admin) |
| GET | `/api/admin/dashboard` | Việc cần làm (theo phạm vi album của tài khoản) |
| POST | `/api/admin/projects/:id/archive` | `{archived}` lưu trữ / khôi phục |
| DELETE | `/api/admin/projects/:id` | `{confirm:<tên album>}` xoá dữ liệu album đã lưu trữ (admin) |
| GET | `/api/admin/projects/:id/downloads` | Lịch sử khách tải ZIP |
| GET | `/api/admin/team` | Nhân viên đang hoạt động (để phân công) |
| GET/PUT | `/api/admin/projects/:id/staff` | Nhân viên phụ trách album / `{user_ids}` |
| GET | `/api/admin/projects/:id/selections` | Các list và trạng thái chốt |
| GET | `/api/admin/lists/:id/export?format=csv` | CSV; bỏ format để lấy search string JSON |
| GET | `/api/admin/projects/:id/comments?format=csv` | Ghi chú ảnh của khách; CSV hoặc JSON |
| GET/POST | `/api/admin/projects/:id/messages` | Dòng thời gian chat + ghi chú ảnh (`photo_id?,scope?,after?,before?,limit?`) / `{body,photo_id?}` |
| POST | `/api/admin/projects/:id/messages/read` | `{upto?}` dời con trỏ đã đọc chung của nhân viên |
| PATCH | `/api/admin/messages/:id` | `{resolved}` cho ghi chú ảnh của khách |
| GET | `/api/admin/chats` | Mỗi album một hội thoại, số tin khách chưa đọc |
| GET | `/api/admin/inbox` | Ghi chú ảnh chưa xử lý + tin khách chưa đọc |
| GET | `/api/admin/notifications` / POST `.../seen` | Thông báo hoạt động của khách, mốc đã xem theo nhân viên |
| GET | `/api/admin/events` | Server-Sent Events cho nhân viên |

## Client

| Method | Route | Mục đích |
|---|---|---|
| GET | `/api/share/:token` | Tên project và có yêu cầu mật khẩu hay không |
| POST | `/api/share/:token/unlock` | `{name,password?}` tạo phiên khách |
| POST | `/api/customer/login` | `{phone,pin}` đăng nhập tài khoản khách; sai 5 lần khoá 15 phút theo số điện thoại |
| GET | `/api/customer/me`, `/api/customer/albums` | Thông tin khách và mọi album có link còn hiệu lực |
| POST | `/api/customer/albums/:link/open` | Mở album (tạo phiên khách theo link) |
| GET | `/api/customer/albums/:link/cover` | Ảnh bìa trong phạm vi link |
| POST | `/api/customer/pin` | `{currentPin,pin}` khách tự đổi PIN (6–12 chữ số) |
| GET | `/api/client/gallery?token=...` | Project (trạng thái, `max_edit`, `edit_count`, hạn trả, lời nhắn studio, ghi chú chung), folders có quyền, `final_folder` khi đã trả ảnh, lists |
| GET | `/api/client/photos` | `folder_id?,list_id?,edit=1?,unseen=1?,search?,offset?,limit?` (max 120/page); không lẫn ảnh thư mục Final |
| PUT | `/api/client/photos/:id/edit` | `{selected}` chọn ảnh chỉnh sửa, tối đa `max_edit` |
| POST | `/api/client/photos/:id/viewed` | Ghi nhận đã xem (lọc "Chưa xem" theo link) |
| POST | `/api/client/album/submit` | Gửi studio: khoá tim, chọn edit và danh sách |
| PUT | `/api/client/album/note` | `{text}` ghi chú chung cho cả album |
| GET | `/api/client/photos/:id/thumb` | WebP thumbnail |
| GET | `/api/client/photos/:id/preview` | WebP lớn, auth mỗi lần |
| POST | `/api/client/lists` | `{name}` |
| PUT | `/api/client/lists/:id/photos/:photo` | `{selected}` idempotent |
| POST | `/api/client/lists/:id/submit` | `{submitted}` chốt/mở lại một danh sách khi album còn ở trạng thái đang chọn |
| GET | `/api/client/lists/:id/export` | Stem, loại trùng |
| GET/POST | `/api/client/messages` | Tin trong phạm vi link (`photo_id?,scope?,after?,before?,limit?`) / `{body,photo_id?,x?,y?}` |
| GET | `/api/client/messages/unread` | `{total,chat,photos}` tin studio chưa đọc |
| POST | `/api/client/messages/read` | `{photo_id?}` đánh dấu đọc cả album hoặc một ảnh |
| GET | `/api/client/events` | Server-Sent Events cho album của link |
| POST | `/api/client/downloads` | `{photo_ids? | folder_id? | list_id?,original?}` → `{url}` |
| GET | `/api/client/downloads/:ticket` | ZIP stream, ticket 1 lần, 2 phút |

## Database

Schema version 1 được khởi tạo trong `backend/src/db.mjs`. Bảng chính: `projects`, `folders`, `photos`, `selection_lists`, `client_selections`, `messages` (chat và ghi chú ảnh, khoá `seq` tăng dần), `read_cursors`, `notifications`, `photo_views`. Bảng `comments`/`chat_messages` của v0.2 được chuyển một lần sang `messages` và giữ lại làm dự phòng. Cột workflow (`status`, `max_edit`, `due_at`, `edit_pick`, `edit_done`…) được thêm khi khởi động. Bảng hỗ trợ: `links`, `link_folders`, `sessions`, `scan_runs`, `jobs`, `download_tickets`.

Root mount duy nhất có thể chứa nhiều project. Folder lưu relative path đầy đủ thay cho parent_id; quan hệ hậu duệ kiểm tra theo segment prefix, không dùng LIKE wildcard. Unique `(project_id,relative_path)`, composite FK ngăn photo/list/link-folder chéo project. Timestamps UTC; cron theo timezone project. Job có unique `(photo_id,version)`, queue chạy một backend instance, status running được phục hồi khi restart; không thiết kế để scale nhiều replicas.

Manager quản lý allowlist nguồn qua `GET/POST/PATCH /api/admin/sources`. Project mới chỉ được tạo dưới một `approved_sources` đang bật. Container vẫn phải mount thư mục cha read-only; API không điều khiển Docker và không nhận đường dẫn host tùy ý.

Khách vào album bằng secret link hoặc đăng nhập trang chủ bằng số điện thoại + PIN (bảng `customers`, `login_failures`). Database chỉ lưu hash số điện thoại, 4 số cuối và hash PIN. Mỗi link có thể gắn `customer_id`; khách thấy mọi album có link còn hiệu lực, mỗi link giữ phạm vi thư mục và quyền tải riêng. Link có số điện thoại từ v0.2 được chuyển thành tài khoản chưa có PIN: khách cần studio cấp PIN trước khi đăng nhập lại (không còn đăng nhập chỉ bằng số điện thoại).

Tài khoản nhân viên có `album_scope`: `all` (mặc định) hoặc `assigned`. Nhân viên `assigned` chỉ thấy album trong `project_staff`; mọi route admin gắn với album, ảnh, danh sách, tin nhắn, link đều được kiểm tra tập trung, và họ không duyệt NAS hay tạo album.
