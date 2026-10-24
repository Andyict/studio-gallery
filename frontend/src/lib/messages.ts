export type Message = {
  id: string; seq: number; photo_id: string | null; filename: string | null; x: number | null; y: number | null;
  author_role: "client" | "staff"; author_name: string; body: string; resolved: boolean; created_at: string; mine: boolean;
};
export type Unread = { total: number; chat: number; photos: Record<string, number> };

// Adds messages by seq, ignoring ones already shown: a sent message can arrive both as the POST
// response and through the realtime refetch, in either order.
export const mergeMessages = (current: Message[], incoming: Message[]) => {
  const known = new Set(current.map(m => m.seq));
  const fresh = incoming.filter(m => !known.has(m.seq));
  return fresh.length ? [...current, ...fresh].sort((a, b) => a.seq - b.seq) : current;
};

export const messageTime = (value: string) =>
  new Date(value.includes("T") ? value : value.replace(" ", "T") + "Z")
    .toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });

// Customer photo notes that carry a pin, numbered in posting order like the pins on the image.
export const pinNumbers = (messages: Message[]) => {
  const numbers = new Map<string, number>();
  for (const m of messages) if (m.author_role === "client" && m.x != null && m.y != null) numbers.set(m.id, numbers.size + 1);
  return numbers;
};
