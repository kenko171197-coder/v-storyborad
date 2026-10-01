export const DEFAULT_MODEL = 'gemini-3.8-flash';
export const MODEL_SUGGESTIONS = ['gemini-3.8-flash', 'gemini-3.5-flash'];

const KEY_STORAGE = 'storyboard.apiKey';
const MODEL_STORAGE = 'storyboard.model';

export interface Settings {
  apiKey: string;
  model: string;
  /** true = key được lưu lại trong trình duyệt; false = chỉ giữ trong phiên hiện tại */
  remember: boolean;
}

// localStorage có thể bị chặn (khung nhúng, chế độ riêng tư), nên mọi thao tác đều bọc try/catch.
const read = (k: string): string => {
  try {
    return localStorage.getItem(k) ?? '';
  } catch {
    return '';
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* bỏ qua */
  }
};
const remove = (k: string) => {
  try {
    localStorage.removeItem(k);
  } catch {
    /* bỏ qua */
  }
};

const storedKey = read(KEY_STORAGE);
let current: Settings = {
  apiKey: storedKey,
  model: read(MODEL_STORAGE) || DEFAULT_MODEL,
  remember: storedKey !== '',
};

export const getSettings = (): Settings => ({ ...current });

export function saveSettings(next: Settings): void {
  current = {
    apiKey: next.apiKey.trim(),
    model: next.model.trim() || DEFAULT_MODEL,
    remember: next.remember,
  };
  write(MODEL_STORAGE, current.model);
  if (current.remember && current.apiKey) write(KEY_STORAGE, current.apiKey);
  else remove(KEY_STORAGE);
}

/** Key có sẵn từ Secrets của AI Studio hoặc file .env.local (được Vite nhúng lúc build). */
export const envApiKey = (): string => (process.env.GEMINI_API_KEY as string | undefined) || '';

/** Key đang dùng: key người dùng nhập ưu tiên hơn key trong Secrets. */
export const activeApiKey = (): string => current.apiKey || envApiKey();

export const hasApiKey = (): boolean => activeApiKey() !== '';

export const activeModel = (): string => current.model || DEFAULT_MODEL;

// --- Định dạng tham chiếu trong prompt (gán biến hoặc IMAGE_REF) ---
const FORMAT_STORAGE = 'storyboard.promptFormat';

export const getPromptFormat = (): 'vars' | 'api' => (read(FORMAT_STORAGE) === 'api' ? 'api' : 'vars');

export const savePromptFormat = (format: 'vars' | 'api'): void => write(FORMAT_STORAGE, format);
