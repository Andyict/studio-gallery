"use client";
import { useEffect, useState } from "react";
import {
  Save,
  Plus,
  Users,
  Settings,
  FolderOpen,
  ShieldCheck,
  KeyRound,
  Check,
  ArrowLeft,
  Folder,
  ChevronRight,
  RefreshCw,
  Upload,
  Trash2,
  Aperture,
} from "lucide-react";
import { api, json } from "@/lib/api";
import { Modal } from "./Gallery";
import PasswordField from "./PasswordField";
export default function SystemSettings({
  me,
  onSaved,
  initialTab = "general",
}: {
  me: any;
  onSaved: () => void;
  initialTab?: string;
}) {
  const [tab, setTab] = useState("account"),
    [data, setData] = useState<any>(null),
    [users, setUsers] = useState<any[]>([]),
    [audit, setAudit] = useState<any[]>([]),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [savedSettings, setSavedSettings] = useState<any>(null);
  const [edit, setEdit] = useState<any>(null),
    [reset, setReset] = useState<any>(null),
    [newPassword, setNewPassword] = useState(""),
    [currentPassword, setCurrentPassword] = useState("");
  const [directory, setDirectory] = useState<any>(null),
    [sources, setSources] = useState<any[]>([]);
  const [theme, setTheme] = useState("sage");
  async function load() {
    if (me.role === "admin") {
      const [d, u, a, src] = await Promise.all([
        api("/admin/settings"),
        api("/admin/users"),
        api("/admin/audit"),
        api("/admin/sources"),
      ]);
      setData(d);
      setSavedSettings(JSON.stringify(d.settings));
      setUsers(u);
      setAudit(a);
      setSources(src);
    }
  }
  useEffect(() => {
    setTab(me.role === "admin" ? initialTab : "account");
    void load().catch((e) => setError(e.message));
  }, [me.role, initialTab]);
  useEffect(() => {
    const saved = window.localStorage.getItem("studio-theme") || "sage";
    setTheme(saved);
    document.documentElement.dataset.studioTheme = saved;
  }, []);
  function changeTheme(value: string) {
    setTheme(value);
    window.localStorage.setItem("studio-theme", value);
    document.documentElement.dataset.studioTheme = value;
  }
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  function update(k: string, v: any) {
    setData((d: any) => ({ ...d, settings: { ...d.settings, [k]: v } }));
  }
  const s = data?.settings;
  const dirty = Boolean(s && savedSettings && JSON.stringify(s) !== savedSettings);
  const tabs =
    me.role === "admin"
      ? [
          ["general", "Chung"],
          ["defaults", "Quét & chia sẻ"],
          ["source", "Nguồn ảnh"],
          ["users", "Nhân viên"],
          ["account", "Tài khoản của tôi"],
          ["audit", "Nhật ký"],
        ]
      : [["account", "Tài khoản của tôi"]];
  async function save() {
    await api("/admin/settings", json("PUT", s));
    setNotice(
      "Đã lưu. Cài đặt có hiệu lực ngay; mặc định mới áp dụng cho bộ ảnh/link tạo sau này.",
    );
    onSaved();
    await load();
  }
  async function uploadLogo(file: File) {
    if (file.size > 2 * 1024 * 1024) throw new Error("Logo tối đa 2 MB");
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
      throw new Error("Chỉ hỗ trợ PNG, JPG hoặc WebP");
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("Không đọc được file logo"));
      reader.readAsDataURL(file);
    });
    await api("/admin/logo", json("PUT", { dataUrl }));
    await load();
    onSaved();
    setNotice("Đã cập nhật logo studio.");
  }
  return (
    <section className="system-settings">
      <nav className="tabs admin-tabs">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            className={tab === key ? "active" : ""}
            onClick={() => {
              setTab(key);
              setError("");
              setNotice("");
            }}
          >
            {label}
          </button>
        ))}
      </nav>
      {notice && (
        <div className="settings-success" role="status">
          <Check size={17} />
          {notice}
        </div>
      )}
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      {(tab === "general" || tab === "defaults") && s && (
        <form
          className="panel settings-panel"
          onSubmit={(e) => {
            e.preventDefault();
            void action(save);
          }}
        >
          {tab === "general" ? (
            <>
              <h2>Thông tin studio</h2>
              <p className="muted small">
                Logo, tên ứng dụng và lời chào xuất hiện trên giao diện dành cho
                khách.
              </p>
              <div className="theme-picker">
                <div><strong>Phong cách giao diện</strong><small>Chọn màu nền phù hợp với studio.</small></div>
                <div className="theme-options">
                  {[['sage','Sage'],['sand','Sand'],['midnight','Midnight']].map(([value,label]) => <button type="button" key={value} className={theme===value ? 'theme-option active' : 'theme-option'} onClick={() => changeTheme(value)}><span className={`theme-swatch ${value}`} />{label}</button>)}
                </div>
              </div>
              <div className="logo-setting">
                <div className="logo-preview">
                  {data.logoUrl ? (
                    <img src={data.logoUrl} alt="Logo studio" />
                  ) : (
                    <Aperture />
                  )}
                </div>
                <div className="grow">
                  <strong>Logo studio</strong>
                  <small>
                    PNG, JPG hoặc WebP · tối đa 2 MB. Nên dùng ảnh nền trong
                    suốt, tỷ lệ ngang hoặc vuông.
                  </small>
                  <div className="row">
                    <label className="button logo-upload">
                      <Upload size={16} />
                      {data.logoUrl ? "Thay logo" : "Tải logo lên"}
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        disabled={busy}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) void action(() => uploadLogo(file));
                          e.currentTarget.value = "";
                        }}
                      />
                    </label>
                    {data.logoUrl && (
                      <button
                        type="button"
                        className="danger-text"
                        disabled={busy}
                        onClick={() =>
                          void action(async () => {
                            await api("/admin/logo", { method: "DELETE" });
                            await load();
                            onSaved();
                            setNotice("Đã xóa logo studio.");
                          })
                        }
                      >
                        <Trash2 size={15} />
                        Xóa logo
                      </button>
                    )}
                  </div>
                </div>
              </div>
              <label>
                Tên ứng dụng
                <input
                  required
                  maxLength={100}
                  value={s.brand}
                  onChange={(e) => update("brand", e.target.value)}
                />
              </label>
              <label>
                Tên studio
                <input
                  maxLength={120}
                  value={s.studioName}
                  onChange={(e) => update("studioName", e.target.value)}
                />
              </label>
              <label>
                Email liên hệ
                <input
                  type="email"
                  value={s.contactEmail}
                  onChange={(e) => update("contactEmail", e.target.value)}
                />
              </label>
              <label>
                Lời chào trên gallery
                <textarea
                  maxLength={300}
                  value={s.welcomeMessage}
                  onChange={(e) => update("welcomeMessage", e.target.value)}
                />
              </label>
              <label>
                Thời hạn phiên đăng nhập quản trị/nhân viên (giờ)
                <input
                  type="number"
                  min={1}
                  max={72}
                  required
                  value={s.adminSessionHours}
                  onChange={(e) =>
                    update("adminSessionHours", Number(e.target.value))
                  }
                />
              </label>
              <small className="muted">
                Áp dụng cho lần đăng nhập tiếp theo.
              </small>
            </>
          ) : (
            <>
              <h2>Mặc định cho bộ ảnh mới</h2>
              <label>
                Lịch quét cron
                <input
                  type="time"
                  value={(() => { const m = String(s.defaultCron || "").match(/^(\d{1,2})\s+(\d{1,2})\s+\*/); return m ? `${String(Number(m[2])).padStart(2,"0")}:${String(Number(m[1])).padStart(2,"0")}` : ""; })()}
                  onChange={(e) => { const [hour, minute] = e.target.value.split(":"); update("defaultCron", `${Number(minute)} ${Number(hour)} * * *`); }}
                />
              </label>
              <small className="muted">
                Chọn giờ chạy quét tự động mỗi ngày. Để trống nếu chỉ muốn đồng bộ thủ công.
              </small>
              <label>
                Múi giờ
                <input
                  required
                  value={s.defaultTimezone}
                  onChange={(e) => update("defaultTimezone", e.target.value)}
                />
              </label>
              <label>
                Link hết hạn sau (ngày)
                <input
                  type="number"
                  min={0}
                  max={365}
                  required
                  value={s.defaultExpiryDays}
                  onChange={(e) =>
                    update("defaultExpiryDays", Number(e.target.value))
                  }
                />
              </label>
              <small className="muted">0 = không đặt hạn dùng mặc định.</small>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={s.defaultDownloads}
                  onChange={(e) => {
                    update("defaultDownloads", e.target.checked);
                    if (!e.target.checked) update("defaultOriginals", false);
                  }}
                />
                Cho tải preview mặc định
              </label>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={s.defaultOriginals}
                  disabled={!s.defaultDownloads}
                  onChange={(e) => update("defaultOriginals", e.target.checked)}
                />
                Cho tải file gốc mặc định
              </label>
              <h3 className="settings-subtitle">Tải ZIP</h3>
              <label>
                Số ảnh tối đa mỗi lượt ZIP
                <input
                  type="number"
                  required
                  min={1}
                  max={10000}
                  value={s.maxZipFiles}
                  onChange={(e) =>
                    update("maxZipFiles", Number(e.target.value))
                  }
                />
              </label>
              <label>
                Số lượt tải đồng thời
                <input
                  type="number"
                  required
                  min={1}
                  max={4}
                  value={s.maxDownloads}
                  onChange={(e) =>
                    update("maxDownloads", Number(e.target.value))
                  }
                />
              </label>
            </>
          )}
          <button className="primary" disabled={busy || !dirty}>
            <Save size={17} />
            Lưu cài đặt
          </button>
        </form>
      )}
      {tab === "source" && data && (
        <section className="panel settings-panel">
          <div className="panel-title">
            <h2>Nguồn ảnh NAS</h2>
            <span className="pill">
              {data.source.connected
                ? "Đã kết nối read-only"
                : "Không truy cập được"}
            </span>
          </div>
          <p className="muted">
            Bật thư mục Studio một lần. Hệ thống nhận các thư mục nhóm như Ảnh
            cưới, Du lịch và tạo album từ thư mục con; các thư mục sâu hơn vẫn
            được giữ nguyên bên trong album.
          </p>
          <div className="source-path">
            {data.source.hostPath || data.source.path}
          </div>
          <h3 className="settings-subtitle">Thư mục Studio đã cấp quyền</h3>
          {sources.length ? (
            <div className="source-list">
              {sources.map((source) => (
                <div className="source-row" key={source.id}>
                  <div className="grow">
                    <strong>{source.label}</strong>
                    <small>/{source.relative_path || ""}</small>
                  </div>
                  <span className={`tag ${source.enabled ? "green" : ""}`}>
                    {source.enabled ? "Đang bật" : "Đã tắt"}
                  </span>
                  {source.enabled && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        void action(async () => {
                          const result = await api(
                            `/admin/sources/${source.id}/discover`,
                            json("POST", {}),
                          );
                          setNotice(
                            `Đã tìm ${result.found} thư mục: tạo ${result.created} album mới, ${result.existing} album đã có.`,
                          );
                        })
                      }
                    >
                      <RefreshCw size={15} />
                      Quét tạo album
                    </button>
                  )}
                  <button
                    disabled={busy}
                    onClick={() =>
                      void action(async () => {
                        await api(
                          `/admin/sources/${source.id}`,
                          json("PATCH", {
                            label: source.label,
                            enabled: !source.enabled,
                          }),
                        );
                        await load();
                      })
                    }
                  >
                    {source.enabled ? "Tắt" : "Bật"}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted small">Chưa bật thư mục nào.</p>
          )}
          <button
            className="primary"
            disabled={busy}
            onClick={() =>
              void action(async () =>
                setDirectory(await api("/admin/directories")),
              )
            }
          >
            <FolderOpen size={16} />
            Chọn thư mục Studio
          </button>
          {directory && (
            <div className="directory-browser source-browser">
              <div className="directory-path">
                <button
                  aria-label="Thư mục cha"
                  disabled={!directory.path || busy}
                  onClick={() =>
                    void action(async () =>
                      setDirectory(
                        await api(
                          `/admin/directories?path=${encodeURIComponent(directory.path.split("/").slice(0, -1).join("/"))}`,
                        ),
                      ),
                    )
                  }
                >
                  <ArrowLeft size={16} />
                </button>
                <code>/{directory.path}</code>
              </div>
              <button
                className="approve-source"
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    await api(
                      "/admin/sources",
                      json("POST", {
                        relative_path: directory.path,
                        label: directory.path.split("/").pop() || s.sourceLabel,
                      }),
                    );
                    await load();
                    setNotice("Đã bật nguồn Studio. Hãy bấm Quét tạo album.");
                  })
                }
              >
                <ShieldCheck size={16} />
                Bật nguồn Studio này
              </button>
              {directory.folders.map((d: any) => (
                <button
                  className="directory-item"
                  key={d.path}
                  disabled={busy}
                  onClick={() =>
                    void action(async () =>
                      setDirectory(
                        await api(
                          `/admin/directories?path=${encodeURIComponent(d.path)}`,
                        ),
                      ),
                    )
                  }
                >
                  <Folder size={16} />
                  {d.name}
                  <ChevronRight size={15} />
                </button>
              ))}
              {!directory.folders.length && (
                <p className="muted small">
                  Không có thư mục con. Bạn vẫn có thể bật quyền thư mục hiện
                  tại.
                </p>
              )}
            </div>
          )}
          <p className="muted small">
            Muốn truy cập shared folder khác ngoài mount hiện tại, cần thêm
            volume read-only trong Docker Compose một lần.
          </p>
        </section>
      )}
      {tab === "users" && (
        <section className="panel">
          <div className="panel-title">
            <h2>Tài khoản nhân viên</h2>
            <button
              className="primary"
              onClick={() =>
                setEdit({
                  username: "",
                  name: "",
                  role: "staff",
                  password: "",
                  disabled: false,
                })
              }
            >
              <Plus size={17} />
              Tạo tài khoản
            </button>
          </div>
          <p className="muted small">
            Quản trị viên có toàn quyền. Nhân viên được xem và quản lý tất cả bộ
            ảnh, link, lựa chọn và ghi chú; không được sửa hệ thống hay quản lý
            người dùng.
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Nhân viên</th>
                  <th>Tên đăng nhập</th>
                  <th>Vai trò</th>
                  <th>Trạng thái</th>
                  <th>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>{u.name}</td>
                    <td>{u.username}</td>
                    <td>
                      {u.role === "admin" ? "Quản trị viên" : "Nhân viên"}
                    </td>
                    <td>{u.disabled ? "Đã khóa" : "Hoạt động"}</td>
                    <td>
                      <div className="row">
                        <button
                          disabled={busy}
                          onClick={() => setEdit({ ...u })}
                        >
                          Chỉnh sửa
                        </button>
                        {u.id !== me.id && (
                          <button
                            disabled={busy}
                            onClick={() => {
                              setReset(u);
                              setNewPassword("");
                            }}
                          >
                            Đặt lại mật khẩu
                          </button>
                        )}
                        {u.id === me.id && (
                          <button
                            disabled={busy}
                            onClick={() => setTab("account")}
                          >
                            Đổi mật khẩu
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {tab === "account" && (
        <form
          className="panel settings-panel"
          onSubmit={(e) => {
            e.preventDefault();
            void action(async () => {
              await api(
                "/admin/account/password",
                json("POST", { currentPassword, password: newPassword }),
              );
              setCurrentPassword("");
              setNewPassword("");
              setNotice("Đã đổi mật khẩu và đăng xuất các phiên khác.");
            });
          }}
        >
          <h2>Tài khoản của tôi</h2>
          <p className="muted">
            {me.name} · {me.username} ·{" "}
            {me.role === "admin" ? "Quản trị viên" : "Nhân viên"}
          </p>
          <label>
            Mật khẩu hiện tại
            <PasswordField
              type="password"
              autoComplete="current-password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </label>
          <label>
            Mật khẩu mới (tối thiểu 8 ký tự)
            <PasswordField
              type="password"
              autoComplete="new-password"
              minLength={8}
              maxLength={256}
              required
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </label>
          <button className="primary" disabled={busy}>
            <KeyRound size={17} />
            Đổi mật khẩu
          </button>
        </form>
      )}
      {tab === "audit" && (
        <section className="panel">
          <h2>Nhật ký cài đặt & tài khoản</h2>
          <p className="muted small">
            100 thao tác gần nhất. Không lưu mật khẩu vào nhật ký.
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Thời gian UTC</th>
                  <th>Tài khoản</th>
                  <th>Thao tác</th>
                  <th>Đối tượng</th>
                </tr>
              </thead>
              <tbody>
                {audit.map((a) => (
                  <tr key={a.id}>
                    <td>{a.created_at}</td>
                    <td>{a.username || "—"}</td>
                    <td>
                      {(
                        {
                          "settings.update": "Đổi cài đặt",
                          "user.create": "Tạo tài khoản",
                          "user.update": "Sửa tài khoản",
                          "user.password_reset": "Đặt lại mật khẩu",
                          "account.password_change": "Đổi mật khẩu cá nhân",
                        } as any
                      )[a.action] || a.action}
                    </td>
                    <td>
                      {users.find((u) => u.id === a.target)?.username ||
                        a.target ||
                        "Hệ thống"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!audit.length && <p className="muted">Chưa có thao tác.</p>}
        </section>
      )}
      {edit && (
        <Modal
          title={edit.id ? "Chỉnh sửa nhân viên" : "Tạo tài khoản nhân viên"}
          close={() => setEdit(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void action(async () => {
                if (edit.id)
                  await api(
                    `/admin/users/${edit.id}`,
                    json("PATCH", {
                      name: edit.name,
                      role: edit.role,
                      disabled: edit.disabled,
                    }),
                  );
                else
                  await api(
                    "/admin/users",
                    json("POST", {
                      username: edit.username,
                      name: edit.name,
                      role: edit.role,
                      password: edit.password,
                    }),
                  );
                setEdit(null);
                await load();
                setNotice("Đã lưu tài khoản");
              });
            }}
          >
            <label>
              Họ tên
              <input
                required
                maxLength={100}
                value={edit.name}
                onChange={(e) => setEdit({ ...edit, name: e.target.value })}
              />
            </label>
            <label>
              Tên đăng nhập
              <input
                required
                disabled={!!edit.id}
                pattern="[a-z0-9][a-z0-9._\-]{2,39}"
                title="3–40 ký tự: chữ thường, số, dấu chấm, gạch ngang hoặc gạch dưới"
                value={edit.username}
                onChange={(e) =>
                  setEdit({ ...edit, username: e.target.value.toLowerCase() })
                }
              />
            </label>
            {!edit.id && (
              <label>
                Mật khẩu ban đầu
                <PasswordField
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  maxLength={256}
                  value={edit.password}
                  onChange={(e) =>
                    setEdit({ ...edit, password: e.target.value })
                  }
                />
              </label>
            )}
            <label>
              Vai trò
              <select
                value={edit.role}
                disabled={edit.id === me.id}
                onChange={(e) => setEdit({ ...edit, role: e.target.value })}
              >
                <option value="staff">Nhân viên — quản lý các bộ ảnh</option>
                <option value="admin">Quản trị viên — toàn quyền</option>
              </select>
            </label>
            {edit.id && (
              <label className="check-label">
                <input
                  type="checkbox"
                  disabled={edit.id === me.id}
                  checked={edit.disabled}
                  onChange={(e) =>
                    setEdit({ ...edit, disabled: e.target.checked })
                  }
                />
                Khóa tài khoản (đăng xuất mọi phiên)
              </label>
            )}
            <button className="primary wide" disabled={busy}>
              Lưu tài khoản
            </button>
          </form>
          {error && <p className="alert">{error}</p>}
        </Modal>
      )}
      {reset && (
        <Modal
          title={`Đặt lại mật khẩu: ${reset.username}`}
          close={() => setReset(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void action(async () => {
                await api(
                  `/admin/users/${reset.id}/password`,
                  json("POST", { password: newPassword }),
                );
                setReset(null);
                setNewPassword("");
                await load();
                setNotice("Đã đặt lại mật khẩu. Nhân viên cần đăng nhập lại.");
              });
            }}
          >
            <label>
              Mật khẩu mới
              <PasswordField
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                maxLength={256}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </label>
            <button className="primary wide" disabled={busy}>
              Đặt lại & đăng xuất các phiên
            </button>
          </form>
          {error && <p className="alert">{error}</p>}
        </Modal>
      )}
    </section>
  );
}
