import { useEffect, useState } from 'react';
import { X, Eye, EyeOff, Loader2, Check, KeyRound } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { testConnection } from './gemini.ts';
import {
  DEFAULT_MODEL,
  MODEL_SUGGESTIONS,
  envApiKey,
  getSettings,
  saveSettings,
} from './settings.ts';

type TestState = { status: 'idle' | 'testing' | 'ok' | 'fail'; message: string };

const fieldLabel = 'block text-xs font-semibold text-stone-500 mb-1.5';
const fieldBase =
  'w-full bg-stone-50/70 border border-stone-200 rounded-xl px-3.5 py-3 text-base sm:text-sm text-stone-800 outline-none focus:border-gold focus:bg-white transition-colors placeholder:text-stone-300';

export default function SettingsModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [remember, setRemember] = useState(true);
  const [showKey, setShowKey] = useState(false);
  const [test, setTest] = useState<TestState>({ status: 'idle', message: '' });

  // Mỗi lần mở, nạp lại giá trị đang lưu.
  useEffect(() => {
    if (!open) return;
    const s = getSettings();
    setApiKey(s.apiKey);
    setModel(s.model);
    setRemember(s.remember || s.apiKey === '');
    setShowKey(false);
    setTest({ status: 'idle', message: '' });
  }, [open]);

  const hasEnvKey = envApiKey() !== '';

  const handleTest = async () => {
    setTest({ status: 'testing', message: '' });
    try {
      await testConnection(apiKey, model);
      setTest({ status: 'ok', message: 'Kết nối thành công. Key và model dùng được.' });
    } catch (err) {
      const detail = err instanceof Error ? err.message.slice(0, 200) : '';
      setTest({ status: 'fail', message: detail || 'Không kết nối được.' });
    }
  };

  const handleSave = () => {
    saveSettings({ apiKey, model, remember });
    onSaved();
    onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/30 backdrop-blur-sm z-[60]"
          />
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            className="fixed z-[70] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(520px,calc(100vw-32px))] max-h-[calc(100dvh-32px)] overflow-y-auto bg-white rounded-[28px] shadow-2xl p-5 sm:p-7"
          >
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-black rounded-xl flex items-center justify-center">
                  <KeyRound className="text-gold w-4 h-4" />
                </div>
                <h2 className="text-lg font-black tracking-tight">Cài đặt</h2>
              </div>
              <button
                onClick={onClose}
                className="p-2 text-stone-400 hover:text-black hover:bg-stone-50 rounded-xl transition-all"
                title="Đóng"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-5">
              <div>
                <label className={fieldLabel}>Gemini API key</label>
                <div className="relative">
                  <input
                    type={showKey ? 'text' : 'password'}
                    autoComplete="off"
                    spellCheck={false}
                    className={`${fieldBase} pr-11`}
                    placeholder={hasEnvKey ? 'Để trống để dùng key trong Secrets' : 'AIza...'}
                    value={apiKey}
                    onChange={(e) => {
                      setApiKey(e.target.value);
                      setTest({ status: 'idle', message: '' });
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-stone-400 hover:text-stone-700 transition-colors"
                    title={showKey ? 'Ẩn key' : 'Hiện key'}
                  >
                    {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <p className="text-xs text-stone-400 mt-2 leading-relaxed">
                  Lấy key tại aistudio.google.com/apikey. Key nhập ở đây được ưu tiên hơn key trong Secrets
                  {hasEnvKey ? ' (hiện đang có sẵn một key trong Secrets).' : '.'}
                </p>
              </div>

              <label className="flex items-start gap-3 text-sm text-stone-600 cursor-pointer leading-relaxed">
                <input
                  type="checkbox"
                  className="accent-gold w-4 h-4 mt-0.5 shrink-0"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                />
                <span>
                  Nhớ key trên trình duyệt này
                  <span className="block text-xs text-stone-400">
                    Key lưu trong bộ nhớ trình duyệt và chỉ được gửi tới Google. Bỏ chọn nếu đây là máy dùng chung:
                    key sẽ mất khi tải lại trang.
                  </span>
                </span>
              </label>

              <div>
                <label className={fieldLabel}>Model</label>
                <input
                  className={fieldBase}
                  spellCheck={false}
                  value={model}
                  onChange={(e) => {
                    setModel(e.target.value);
                    setTest({ status: 'idle', message: '' });
                  }}
                />
                <div className="flex flex-wrap gap-2 mt-2.5">
                  {MODEL_SUGGESTIONS.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => {
                        setModel(m);
                        setTest({ status: 'idle', message: '' });
                      }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                        model.trim() === m
                          ? 'bg-gold-light text-gold-dark border-gold-light'
                          : 'text-stone-500 border-stone-200 hover:bg-stone-50'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              {test.status !== 'idle' && (
                <div
                  className={`flex items-start gap-2.5 text-[13px] rounded-xl px-3.5 py-2.5 leading-relaxed border ${
                    test.status === 'ok'
                      ? 'bg-emerald-50 text-emerald-800 border-emerald-100'
                      : test.status === 'fail'
                        ? 'bg-red-50 text-red-700 border-red-100'
                        : 'bg-stone-50 text-stone-500 border-stone-100'
                  }`}
                >
                  {test.status === 'testing' && <Loader2 size={14} className="animate-spin shrink-0 mt-0.5" />}
                  {test.status === 'ok' && <Check size={14} className="shrink-0 mt-0.5" />}
                  {test.status === 'fail' && <X size={14} className="shrink-0 mt-0.5" />}
                  <span className="break-words min-w-0">
                    {test.status === 'testing' ? 'Đang kiểm tra...' : test.message}
                  </span>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-6 sm:mt-7">
              <button
                onClick={handleTest}
                disabled={test.status === 'testing'}
                className="py-3.5 bg-white text-black border border-stone-200 rounded-[18px] font-black text-xs uppercase tracking-[0.12em] hover:bg-stone-50 disabled:text-stone-300 transition-all active:scale-[0.98]"
              >
                Kiểm tra kết nối
              </button>
              <button
                onClick={handleSave}
                className="py-3.5 bg-black text-gold rounded-[18px] font-black text-xs uppercase tracking-[0.12em] hover:bg-stone-900 transition-all active:scale-[0.98] border border-gold/20"
              >
                Lưu
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
