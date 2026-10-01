/**
 * Tự lưu bản nháp đang làm vào IndexedDB của trình duyệt, để trang bị tải lại
 * (Vite mất kết nối rồi tự reload, điện thoại đóng tab chạy nền, lỡ bấm F5...) không làm mất dữ liệu.
 * Dùng IndexedDB thay cho localStorage vì ảnh tham chiếu (base64) dễ vượt giới hạn ~5MB của localStorage.
 */
const DB_NAME = 'storyboard';
const STORE = 'kv';
const DRAFT_KEY = 'draft';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    dbPromise.catch(() => {
      dbPromise = null;
    });
  }
  return dbPromise;
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const req = fn(db.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error);
      }),
  );
}

export async function loadDraft<T>(): Promise<T | null> {
  try {
    return (await run<T | undefined>('readonly', (s) => s.get(DRAFT_KEY))) ?? null;
  } catch (err) {
    console.warn('Không đọc được bản nháp đã lưu:', err);
    return null;
  }
}

export async function saveDraft(draft: unknown): Promise<void> {
  try {
    await run('readwrite', (s) => s.put(draft, DRAFT_KEY));
  } catch (err) {
    console.warn('Không lưu được bản nháp:', err);
  }
}

export async function clearDraft(): Promise<void> {
  try {
    await run('readwrite', (s) => s.delete(DRAFT_KEY));
  } catch {
    /* bỏ qua */
  }
}
