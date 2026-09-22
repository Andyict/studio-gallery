# Tham khảo sản phẩm và quyết định phạm vi

Ngày tham khảo: 2026-09-21. Chỉ tham khảo tài liệu tính năng; không sao chép mã nguồn hay giao diện của các dự án.

| Dự án / nguồn chính thức | Điều áp dụng |
| --- | --- |
| [Immich External Libraries](https://docs.immich.app/features/libraries/) | Đọc ảnh từ mount read-only, quét thư mục ngoài ứng dụng; tách preview khỏi ảnh gốc. |
| [Immich Sharing](https://docs.immich.app/features/sharing/) | Link khách không cần tài khoản; quyền tải tách khỏi quyền xem. |
| [PhotoPrism Sharing](https://docs.photoprism.app/user-guide/share/) | Link bí mật cho bộ ảnh; người xem không sửa metadata nguồn. |
| [Piwigo Permissions](https://doc.piwigo.org/organizing-albums/permissions-and-album-visibility/) | Phân quyền theo album/cây thư mục, áp dụng cả endpoint media. |
| [SQLite WAL](https://www.sqlite.org/wal.html) | Database trên local disk của NAS; WAL không nằm trên SMB/NFS. |
| [Sharp RAW support](https://sharp.pixelplumbing.com/changelog/v0.34.3/) | RAW decode trực tiếp cần libvips có LibRaw. Binary Sharp thông thường không được mặc định coi là hỗ trợ mọi RAW. |

Các bổ sung phục vụ studio: chốt/mở lại list, deadline và thu hồi link, lọc ảnh đã chọn, tìm tên file, CSV ghi chú có tọa độ, CSV danh sách có cờ mất nguồn, retry preview lỗi và backup SQLite nhất quán.

Không đưa face recognition, tìm kiếm AI, video, upload và đồng bộ cloud vào bản này. Chúng tăng tải NAS và không cần thiết cho client proofing.

Backend chọn Fastify (phương án Node.js được yêu cầu cho phép), SQLite tích hợp Node 24, Sharp/libvips. Queue lưu SQLite, worker giới hạn một ảnh mỗi lượt. ZIP dùng yazl lazy stream, không file ZIP tạm.
