import { useState } from 'react';
import { ChevronDown, Loader2, Lock, Sparkles, Trash2, Flag, CopyCheck } from 'lucide-react';
import { activeBible, hasBibleContent } from './assemble.ts';
import type { Character, EndState, SceneBible } from './types.ts';

const fieldLabel = 'block text-[11px] font-semibold text-stone-400 mb-1';
const fieldBase =
  'w-full bg-stone-50/70 border border-stone-100 rounded-xl px-3 py-2.5 sm:py-2 text-base sm:text-sm text-stone-700 outline-none focus:border-gold focus:bg-white transition-colors placeholder:text-stone-300';
const smallButton =
  'flex-1 py-2.5 px-3 rounded-xl border border-stone-200 text-xs font-bold text-stone-600 hover:bg-gold-light hover:text-gold-dark hover:border-gold-light disabled:text-stone-300 disabled:hover:bg-transparent disabled:hover:border-stone-200 transition-colors flex items-center justify-center gap-1.5';


// ---------------------------------------------------------------------------
// Hồ sơ cảnh
// ---------------------------------------------------------------------------
export function SceneBibleCard({
  bible,
  refs,
  drafting,
  canTakeFromResult,
  onChange,
  onDraft,
  onTakeFromResult,
  onClear,
}: {
  bible: SceneBible;
  /** Tham chiếu có ảnh */
  refs: Character[];
  drafting: boolean;
  canTakeFromResult: boolean;
  onChange: (patch: Partial<SceneBible>) => void;
  onDraft: () => void;
  onTakeFromResult: () => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const active = !!activeBible(bible);
  const filled = hasBibleContent(bible);

  return (
    <section className="bg-white p-5 sm:p-6 rounded-[28px] border border-stone-200/60 shadow-sm">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between gap-3 text-left">
        <div className="flex items-center gap-2.5 min-w-0">
          <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-stone-400">Hồ sơ cảnh</h2>
          <span
            className={`flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold ${
              active ? 'bg-gold-light text-gold-dark' : 'bg-stone-100 text-stone-400'
            }`}
          >
            {active && <Lock size={10} />}
            {active ? 'Đang khoá' : filled ? 'Đang tắt' : 'Chưa có'}
          </span>
        </div>
        <ChevronDown size={16} className={`text-stone-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="mt-4 space-y-4">
          <p className="text-xs text-stone-400 leading-relaxed">
            Viết một lần cho cả cảnh. Khi khoá, mọi beat dùng nguyên văn phong cách, bối cảnh, hướng nhân vật và mô tả
            tham chiếu dưới đây, AI không viết lại. Viết bằng tiếng Anh, gọi tham chiếu bằng @tên.
          </p>

          <div className="flex gap-2">
            <button onClick={onDraft} disabled={drafting} className={smallButton}>
              {drafting ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
              AI viết nháp
            </button>
            <button
              onClick={onTakeFromResult}
              disabled={!canTakeFromResult}
              className={smallButton}
              title="Lấy phong cách và mô tả tham chiếu của beat đang xem"
            >
              <CopyCheck size={13} />
              Lấy từ beat đang xem
            </button>
          </div>

          <label className="flex items-center gap-3 text-sm font-bold text-stone-600 cursor-pointer">
            <input
              type="checkbox"
              className="accent-gold w-4 h-4"
              checked={bible.enabled}
              onChange={(e) => onChange({ enabled: e.target.checked })}
            />
            Khoá cho mọi beat
          </label>

          <div>
            <label className={fieldLabel}>Phong cách (nét vẽ, màu, ánh sáng, ống kính)</label>
            <textarea
              className={`${fieldBase} h-24 resize-none`}
              placeholder="3D animated film look, soft global illumination, warm afternoon light..."
              value={bible.style}
              onChange={(e) => onChange({ style: e.target.value })}
            />
          </div>
          <div>
            <label className={fieldLabel}>Bối cảnh (bố trí trái, phải, phía sau, nguồn sáng)</label>
            <textarea
              className={`${fieldBase} h-24 resize-none`}
              placeholder="A small kitchen: wooden table in the centre, window on the back wall, fridge on the left..."
              value={bible.location}
              onChange={(e) => onChange({ location: e.target.value })}
            />
          </div>
          <div>
            <label className={fieldLabel}>Vị trí và hướng nhân vật (trục 180°)</label>
            <textarea
              className={`${fieldBase} h-16 resize-none`}
              placeholder="@cho stays on the left of frame facing right; the owner stays on the right facing left."
              value={bible.blocking}
              onChange={(e) => onChange({ blocking: e.target.value })}
            />
          </div>

          {refs.length > 0 && (
            <div>
              <label className={fieldLabel}>Mô tả cố định của từng tham chiếu</label>
              <div className="space-y-2">
                {refs.map((c) => (
                  <div key={c.id} className="flex items-center gap-2">
                    <img src={c.images[0]?.base64} alt="" className="w-8 h-8 rounded-lg object-cover shrink-0" />
                    <span className="w-16 shrink-0 truncate text-xs font-bold text-stone-600">{c.name || '?'}</span>
                    <input
                      className={fieldBase}
                      placeholder="the tan mastiff dog with a red collar"
                      value={bible.descriptors[c.id] ?? ''}
                      onChange={(e) => onChange({ descriptors: { ...bible.descriptors, [c.id]: e.target.value } })}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {filled && (
            <button
              onClick={onClear}
              className="flex items-center gap-1.5 text-xs font-bold text-stone-400 hover:text-red-500 transition-colors"
            >
              <Trash2 size={12} />
              Xoá hồ sơ cảnh
            </button>
          )}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Trạng thái cuối beat
// ---------------------------------------------------------------------------
const END_FIELDS: [keyof EndState, string, string][] = [
  ['positions', 'Vị trí, tư thế, hướng nhìn', 'Chó đứng giữa bếp, quay mặt sang phải, miệng ngậm xúc xích...'],
  ['props', 'Đồ vật', 'Đĩa vỡ dưới sàn, bên trái bàn...'],
  ['changes', 'Thay đổi giữ lại cho beat sau', 'Áo chủ nhà bị dính nước sốt...'],
];

export function EndStateCard({
  endState,
  onChange,
}: {
  endState: EndState;
  onChange: (patch: Partial<EndState>) => void;
}) {
  return (
    <div className="bg-white rounded-[28px] border border-stone-200/60 shadow-sm p-5 sm:p-6 space-y-3">
      <div className="flex items-start gap-2.5">
        <Flag size={16} className="text-stone-400 mt-0.5 shrink-0" />
        <div>
          <h3 className="text-sm font-black text-black leading-tight">Trạng thái cuối beat</h3>
          <p className="text-xs text-stone-400 mt-0.5 leading-relaxed">
            Beat sau (khi bật Nối tiếp beat trước) bắt đầu đúng từ trạng thái này. Sửa nếu AI ghi chưa đúng.
          </p>
        </div>
      </div>
      {END_FIELDS.map(([key, label, placeholder]) => (
        <div key={key}>
          <label className={fieldLabel}>{label}</label>
          <textarea
            className={`${fieldBase} h-16 resize-none`}
            placeholder={placeholder}
            value={endState[key]}
            onChange={(e) => onChange({ [key]: e.target.value })}
          />
        </div>
      ))}
    </div>
  );
}
