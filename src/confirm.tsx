import { useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';

/**
 * Hộp xác nhận vẽ trong app, thay cho window.confirm.
 * Khi app chạy trong khung nhúng (vd. bản xem trước của AI Studio) trình duyệt có thể chặn
 * confirm/alert: confirm() trả về false ngay mà không hiện gì, làm nút bấm "không có tác dụng".
 */
export function useConfirm() {
  const [message, setMessage] = useState<string | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const ask = (text: string) =>
    new Promise<boolean>((resolve) => {
      resolver.current?.(false);
      resolver.current = resolve;
      setMessage(text);
    });

  const close = (ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setMessage(null);
  };

  const dialog = (
    <AnimatePresence>
      {message !== null && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => close(false)}
            className="fixed inset-0 bg-black/30 backdrop-blur-sm z-[80]"
          />
          <motion.div
            role="alertdialog"
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            className="fixed z-[90] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(420px,calc(100vw-32px))] bg-white rounded-[24px] shadow-2xl p-6"
          >
            <p className="text-sm text-stone-700 leading-relaxed">{message}</p>
            <div className="grid grid-cols-2 gap-3 mt-6">
              <button
                onClick={() => close(false)}
                className="py-3 bg-white text-black border border-stone-200 rounded-[16px] font-black text-xs uppercase tracking-[0.12em] hover:bg-stone-50 transition-all"
              >
                Huỷ
              </button>
              <button
                autoFocus
                onClick={() => close(true)}
                className="py-3 bg-black text-gold rounded-[16px] font-black text-xs uppercase tracking-[0.12em] hover:bg-stone-900 transition-all border border-gold/20"
              >
                Đồng ý
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );

  return [ask, dialog] as const;
}
