# Studio Gallery — tên tạm

Ứng dụng client photo proofing self-hosted, đọc ảnh trực tiếp từ thư mục NAS. Đổi tên qua `APP_NAME` trong `.env`; không cần thay database hoặc URL gallery.

## Đã có

- Admin chọn thư mục trong nguồn được mount; scan đệ quy thủ công hoặc cron có timezone.
- SQLite WAL, queue preview bền vững, resume queue sau restart, retry lỗi tối đa 3 lần.
- Gallery Next.js/Tailwind mobile-first, masonry, tabs, tìm file, lightbox, phím trái/phải/Escape.
- Trang chủ studio cho khách chỉ nhập số điện thoại; Manager ở `/manager`. Nếu một số có nhiều album hoạt động, portal mở quyền được tạo gần nhất; album cũ dùng link riêng.
- Link tổng hoặc scoped theo nhiều nhánh, PIN/password scrypt có salt, hết hạn và thu hồi.
- Phiên khách bằng cookie HttpOnly; nhiều list yêu thích, chốt/mở lại lựa chọn.
- Annotation tọa độ chuẩn hóa trên preview đã auto-orient; editor đánh dấu đã xử lý, export CSV.
- Export tên file bỏ đuôi, loại trùng cho workflow Lightroom/Bridge.
- Trái tim tạo danh sách yêu thích gửi studio; dấu tích là lựa chọn tải tạm thời độc lập. Có tải ảnh tích chọn, toàn tab hoặc toàn bộ phạm vi được cấp.
- ZIP file gốc hoặc preview, tải cả thư mục hoặc list; truyền trực tiếp, không ZIP tạm.
- Root read-only, chặn traversal/symlink, kiểm tra quyền với mọi media và ZIP ticket.
- Bộ Compose giới hạn tài nguyên, user không root, healthcheck và log rotation.

## Chạy trên Synology DS923+

1. Chép thư mục dự án vào `/volume1/docker/nas-photo-proofing`.
2. Tạo sẵn các thư mục `data` và `cache` bằng File Station. Chọn user NAS có quyền đọc thư mục ảnh và quyền ghi hai thư mục này. Kiểm tra UID/GID bằng `id ten_user` qua SSH; đặt `PUID`, `PGID` tương ứng. Không cấp quyền ghi ảnh gốc cho app.
3. Sao chép `.env.example` thành `.env`. Sửa `PHOTO_SOURCE`, `DATA_PATH`, `CACHE_PATH`, `PUBLIC_ORIGIN`. Có thể để trống `ADMIN_PASSWORD` để tạo quản trị viên lần đầu ngay trên web, hoặc đặt mật khẩu tối thiểu 8 ký tự để khởi tạo tự động. Đổi `APP_NAME` khi có tên chính thức.
4. Trong Container Manager → Project, tạo project từ thư mục này, hoặc chạy:

```sh
docker compose config --quiet
docker compose up -d --build
docker compose logs --tail=100 api
```

5. Mở `PUBLIC_ORIGIN/manager`. Nếu chưa có tài khoản, cửa sổ thiết lập sẽ yêu cầu tạo quản trị viên đầu tiên rồi tự đăng nhập. Nếu đã khai báo `ADMIN_PASSWORD`, đăng nhập bằng tên `admin` và mật khẩu đó.
6. Tạo link, chọn phạm vi/thời hạn/quyền tải, sao chép URL được hiển thị một lần và gửi cho khách.

Để dùng domain HTTPS: cấu hình Synology Reverse Proxy trỏ về cổng `HTTP_PORT`, đặt `PUBLIC_ORIGIN=https://gallery.example.com` rồi `docker compose up -d`. HTTPS bật cookie Secure. Origin phải khớp chính xác địa chỉ người dùng mở (gồm port nếu có). Không cần mở cổng API 3211 hoặc Next.js 3210 ra ngoài.

Nginx bên trong đã tắt buffering/cache cho `/api/` và `proxy_max_temp_file_size 0`. Nếu đặt thêm proxy Synology phía ngoài, cũng cần tắt response buffering và cache cho endpoint download, đặt timeout đủ dài; nếu proxy ngoài vẫn buffer, không thể bảo đảm toàn tuyến không ghi ZIP tạm. Không ghi access log chứa URL chia sẻ bí mật.

Giới hạn runtime được khai báo: API 1 GB, web 512 MB, proxy 64 MB; đây là cấu hình giới hạn, không phải số đo benchmark. Lần build Next.js dùng RAM riêng của build, có thể build trên máy khác rồi chuyển image vào NAS.

## Phát triển và kiểm thử

Node.js 24 trở lên. Chạy từ thư mục gốc dự án:

```sh
npm ci
npm test
npm run build
```

Biến môi trường local: `ADMIN_PASSWORD`, `PHOTO_ROOT`, `DATA_DIR`, `CACHE_DIR`, `PUBLIC_ORIGIN=http://localhost:3210`. Đường dẫn môi trường nên là absolute. Sau đó mở hai terminal:

```sh
npm run dev:api
npm run dev:web
```

API chạy 3211, web 3210. Next.js proxy `/api` về API trong local development; production Nginx route thẳng vào API để ZIP không đi qua Next.js.

`npm run demo` tạo bộ ảnh minh họa hình học do script vẽ (không phải ảnh khách), database và link demo trong `.runtime`. Script chỉ chạy khi database demo chưa tồn tại và yêu cầu `ADMIN_PASSWORD` do người chạy đặt. Không triển khai dữ liệu demo thành dữ liệu thật.

## Nguồn ảnh và RAW

- Hỗ trợ scan JPG/JPEG/PNG/WebP/TIFF/HEIC/AVIF và CR2/CR3/NEF/ARW/DNG/RAF/ORF/RW2.
- JPG và các định dạng mà build Sharp hỗ trợ được tạo WebP bằng libvips; metadata nguồn/GPS không chép sang preview.
- Với RAW, worker dùng ExifTool lấy `JpgFromRaw`, sau đó thử `PreviewImage`. Đây là preview do máy ảnh nhúng, không phải full RAW develop. RAW không có JPEG nhúng hợp lệ sẽ báo lỗi; cung cấp JPG cùng thư mục để duyệt. HEIC/TIFF đặc biệt cũng phụ thuộc codec, không cam kết tất cả camera.
- RAW gốc vẫn tải được khi link có quyền, kể cả không tạo được preview. RAW và JPG cùng stem là hai ảnh riêng; export stem loại trùng.
- Một worker xử lý preview tuần tự, libvips concurrency=1/cache 64 MB. Preview tối đa 2048 px, thumb tối đa 480×720, không upscale.
- App không ghi rating/XMP lên nguồn và không xóa file nguồn. Đổi tên/di chuyển được coi là mất ảnh cũ + ảnh mới. Size/mtime phát hiện thay đổi, chưa có checksum định kỳ.
- Copy ảnh lớn xong rồi mới sync, hoặc copy vào thư mục tạm ngoài project rồi rename. Tránh thay đổi file trong khi khách tải ZIP.

## Quyền và danh sách

Scoped folder bao gồm các thư mục con. Root folder được chọn làm scope có nghĩa là toàn project; root tab trong gallery chỉ hiển thị ảnh trực tiếp trong root. Mỗi trình duyệt/link có một phiên khách, tên hiển thị không phải danh tính xác thực. Thiết bị khác có list riêng; cùng trình duyệt mở link khác sẽ chuyển phiên đang dùng. Chưa có phục hồi list xuyên thiết bị.

Chốt list khóa thay đổi tim; khách có thể mở lại. Admin xem trạng thái và export. Link thu hồi chặn request tiếp theo và ticket chưa bắt đầu; stream đã bắt đầu không bị cắt giữa chừng khi thu hồi.

## ZIP streaming

POST tạo ticket gắn session và manifest ID/version, hết hạn sau 2 phút. GET ticket kiểm tra quyền lại, preflight nguồn, mở từng file theo yêu cầu của yazl rồi stream HTTP với backpressure. Dùng ZIP Store vì ảnh vốn đã nén; ZIP64 được thư viện xử lý. Giới hạn 2 lượt song song và 2.000 ảnh/lượt, metadata dùng RAM tỷ lệ số ảnh, không tỷ lệ tổng byte. UI điều hướng trực tiếp tới URL tải, không dùng `fetch().blob()`.

Nguồn thay đổi trước stream trả lỗi. Lỗi I/O giữa stream làm ZIP không hoàn chỉnh; cần tải lại, không hỗ trợ resume/Range. Preview download là WebP, original download giữ nguyên file và cây thư mục. Ticket chỉ dùng một lần.

## Backup / phục hồi

```sh
docker compose exec api node backup.mjs
```

Backup nhất quán tạo tại `DATA_PATH/backups/`. Không chỉ copy `gallery.sqlite` khi app đang chạy WAL. Đặt lịch lệnh trên bằng Synology Task Scheduler nếu cần, và giữ bản sao trên thiết bị khác. Để phục hồi: dừng Compose, giữ nguyên bản data cũ trong thư mục riêng, đặt database backup thành `data/gallery.sqlite` trong thư mục data sạch (không mang WAL/SHM cũ), khôi phục quyền user, rồi khởi động. Cache có thể tái tạo, còn database chứa lựa chọn và ghi chú cần backup.

Cache chưa có quota/LRU tự động. File cache cũ có thể tích lũy khi thay ảnh: theo dõi dung lượng. Không xóa cache đang sử dụng. Với cache bị mất, dùng scan/retry theo hướng dẫn kiểm tra trạng thái; có thể rebuild bằng lệnh maintenance ở bản sau.

## Phạm vi hiện tại

Đây là bản đầu chạy được để kiểm thử workflow studio. Chưa có full RAW developer, email, phục hồi phiên xuyên thiết bị, watermark, quota cache, xử lý video hay gộp RAW+JPG. Không có dịch vụ SaaS, AI nhận diện mặt hoặc analytics ngoài ứng dụng.

Xem [tài liệu tham khảo](docs/RESEARCH.md), [API](docs/API.md) và [kết quả kiểm thử](docs/VALIDATION.md). Cần chạy smoke test Compose trên NAS thật và thử bộ RAW của máy ảnh studio trước khi đưa link cho khách.


## Cài đặt & nhân viên (v0.2)

### Luồng quản lý album Studio

1. Quản trị viên bật một **nguồn Studio** trong `Cài đặt & nhân viên → Nguồn ảnh`.
2. **Quét tạo album** đọc các thư mục con cấp 1; mỗi thư mục trở thành một album khách. Quét lại chỉ tạo album mới, không xóa lựa chọn hoặc ghi chú cũ.
3. Trong từng album, **Khách & chia sẻ** gắn số điện thoại, tạo link bí mật, giới hạn thư mục và quyền tải.
4. **Ảnh khách yêu thích** hiển thị danh sách đang chọn/đã chốt, thumbnail, Search String và CSV cho Lightroom/Bridge.
5. **Ghi chú chỉnh sửa** gom pinpoint annotation theo album và cho nhân viên đánh dấu đã xử lý.

Trang **Tổng quan album** cho biết số quyền khách còn hiệu lực, ảnh đã tim, danh sách đã chốt và ghi chú còn mở.

Trong sidebar chọn **Cài đặt & nhân viên** (trên mobile có nút riêng). Cài đặt lưu SQLite: tên ứng dụng/studio, email, lời chào, tên nguồn ảnh, cron và timezone mặc định, quyền tải/hạn link mặc định, giới hạn ZIP, thời hạn phiên đăng nhập.

Trong **Nguồn ảnh**, quản trị viên duyệt cây thư mục đã mount và bật quyền cho từng nhánh. Chỉ nhánh đã bật mới được dùng tạo bộ ảnh. Việc thêm shared folder nằm ngoài mount hiện tại vẫn thực hiện một lần trong Docker Compose với `read_only: true`.

Nếu `ADMIN_PASSWORD` để trống, trang Manager hiển thị cửa sổ tạo quản trị viên đầu tiên. API khóa chức năng này ngay sau khi tài khoản được tạo. Nếu có `ADMIN_PASSWORD`, tài khoản `admin` được khởi tạo một lần như trước. Sau khi đổi mật khẩu trong giao diện, biến môi trường không ghi đè mật khẩu mới. Không đổi hoặc xóa database để khôi phục tài khoản.

Quản trị viên tạo tài khoản admin/staff, sửa tên/vai trò, khóa, đặt lại mật khẩu và xem nhật ký. Nhân viên quản lý tất cả project và tự đổi mật khẩu, không truy cập Settings/Users/Audit. Khóa/đổi quyền/reset mật khẩu thu hồi phiên. Không cho tự khóa/hạ quyền và giữ ít nhất một admin hoạt động. Chưa có phân công project theo nhân viên.

Nguồn ảnh hiển thị đường dẫn mount và cho duyệt trực quan. Thêm nguồn ngoài mount vẫn cần thay Compose; không mount Docker socket vào app. Cài đặt nguồn không tự cấp quyền đọc file ngoài root.

### Ảnh và video
- Ảnh phổ biến: JPG/JPEG/JFIF, PNG/APNG, WebP, TIFF, AVIF, GIF, BMP, HEIC/HEIF, ICO/ICNS, QOI.
- Ảnh đồ họa/chuyên dụng: PSD/PSB, JPEG 2000, OpenEXR/HDR, DPX/Cineon, DDS, TGA, SGI, PCX và Netpbm. Sharp/libvips xử lý trước; FFmpeg tự làm bộ giải mã dự phòng. Ảnh động dùng khung đầu làm preview tĩnh.
- RAW máy ảnh: 3FR, ARW, CR2/CR3/CRW, DNG, ERF, GPR, IIQ, KDC, MEF, MOS, MRW, NEF/NRW, ORF, PEF, RAF, RAW, RWL, RW2, SR2/SRF/SRW, X3F và các biến thể được liệt kê trong `media.mjs`. Preview RAW cần JPEG nhúng mà ExifTool đọc được; file không có preview vẫn có thể tải gốc nếu được cấp quyền.
- Video phổ biến/chuyên nghiệp/cũ: MP4/MOV/M4V, WebM/MKV, AVI/DivX/DV, MTS/M2TS/TS, MPEG/VOB, MXF, FLV/F4V, 3GP/3G2, WMV/ASF, OGV, RM/RMVB, MOD/TOD, MJPEG, H.264/HEVC và Y4M. Khả năng đọc codec cụ thể phụ thuộc bản FFmpeg.
- FFmpeg tạo bản MP4 H.264/AAC tối đa 1280px và poster WebP. Một job chạy mỗi lần, giới hạn 1 luồng encode và 30 phút/job để giữ NAS ổn định. Video dài có thể cần tăng giới hạn trong `media.mjs`.
- Bản MP4 được lưu cache để xem/tua và đưa vào ZIP bản xem. ZIP vẫn stream trực tiếp, không tạo ZIP tạm. Tải gốc giữ đúng định dạng nguồn và kiểm tra quyền originals.
- HEIC/HEIF cần Sharp/libvips có decoder HEVC; bản Sharp dựng sẵn không đảm bảo hỗ trợ mọi HEIC. File không giải mã được hiển thị lỗi preview; không tự chuyển thành ảnh hỏng.
- Local cần FFmpeg trong PATH hoặc biến FFMPEG trỏ tới executable. Windows preview có thể dùng .runtime/media-tools/node_modules/ffmpeg-static/ffmpeg.exe. Docker đã cài FFmpeg.
- Kiểm tra media: đặt FFMPEG nếu chưa trong PATH, rồi chạy npm test. Test tạo MOV thật, GIF, kiểm tra scan, encode, Range, ZIP và thu hồi quyền.
