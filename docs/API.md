# API và mô hình dữ liệu

Tất cả request ghi cần `Origin` khớp `PUBLIC_ORIGIN`. Cookie quản trị `proof_admin`, cookie khách `proof_client`: HttpOnly, SameSite Strict, Secure trên HTTPS. Không có upload endpoint. JSON body giới hạn 64 KiB.

## Admin

| Method | Route | Mục đích |
|---|---|---|
| POST | `/api/admin/login` | `{password}` |
| GET | `/api/admin/directories?path=...` | Duyệt root mount bằng relative path |
| GET/POST | `/api/admin/projects` | Danh sách / `{name,root,cron?,timezone?}` |
| PATCH | `/api/admin/projects/:id` | `{name,cron,timezone}` |
| POST | `/api/admin/projects/:id/sync` | Queue scan, 202 |
| POST | `/api/admin/projects/:id/retry` | Retry preview failed |
| GET | `/api/admin/projects/:id/folders` | Thư mục nguồn |
| GET/POST | `/api/admin/projects/:id/links` | Link / `{label,password?,folder_ids?,downloads?,originals?,expires_at?}` |
| POST | `/api/admin/links/:id/revoke` | Thu hồi |
| GET | `/api/admin/projects/:id/selections` | Các list và trạng thái chốt |
| GET | `/api/admin/lists/:id/export?format=csv` | CSV; bỏ format để lấy search string JSON |
| GET | `/api/admin/projects/:id/comments?format=csv` | CSV; bỏ format để lấy JSON |
| PATCH | `/api/admin/comments/:id` | `{resolved}` |

## Client

| Method | Route | Mục đích |
|---|---|---|
| GET | `/api/share/:token` | Tên project và có yêu cầu mật khẩu hay không |
| POST | `/api/share/:token/unlock` | `{name,password?}` tạo phiên khách |
| POST | `/api/access` | `{phone}` mở quyền album hoạt động gần nhất từ portal studio |
| GET | `/api/client/gallery?token=...` | Project, folders có quyền, lists |
| GET | `/api/client/photos` | `folder_id?,list_id?,search?,offset?,limit?` (max 120/page) |
| GET | `/api/client/photos/:id/thumb` | WebP thumbnail |
| GET | `/api/client/photos/:id/preview` | WebP lớn, auth mỗi lần |
| POST | `/api/client/lists` | `{name}` |
| PUT | `/api/client/lists/:id/photos/:photo` | `{selected}` idempotent |
| POST | `/api/client/lists/:id/submit` | `{submitted}` chốt/mở lại |
| GET | `/api/client/lists/:id/export` | Stem, loại trùng |
| GET/POST | `/api/client/photos/:id/comments` | Đọc / `{x,y,body}` |
| POST | `/api/client/downloads` | `{photo_ids? | folder_id? | list_id?,original?}` → `{url}` |
| GET | `/api/client/downloads/:ticket` | ZIP stream, ticket 1 lần, 2 phút |

## Database

Schema version 1 được khởi tạo trong `backend/src/db.mjs`. Bảng chính: `projects`, `folders`, `photos`, `selection_lists`, `client_selections`, `comments`. Bảng hỗ trợ: `links`, `link_folders`, `sessions`, `scan_runs`, `jobs`, `download_tickets`.

Root mount duy nhất có thể chứa nhiều project. Folder lưu relative path đầy đủ thay cho parent_id; quan hệ hậu duệ kiểm tra theo segment prefix, không dùng LIKE wildcard. Unique `(project_id,relative_path)`, composite FK ngăn photo/list/link-folder chéo project. Timestamps UTC; cron theo timezone project. Job có unique `(photo_id,version)`, queue chạy một backend instance, status running được phục hồi khi restart; không thiết kế để scale nhiều replicas.

Manager quản lý allowlist nguồn qua `GET/POST/PATCH /api/admin/sources`. Project mới chỉ được tạo dưới một `approved_sources` đang bật. Container vẫn phải mount thư mục cha read-only; API không điều khiển Docker và không nhận đường dẫn host tùy ý.

Quyền khách có thể dùng secret link hoặc số điện thoại tại portal. Database chỉ lưu hash số điện thoại và 4 số cuối để Manager nhận biết. Nếu một số có nhiều quyền đang hoạt động, portal mở quyền được tạo gần nhất; các album cũ vẫn mở được bằng secret link.
