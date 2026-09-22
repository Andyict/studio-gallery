# Kiểm chứng ngày 2026-09-21

- Windows local, Node 24.14.0: `npm test` thành công (2 test suites/cases, gồm workflow tích hợp).
- Kiểm tra tích hợp: traversal, Origin, login, recursive scan, thumbnail, scoped descendants, chặn ảnh ngoài scope, session isolation, favorite idempotency, chốt/mở list, annotation validation, export, ZIP chứa byte ảnh gốc, ticket dùng một lần, thu hồi link và lỗi nguồn không gây xóa hàng loạt.
- `npm run build`: Next.js production build và TypeScript thành công.
- Sharp đã nâng lên 0.35.4; `npm audit` báo 0 lỗ hổng tại thời điểm kiểm tra.
- Triển khai NAS đang được kiểm chứng; trạng thái thực tế xem `docker compose ps`.

Chưa benchmark tải đồng thời trên DS923+, chưa thử file RAW từ máy ảnh thật, chưa kiểm tra proxy HTTPS ngoài NAS.

## NAS thực tế
- 192.168.50.246:8088: API health OK, /admin HTTP 200, admin login HTTP 200.
- 3 container đang chạy; API healthy. Sharp 0.35.4.
- /photos read-only; /data và /cache read-write.
- Kernel không hỗ trợ NanoCPUs: đổi thành cpu_shares. PID limit bị kernel bỏ qua.
- Nguồn hiện là thư mục trống riêng /volume1/docker/nas-photo-proofing/photos; chờ user chọn nguồn ảnh.

