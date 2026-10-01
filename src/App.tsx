import React, { useState, useRef, useMemo, useEffect } from 'react';
import {
  Plus, Trash2, Copy, Loader2, Check, Download,
  FolderOpen, Sparkles, User, X, Image as ImageIcon,
  Info, ArrowRight, ArrowLeft, ArrowUp, ArrowDown, History, Quote, TriangleAlert, Video, Settings,
  PenLine, LayoutGrid, FilePlus,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { draftSceneBible, generateBeatPrompts, planBeat } from './gemini.ts';
import { EndStateCard, GridImageCard, SceneBibleCard } from './SceneCards.tsx';
import SettingsModal from './SettingsModal.tsx';
import { useConfirm } from './confirm.tsx';
import { copyText, newId } from './id.ts';
import { clearDraft, loadDraft, saveDraft } from './storage.ts';
import { getPromptFormat, hasApiKey, savePromptFormat } from './settings.ts';
import {
  MAX_TOTAL_SEC,
  activeBible,
  analyzePlan,
  bibleKey,
  buildGridImagePrompt,
  buildRefs,
  buildVideoPrompt,
  canonicalScript,
  duplicateRefNames,
  emptyBible,
  emptyEndState,
  gridImageRefs,
  hasBibleContent,
  parseScript,
  scriptMentions,
  refCharacters,
  fmtSec,
  planBlockReason,
  planKey,
  timeline,
  tokensToMentions,
  totalDuration,
} from './assemble.ts';
import type {
  AspectRatio,
  BeatSequence,
  Character,
  EditMode,
  EndState,
  GeneratedData,
  PanelPlan,
  PanelRole,
  PlanPanel,
  PromptFormat,
  SceneBible,
  StoredImage,
} from './types.ts';

const PROJECT_VERSION = '2.1';

const ROLE_LABEL: Record<PanelRole, string> = {
  setup: 'Thiết lập',
  action: 'Hành động',
  peak: 'Đỉnh',
  consequence: 'Hệ quả',
};

interface Result {
  plan: PanelPlan; // bản plan đã dùng để tạo prompt
  data: GeneratedData;
  aspect: AspectRatio;
  /** Hồ sơ cảnh lúc tạo; undefined = không kiểm tra (beat khôi phục từ lịch sử, project cũ) */
  sceneKey?: string;
}

// --- Small components ---
const CopyButton = ({ text, label }: { text: string; label?: string }) => {
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null);

  const handleCopy = async () => {
    // Không dùng alert(): trong khung nhúng (AI Studio) alert có thể bị chặn.
    setCopied((await copyText(text)) ? 'ok' : 'fail');
    setTimeout(() => setCopied(null), 2500);
  };

  return (
    <button
      onClick={handleCopy}
      className="px-3 py-2 sm:px-2.5 sm:py-1.5 bg-stone-50 sm:bg-transparent hover:bg-stone-100 rounded-lg transition-all text-stone-500 hover:text-gold-dark flex items-center gap-1.5 text-xs font-bold shrink-0"
      title="Copy"
    >
      {copied === 'ok' ? <Check size={13} className="text-gold" /> : <Copy size={13} />}
      <span className={copied === 'fail' ? 'text-red-500' : ''}>
        {copied === 'ok' ? 'Đã copy' : copied === 'fail' ? 'Không copy được, hãy bôi đen để copy' : label ?? 'Copy'}
      </span>
    </button>
  );
};

const PromptBlock = ({
  title, hint, text, icon,
}: { title: string; hint: string; text: string; icon: React.ReactNode }) => (
  <div className="bg-white rounded-[28px] border border-stone-200/60 shadow-sm overflow-hidden">
    <div className="flex items-start sm:items-center justify-between gap-3 px-4 sm:px-6 pt-4 sm:pt-5 pb-3">
      <div className="flex items-start sm:items-center gap-2.5 min-w-0">
        <span className="text-stone-400 mt-0.5 sm:mt-0">{icon}</span>
        <div className="min-w-0">
          <h3 className="text-sm font-black text-black leading-tight">{title}</h3>
          <p className="text-xs text-stone-400 mt-0.5">{hint}</p>
        </div>
      </div>
      <CopyButton text={text} label="Copy prompt" />
    </div>
    <pre className="whitespace-pre-wrap break-words px-4 sm:px-6 pb-5 sm:pb-6 text-[13px] leading-relaxed text-stone-700 font-sans select-text">
      {text}
    </pre>
  </div>
);

const DurationBar = ({ plan }: { plan: PanelPlan }) => {
  const total = totalDuration(plan);
  const over = total > MAX_TOTAL_SEC;
  const scale = Math.max(total, MAX_TOTAL_SEC);
  return (
    <div>
      <div className={`flex h-5 rounded-full overflow-hidden bg-stone-100 ${over ? 'ring-1 ring-red-300' : ''}`}>
        {plan.panels.map((p, i) => (
          <div
            key={p.id}
            style={{ width: `${(Math.max(p.durationSec, 0) / scale) * 100}%` }}
            className={`${i % 2 ? 'bg-gold' : 'bg-gold-dark'} text-white text-[10px] font-black flex items-center justify-center transition-all`}
            title={`Panel ${i + 1}: ${fmtSec(p.durationSec)}s`}
          >
            {i + 1}
          </div>
        ))}
      </div>
      <div className="flex justify-between mt-1.5 text-xs">
        <span className={over ? 'text-red-500 font-bold' : 'text-stone-500 font-semibold'}>
          {fmtSec(total)}s / {MAX_TOTAL_SEC}s
        </span>
        <span className="hidden sm:inline text-stone-300">Giới hạn mỗi lần tạo của Omni</span>
      </div>
    </div>
  );
};

const CHIP_CLASS =
  'inline-flex items-center gap-1 bg-gold-light text-gold-dark px-1.5 py-0.5 rounded-md font-medium mx-0.5 select-none';

/** Thẻ @tên trong ô kịch bản (không sửa được bên trong, xóa bằng Backspace như một ký tự). */
const makeChip = (name: string) => {
  const span = document.createElement('span');
  span.className = CHIP_CLASS;
  span.contentEditable = 'false';
  span.textContent = `@${name || 'Unnamed'}`;
  return span;
};

/** Dựng nội dung ô kịch bản từ chữ thường: @tên khớp tham chiếu thành thẻ, xuống dòng thành <br>. */
const scriptFragment = (text: string, characters: Character[]) => {
  const frag = document.createDocumentFragment();
  const addText = (t: string) =>
    t.split('\n').forEach((line, i) => {
      if (i > 0) frag.appendChild(document.createElement('br'));
      if (line) frag.appendChild(document.createTextNode(line));
    });
  parseScript(text.replace(/\r\n?/g, '\n'), characters).forEach((p) => {
    if (p.kind === 'ref') frag.appendChild(makeChip(p.ref.name.trim()));
    else addText(p.kind === 'text' ? p.text : `@${p.name}`);
  });
  return frag;
};

/** Ô số giây: cho phép xóa trống khi đang gõ (lúc đó thời lượng tính là 0 và nút Tạo prompt bị chặn). */
const DurationInput = ({ value, onChange }: { value: number; onChange: (v: number) => void }) => {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    if (Number(text) !== value) setText(String(value));
  }, [value]);
  return (
    <input
      type="number"
      inputMode="decimal"
      min={0.5}
      step={0.5}
      className={fieldBase}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const n = parseFloat(e.target.value);
        onChange(Number.isFinite(n) ? n : 0);
      }}
      onBlur={() => setText(String(value))}
    />
  );
};

const fieldLabel = 'block text-[11px] font-semibold text-stone-400 mb-1';
const fieldBase =
  'w-full bg-stone-50/70 border border-stone-100 rounded-xl px-3 py-2.5 sm:py-2 text-base sm:text-sm text-stone-700 outline-none focus:border-gold focus:bg-white transition-colors placeholder:text-stone-300';

export default function App() {
  // --- State ---
  const [characters, setCharacters] = useState<Character[]>([]);
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null);
  const [scriptText, setScriptText] = useState('');
  const [aspect, setAspect] = useState<AspectRatio>('16:9');
  const [continueFromPrev, setContinueFromPrev] = useState(false);

  const [plan, setPlan] = useState<PanelPlan | null>(null);
  const [planScript, setPlanScript] = useState('');
  const [contextBeat, setContextBeat] = useState<BeatSequence | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [history, setHistory] = useState<BeatSequence[]>([]);
  const [bible, setBible] = useState<SceneBible>(emptyBible);
  const [isDrafting, setIsDrafting] = useState(false);
  const [ask, confirmDialog] = useConfirm();
  /** Beat đang hiển thị trong phần kết quả (id trong lịch sử), dùng làm "beat trước" khi nối tiếp */
  const [currentBeatId, setCurrentBeatId] = useState<string | null>(null);
  /** Đã nạp xong bản nháp tự lưu chưa (chưa nạp xong thì không ghi đè) */
  const [hydrated, setHydrated] = useState(false);

  const [isPlanning, setIsPlanning] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  /** Chỉ dùng trên màn hình nhỏ: đang xem phần soạn beat hay phần panel/prompt */
  const [mobileTab, setMobileTab] = useState<'beat' | 'result'>('beat');
  const [promptFormat, setPromptFormat] = useState<PromptFormat>(getPromptFormat());
  const resultRef = useRef<HTMLElement>(null);
  const [, setSettingsVersion] = useState(0); // đổi giá trị để vẽ lại chấm cảnh báo key sau khi lưu

  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);

  const totalImages = characters.reduce((sum, char) => sum + char.images.length, 0);

  // --- Derived ---
  const warnings = useMemo(() => {
    if (!plan) return [];
    return Array.from(new Set([...analyzePlan(plan), ...plan.warnings]));
  }, [plan]);

  const blockReason = plan ? planBlockReason(plan) : null;

  const stale =
    !!result &&
    !!plan &&
    (planKey(plan) !== planKey(result.plan) ||
      aspect !== result.aspect ||
      (result.sceneKey !== undefined && result.sceneKey !== bibleKey(bible)));

  const gridPrompt = useMemo(
    () => (result ? buildGridImagePrompt(result.plan, result.data, characters, result.aspect, promptFormat) : ''),
    [result, characters, promptFormat],
  );
  const videoPrompt = useMemo(
    () => (result ? buildVideoPrompt(result.plan, result.data, characters, promptFormat) : ''),
    [result, characters, promptFormat],
  );

  // --- Characters ---
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result as string;
      const newCharId = newId();
      setCharacters((prev) => [
        ...prev,
        {
          id: newCharId,
          name: '',
          appearance: '',
          images: [{ id: newId(), base64, mimeType: file.type || 'image/png' }],
        },
      ]);
      setSelectedCharacterId(newCharId);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const updateCharacter = (id: string, field: keyof Character, value: string) => {
    setCharacters((prev) => prev.map((c) => (c.id === id ? { ...c, [field]: value } : c)));
  };

  const removeCharacter = (id: string) => {
    setCharacters((prev) => prev.filter((c) => c.id !== id));
    if (selectedCharacterId === id) setSelectedCharacterId(null);
  };

  // --- Project save / open ---
  const projectSnapshot = (text: string) => ({
    version: PROJECT_VERSION,
    timestamp: Date.now(),
    characters,
    scriptText: text,
    aspect,
    plan,
    planScript,
    result,
    history,
    contextBeat,
    currentBeatId,
    continueFromPrev,
    sceneBible: bible,
  });

  const handleSaveProject = () => {
    const projectData = projectSnapshot(editorRef.current?.innerText || '');

    const blob = new Blob([JSON.stringify(projectData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `storyboard-beat-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const setEditorText = (text: string, chars: Character[] = characters) => {
    setScriptText(text);
    editorRef.current?.replaceChildren(scriptFragment(text, chars));
  };

  /** Nạp dữ liệu project (từ file hoặc từ bản nháp tự lưu). Trả về false nếu là project bản cũ. */
  const applyProject = (data: any): boolean => {
    const chars: Character[] = Array.isArray(data.characters) ? data.characters : [];
    setCharacters(chars);
    setEditorText(typeof data.scriptText === 'string' ? data.scriptText : '', chars);
    setContextBeat(null);
    setCurrentBeatId(null);
    setSelectedCharacterId(null);
    setMentionQuery(null);
    setBible(emptyBible());

    if (data.version !== PROJECT_VERSION) {
      // Project cũ (bản 3x3 / 2x2 trước đây) có cấu trúc dữ liệu khác, không nạp lại được.
      setPlan(null);
      setPlanScript('');
      setResult(null);
      setHistory([]);
      return false;
    }
    if (data.aspect === '16:9' || data.aspect === '9:16') setAspect(data.aspect);
    setPlan(data.plan ?? null);
    setPlanScript(data.planScript ?? '');
    setResult(data.result ?? null);
    setHistory(Array.isArray(data.history) ? data.history : []);
    setContextBeat(data.contextBeat ?? null);
    setCurrentBeatId(data.currentBeatId ?? null);
    setContinueFromPrev(!!data.continueFromPrev);
    setBible({ ...emptyBible(), ...(data.sceneBible ?? {}) });
    return true;
  };

  const handleOpenProject = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target?.result as string);
        setError(
          applyProject(data)
            ? ''
            : 'Đây là project bản cũ: chỉ nạp được tham chiếu và kịch bản. Hãy phân tích panel lại.',
        );
      } catch (err) {
        console.error('Error parsing project file:', err);
        setError('Không mở được file project. Định dạng không hợp lệ.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleNewProject = async () => {
    if (!(await ask('Tạo project mới? Tham chiếu, kịch bản, panel và lịch sử hiện tại sẽ bị xóa (hãy Lưu project trước nếu cần giữ).'))) {
      return;
    }
    applyProject({ version: PROJECT_VERSION });
    setAspect('16:9');
    setError('');
    setMobileTab('beat');
    clearDraft();
  };

  // --- Tự lưu bản nháp ---
  // Trang có thể bị tải lại bất ngờ (máy chủ Vite mất kết nối rồi tự reload, điện thoại đóng tab chạy nền,
  // lỡ bấm F5...). Mọi thứ đang làm được lưu vào trình duyệt và nạp lại khi mở trang.
  useEffect(() => {
    let cancelled = false;
    loadDraft<any>().then((draft) => {
      if (cancelled) return;
      if (draft && draft.version === PROJECT_VERSION) applyProject(draft);
      setHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const latestDraft = useRef<unknown>(null);
  useEffect(() => {
    if (!hydrated) return;
    latestDraft.current = projectSnapshot(scriptText);
    const timer = setTimeout(() => saveDraft(latestDraft.current), 400);
    return () => clearTimeout(timer);
  }, [hydrated, characters, scriptText, aspect, plan, planScript, result, history, contextBeat, currentBeatId, continueFromPrev, bible]);

  // Ghi ngay khi rời trang / chuyển sang ứng dụng khác, không chờ hết thời gian chờ ở trên.
  useEffect(() => {
    const flush = () => {
      if (latestDraft.current) saveDraft(latestDraft.current);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flush);
    };
  }, []);

  // --- @mention ---
  const handleInput = () => {
    if (!editorRef.current) return;
    setScriptText(editorRef.current.innerText);

    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const node = range.startContainer;
      const textBefore = node.textContent?.slice(0, range.startOffset) || '';
      const match = textBefore.match(/@([^@\n]{0,30})$/);
      setMentionQuery(match ? match[1].toLowerCase() : null);
    }
  };

  const insertMention = (char: Character) => {
    if (!editorRef.current) return;
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;

    const range = selection.getRangeAt(0);
    const node = range.startContainer;
    const textBefore = node.textContent?.slice(0, range.startOffset) || '';
    const match = textBefore.match(/@([^@\n]{0,30})$/);

    if (match) {
      range.setStart(node, range.startOffset - match[0].length);
      range.deleteContents();

      const span = makeChip(char.name.trim());

      range.insertNode(span);
      const space = document.createTextNode('\u00A0');
      span.parentNode?.insertBefore(space, span.nextSibling);
      range.setStartAfter(space);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      setMentionQuery(null);
      setScriptText(editorRef.current.innerText);
    }
  };

  /** Dán kịch bản: chỉ lấy chữ (bỏ định dạng), @tên khớp tham chiếu tự thành thẻ. */
  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection?.rangeCount) return;
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    if (!text) return;

    const range = selection.getRangeAt(0);
    range.deleteContents();
    const frag = scriptFragment(text, characters);
    const last = frag.lastChild;
    range.insertNode(frag);
    if (last) {
      range.setStartAfter(last);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    setMentionQuery(null);
    setScriptText(editor.innerText);
  };

  // Khi thêm hoặc đổi tên tham chiếu, các @tên đã có trong kịch bản được gắn lại thành thẻ.
  // Chỉ làm khi không gõ trong ô kịch bản, để không làm nhảy con trỏ.
  const refNamesKey = refCharacters(characters)
    .map((c) => `${c.id}:${c.name}`)
    .join('|');
  useEffect(() => {
    const editor = editorRef.current;
    if (!hydrated || !editor || document.activeElement === editor) return;
    editor.replaceChildren(scriptFragment(scriptText, characters));
  }, [refNamesKey, hydrated]);

  // --- Bước 1: phân tích panel ---
  const errorText = (prefix: string, err: unknown) => {
    const detail = err instanceof Error ? err.message.slice(0, 140) : '';
    return `${prefix}${detail ? ` (${detail})` : ''}`;
  };

  const handlePlan = async () => {
    // Viết lại @tên theo đúng tên tham chiếu ("@Chó" -> "@cho") để AI nhận ra.
    const text = canonicalScript((editorRef.current?.innerText ?? scriptText).trim(), characters);
    if (!text) return;

    if (!hasApiKey()) {
      setError('Chưa có API key. Nhập key trong Cài đặt rồi thử lại.');
      setShowSettings(true);
      return;
    }

    // Beat trước = beat đang hiển thị (vừa tạo hoặc vừa khôi phục), nếu không còn thì lấy beat mới nhất.
    const prev =
      continueFromPrev && history.length > 0
        ? (history.find((h) => h.id === currentBeatId) ?? history[0])
        : null;
    setError('');
    setIsPlanning(true);
    setMobileTab('result');
    try {
      const p = await planBeat(text, characters, prev, bible);
      setPlan(p);
      setPlanScript(text);
      setContextBeat(prev);
      setResult(null);
    } catch (err) {
      console.error(err);
      setError(errorText('Không phân tích được panel. Kiểm tra API key và model trong Cài đặt.', err));
      setMobileTab('beat');
    } finally {
      setIsPlanning(false);
    }
  };

  // --- Bước 2: tạo prompt từ plan đã sửa ---
  const handleGenerate = async () => {
    if (!plan) return;
    const reason = planBlockReason(plan);
    if (reason) {
      setError(reason);
      return;
    }

    if (!hasApiKey()) {
      setError('Chưa có API key. Nhập key trong Cài đặt rồi thử lại.');
      setShowSettings(true);
      return;
    }

    const snapshot: PanelPlan = JSON.parse(JSON.stringify(plan));
    const text = planScript || scriptText;
    // Lấy bản mới nhất của beat trước (trạng thái cuối có thể đã được sửa sau khi phân tích panel).
    const prev = contextBeat ? (history.find((h) => h.id === contextBeat.id) ?? contextBeat) : null;
    setError('');
    setIsGenerating(true);
    try {
      const data = await generateBeatPrompts(text, snapshot, characters, aspect, prev, bible);
      const beatId = newId();
      setResult({ plan: snapshot, data, aspect, sceneKey: bibleKey(bible) });
      setCurrentBeatId(beatId);
      // Cuộn tới phần prompt vừa tạo (hữu ích nhất trên di động, nơi phần kết quả nằm dưới 4 panel).
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
      setHistory((prev) => [
        {
          id: beatId,
          timestamp: Date.now(),
          scriptText: text,
          aspect,
          plan: snapshot,
          generatedData: data,
          prevId: prev?.id,
        },
        ...prev,
      ]);
    } catch (err) {
      console.error(err);
      setError(errorText('Không tạo được prompt. Kiểm tra API key và model trong Cài đặt.', err));
    } finally {
      setIsGenerating(false);
    }
  };

  // --- Hồ sơ cảnh (thao tác) ---
  const handleDraftBible = async () => {
    if (!hasApiKey()) {
      setError('Chưa có API key. Nhập key trong Cài đặt rồi thử lại.');
      setShowSettings(true);
      return;
    }
    if (hasBibleContent(bible) && !(await ask('Thay hồ sơ cảnh hiện tại bằng bản nháp mới của AI?'))) return;
    setError('');
    setIsDrafting(true);
    try {
      const text = canonicalScript((editorRef.current?.innerText ?? scriptText).trim(), characters);
      const d = await draftSceneBible(characters, text, bible.locationImage ?? null);
      setBible((b) => ({ ...b, enabled: true, ...d }));
    } catch (err) {
      console.error(err);
      setError(errorText('Không viết được hồ sơ cảnh. Kiểm tra API key và model trong Cài đặt.', err));
    } finally {
      setIsDrafting(false);
    }
  };

  const takeBibleFromResult = async () => {
    if (!result) return;
    if (hasBibleContent(bible) && !(await ask('Thay phong cách và mô tả tham chiếu trong hồ sơ cảnh bằng của beat đang xem?'))) {
      return;
    }
    const d = result.data;
    setBible((b) => ({
      ...b,
      enabled: true,
      style: tokensToMentions(d.styleBlock),
      location: d.scene?.location ? tokensToMentions(d.scene.location) : b.location || tokensToMentions(d.imagePanels[0]?.environment ?? ''),
      blocking: d.scene?.blocking ? tokensToMentions(d.scene.blocking) : b.blocking,
      descriptors: { ...b.descriptors, ...d.descriptors },
    }));
  };

  // --- Trạng thái cuối beat (sửa cả kết quả đang xem và mục tương ứng trong lịch sử) ---
  const updateEndState = (patch: Partial<EndState>) => {
    const merge = (d: GeneratedData): GeneratedData => ({
      ...d,
      endState: { ...emptyEndState(), ...d.endState, ...patch },
    });
    setResult((r) => (r ? { ...r, data: merge(r.data) } : r));
    if (currentBeatId) {
      setHistory((h) => h.map((item) => (item.id === currentBeatId ? { ...item, generatedData: merge(item.generatedData) } : item)));
    }
  };

  /** Ảnh lưới người dùng đã tạo cho beat đang xem (lưu vào mục lịch sử của beat đó). */
  const setGridImage = (img: StoredImage | null) => {
    if (!currentBeatId) return;
    setHistory((h) =>
      h.map((item) => (item.id === currentBeatId ? { ...item, gridImage: img ?? undefined } : item)),
    );
  };

  // --- Sửa plan ---
  const patchPlan = (patch: Partial<PanelPlan>) => setPlan((p) => (p ? { ...p, ...patch } : p));

  const patchPanel = (id: string, patch: Partial<PlanPanel>) =>
    setPlan((p) =>
      p ? { ...p, panels: p.panels.map((x) => (x.id === id ? { ...x, ...patch } : x)) } : p,
    );

  const movePanel = (index: number, dir: -1 | 1) =>
    setPlan((p) => {
      if (!p) return p;
      const j = index + dir;
      if (j < 0 || j >= p.panels.length) return p;
      const panels = [...p.panels];
      [panels[index], panels[j]] = [panels[j], panels[index]];
      return { ...p, panels };
    });

  const restoreFromHistory = (item: BeatSequence) => {
    setEditorText(item.scriptText);
    setAspect(item.aspect);
    setPlan(item.plan);
    setPlanScript(item.scriptText);
    setResult({ plan: item.plan, data: item.generatedData, aspect: item.aspect });
    // Giữ liên kết với beat trước để "Tạo lại prompt" vẫn nối tiếp đúng.
    setContextBeat(item.prevId ? (history.find((h) => h.id === item.prevId) ?? null) : null);
    setCurrentBeatId(item.id);
    setShowHistory(false);
    setMobileTab('result');
  };

  const changeFormat = (f: PromptFormat) => {
    setPromptFormat(f);
    savePromptFormat(f);
  };
  const resultRefs = result ? buildRefs(characters, result.plan.refIds, result.data.descriptors) : [];
  const gridRefs = result ? gridImageRefs(result.plan, result.data, characters) : [];
  const currentBeat = result ? history.find((h) => h.id === currentBeatId) : undefined;
  // Bản mới nhất của beat trước (ảnh lưới / trạng thái cuối có thể được thêm sau khi phân tích panel)
  const prevBeat = contextBeat ? (history.find((h) => h.id === contextBeat.id) ?? contextBeat) : null;
  const dupNames = duplicateRefNames(characters);
  const availableRefs = refCharacters(characters);
  const mentions = useMemo(() => scriptMentions(scriptText, characters), [scriptText, characters]);
  const busy = isPlanning || isGenerating;
  const resultTotal = result ? totalDuration(result.plan) : 0;

  return (
    <div className="flex flex-col lg:flex-row h-screen supports-[height:100dvh]:h-dvh bg-white text-black overflow-hidden font-sans selection:bg-gold-light">
      {/* Sidebar */}
      <aside
        className={`${mobileTab === 'beat' ? 'flex' : 'hidden'} lg:flex flex-col flex-1 lg:flex-none min-h-0 w-full lg:w-[440px] lg:shrink-0 lg:h-full lg:border-r border-stone-200 bg-stone-50/30 z-20`}
      >
        <div className="p-4 sm:p-6 overflow-y-auto flex-1 min-h-0 scrollbar-hide space-y-4 sm:space-y-6">
          <header className="flex items-center justify-between px-1 sm:px-2 mb-1 sm:mb-2">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-black rounded-xl flex items-center justify-center shadow-lg shadow-gold/20">
                <Sparkles className="text-gold w-5 h-5" />
              </div>
              <h1 className="text-xl font-bold tracking-tight text-black flex flex-col leading-tight">
                <span>Storyboard</span>
                <span className="text-sm text-stone-500">(Huy Animation)</span>
              </h1>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={handleNewProject}
                className="p-2.5 lg:p-2 bg-white border border-stone-200 rounded-xl transition-all text-stone-600 hover:bg-gold-light hover:text-gold-dark hover:border-gold-light shadow-sm"
                title="Project mới"
              >
                <FilePlus size={16} />
              </button>
              <label
                className="p-2.5 lg:p-2 bg-white border border-stone-200 rounded-xl transition-all text-stone-600 hover:bg-gold-light hover:text-gold-dark hover:border-gold-light cursor-pointer shadow-sm"
                title="Mở project"
              >
                <FolderOpen size={16} />
                <input type="file" hidden accept=".json" onChange={handleOpenProject} />
              </label>
              <button
                onClick={handleSaveProject}
                className="p-2.5 lg:p-2 bg-white border border-stone-200 rounded-xl transition-all text-stone-600 hover:bg-gold-light hover:text-gold-dark hover:border-gold-light shadow-sm"
                title="Lưu project"
              >
                <Download size={16} />
              </button>
              <button
                onClick={() => setShowSettings(true)}
                className="relative p-2.5 lg:p-2 bg-white border border-stone-200 rounded-xl transition-all text-stone-600 hover:bg-gold-light hover:text-gold-dark hover:border-gold-light shadow-sm"
                title="Cài đặt (API key, model)"
              >
                <Settings size={16} />
                {!hasApiKey() && (
                  <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-amber-500 border-2 border-white" />
                )}
              </button>
              <button
                onClick={() => setShowHistory(!showHistory)}
                className={`p-2.5 lg:p-2 rounded-xl transition-all shadow-sm ${
                  showHistory
                    ? 'bg-gold text-white shadow-gold/20'
                    : 'bg-white border border-stone-200 text-stone-600 hover:bg-stone-50'
                }`}
                title="Lịch sử"
              >
                <History size={16} />
              </button>
            </div>
          </header>

          {/* Characters */}
          <section className="bg-white p-5 sm:p-6 rounded-[28px] border border-stone-200/60 shadow-sm">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-stone-400">
                Tham chiếu ({totalImages}/10)
              </h2>
            </div>

            <div className="flex flex-wrap gap-3">
              {characters.map((char) => (
                <motion.button
                  layoutId={char.id}
                  key={char.id}
                  onClick={() => setSelectedCharacterId(char.id)}
                  className={`relative w-14 h-14 rounded-2xl border-2 transition-all overflow-hidden group ${
                    selectedCharacterId === char.id
                      ? 'border-gold ring-4 ring-gold-light'
                      : 'border-stone-100 hover:border-stone-200'
                  }`}
                >
                  <img src={char.images[0]?.base64} className="w-full h-full object-cover" alt={char.name} />
                  <div className="absolute inset-0 bg-gold/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <User className="text-white w-4 h-4" />
                  </div>
                </motion.button>
              ))}

              <label className="w-14 h-14 rounded-2xl border-2 border-dashed border-stone-200 flex items-center justify-center cursor-pointer hover:bg-gold-light hover:border-gold-light transition-all group">
                <Plus size={20} className="text-stone-300 group-hover:text-gold transition-colors" />
                <input type="file" hidden accept="image/*" onChange={handleFileUpload} />
              </label>
            </div>

            <AnimatePresence mode="wait">
              {selectedCharacterId && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mt-5 pt-5 border-t border-stone-100 relative group overflow-hidden"
                >
                  <button
                    onClick={() => removeCharacter(selectedCharacterId)}
                    className="absolute top-4 right-0 p-2.5 lg:top-5 lg:p-1.5 text-stone-300 hover:text-red-500 transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                  <input
                    className="w-[calc(100%-24px)] bg-transparent font-bold text-stone-800 outline-none mb-2 placeholder:text-stone-300 text-base"
                    placeholder="Tên biến (vd: cho, meo, xucxich)..."
                    value={characters.find((c) => c.id === selectedCharacterId)?.name ?? ''}
                    onChange={(e) => updateCharacter(selectedCharacterId, 'name', e.target.value)}
                  />
                  <textarea
                    className="w-full bg-transparent text-base sm:text-sm text-stone-500 outline-none h-20 resize-none placeholder:text-stone-300 leading-relaxed"
                    placeholder="Mô tả nhân vật hoặc vật dụng, đặc điểm chính..."
                    value={characters.find((c) => c.id === selectedCharacterId)?.appearance ?? ''}
                    onChange={(e) => updateCharacter(selectedCharacterId, 'appearance', e.target.value)}
                  />
                </motion.div>
              )}
            </AnimatePresence>

            {dupNames.length > 0 && (
              <p className="mt-4 text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2 leading-relaxed">
                Trùng tên: {dupNames.join(', ')}. Mỗi tham chiếu cần một tên riêng để làm biến trong prompt.
              </p>
            )}
          </section>

          <SceneBibleCard
            bible={bible}
            refs={refCharacters(characters)}
            drafting={isDrafting}
            canTakeFromResult={!!result}
            onChange={(patch) => setBible((b) => ({ ...b, ...patch }))}
            onDraft={handleDraftBible}
            onTakeFromResult={takeBibleFromResult}
            onClear={() => {
              ask('Xoá hồ sơ cảnh?').then((ok) => ok && setBible(emptyBible()));
            }}
          />

          {/* Script / one beat */}
          <section className="bg-white p-5 sm:p-6 rounded-[28px] border border-stone-200/60 shadow-sm flex-1 flex flex-col min-h-0">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-stone-400">
                Script / Idea (1 beat)
              </h2>
              <div className="flex items-center gap-1 text-[9px] font-bold text-stone-300 uppercase tracking-wider">
                <Info size={10} />
                <span>Gõ hoặc dán @tên</span>
              </div>
            </div>

            <div className="relative group flex-1 min-h-0">
              <div
                ref={editorRef}
                contentEditable
                onInput={handleInput}
                onPaste={handlePaste}
                className="w-full h-full min-h-[160px] lg:min-h-[200px] outline-none text-stone-700 leading-relaxed text-base lg:text-sm scrollbar-hide overflow-y-auto"
              />
              {!scriptText && (
                <div className="absolute top-0 left-0 text-stone-300 pointer-events-none text-base lg:text-sm italic">
                  Viết nội dung của một beat (khoảng 6–10 giây)...
                </div>
              )}

              <AnimatePresence>
                {mentionQuery !== null && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    className="absolute bottom-full left-0 w-full bg-white shadow-2xl rounded-2xl border border-stone-100 p-2 z-50 mb-4"
                  >
                    {characters.filter((c) => c.name.toLowerCase().includes(mentionQuery)).length > 0 ? (
                      characters
                        .filter((c) => c.name.toLowerCase().includes(mentionQuery))
                        .map((c) => (
                          <button
                            key={c.id}
                            onClick={() => insertMention(c)}
                            className="w-full p-2.5 hover:bg-gold-light transition-colors cursor-pointer rounded-xl flex items-center gap-3 text-sm text-left"
                          >
                            <div className="w-8 h-8 rounded-lg bg-stone-100 overflow-hidden shrink-0">
                              <img src={c.images[0]?.base64} alt="" className="object-cover w-full h-full" />
                            </div>
                            <span className="font-bold text-stone-700">{c.name || 'Unnamed'}</span>
                          </button>
                        ))
                    ) : (
                      <div className="p-4 text-xs text-stone-400 text-center">Không tìm thấy nhân vật</div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {(mentions.refs.length > 0 || mentions.unknown.length > 0) && (
              <div className="mt-4 pt-4 border-t border-stone-100 space-y-2.5">
                {mentions.refs.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[11px] font-semibold text-stone-400">Đã gắn:</span>
                    {mentions.refs.map((c) => (
                      <span
                        key={c.id}
                        className="flex items-center gap-1.5 pl-0.5 pr-2 py-0.5 rounded-lg bg-gold-light text-gold-dark text-xs font-bold"
                      >
                        <img src={c.images[0]?.base64} alt="" className="w-5 h-5 rounded-md object-cover" />
                        {c.name.trim()}
                      </span>
                    ))}
                  </div>
                )}
                {mentions.unknown.length > 0 && (
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2 leading-relaxed">
                    Chưa có tham chiếu tên: {mentions.unknown.map((n) => `@${n}`).join(', ')}. Thêm ảnh tham chiếu và đặt
                    đúng tên này để gắn tự động.
                  </p>
                )}
              </div>
            )}
          </section>
        </div>

        <div className="p-4 sm:p-6 border-t border-stone-200 bg-white shadow-[0_-4px_24px_rgba(0,0,0,0.02)]">
          {error && (
            <div className="mb-4 p-3 bg-red-50 text-red-600 text-xs font-semibold rounded-xl border border-red-100 flex items-start gap-2 leading-relaxed">
              <X size={12} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="mb-3 bg-stone-50/80 p-1.5 rounded-[20px] flex items-center border border-stone-100/80">
            {(['16:9', '9:16'] as AspectRatio[]).map((a) => (
              <button
                key={a}
                onClick={() => setAspect(a)}
                className={`flex-1 py-3 rounded-[14px] text-[10px] font-black uppercase tracking-[0.15em] transition-all ${
                  aspect === a
                    ? 'bg-white text-black shadow-[0_2px_8px_rgba(0,0,0,0.04)] border border-stone-200/60'
                    : 'text-stone-400 hover:text-stone-600'
                }`}
              >
                {a === '16:9' ? '16:9 Ngang' : '9:16 Dọc'}
              </button>
            ))}
          </div>

          <label
            className={`mb-3 flex items-center gap-3 px-4 py-3 rounded-2xl border text-xs font-bold transition-colors ${
              history.length === 0
                ? 'border-stone-100 text-stone-300 cursor-not-allowed'
                : 'border-stone-200 text-stone-600 cursor-pointer hover:bg-stone-50'
            }`}
          >
            <input
              type="checkbox"
              className="accent-gold w-4 h-4"
              checked={continueFromPrev && history.length > 0}
              disabled={history.length === 0}
              onChange={(e) => setContinueFromPrev(e.target.checked)}
            />
            <span>
              Nối tiếp beat trước
              <span className="hidden sm:inline"> (panel 1 khớp panel 4 của beat trước)</span>
            </span>
          </label>

          <button
            onClick={handlePlan}
            disabled={busy || !scriptText.trim()}
            className="w-full py-4 bg-black text-gold rounded-[20px] font-black text-xs uppercase tracking-[0.15em] flex items-center justify-center gap-2 hover:bg-stone-900 disabled:bg-stone-100 disabled:text-stone-300 transition-all shadow-xl shadow-gold/10 active:scale-[0.98] border border-gold/20"
          >
            {isPlanning ? <Loader2 className="animate-spin w-4 h-4" /> : <Sparkles size={16} />}
            <span>{plan ? 'Phân tích panel lại' : 'Phân tích panel'}</span>
          </button>
        </div>
      </aside>

      {/* Main */}
      <main
        className={`${mobileTab === 'result' ? 'block' : 'hidden'} lg:block flex-1 min-h-0 bg-white overflow-y-auto scroll-smooth relative`}
      >
        {!plan && !isPlanning && (
          <div className="h-full flex flex-col items-center justify-center p-8 lg:p-12 text-center">
            <div className="w-28 h-28 bg-stone-50 rounded-[40px] flex items-center justify-center mb-8">
              <ImageIcon size={44} strokeWidth={1} className="text-stone-200" />
            </div>
            <h3 className="text-2xl font-black text-black mb-3 tracking-tight">Bắt đầu từ một beat</h3>
            <p className="max-w-sm text-stone-400 text-sm leading-relaxed font-medium">
              Thêm nhân vật, viết nội dung của một beat rồi bấm Phân tích panel. Bạn sẽ chỉnh 4 panel và thời lượng
              trước khi tạo prompt cho ảnh lưới 2x2 và video Omni.
            </p>
          </div>
        )}

        {isPlanning && (
          <div className="h-full flex flex-col items-center justify-center p-8 lg:p-12 text-center">
            <div className="relative w-20 h-20 mb-8">
              <Loader2 className="animate-spin w-20 h-20 text-gold-light" strokeWidth={1} />
              <Sparkles className="absolute inset-0 m-auto text-gold w-8 h-8 animate-pulse" />
            </div>
            <h3 className="text-xl font-black text-black mb-2 tracking-tight">Đang chia beat thành 4 panel</h3>
            <p className="max-w-xs text-stone-400 text-sm leading-relaxed font-medium">
              Tìm các khoảnh khắc thay đổi, chọn 4 keyframe và ước lượng thời lượng.
            </p>
          </div>
        )}

        {plan && !isPlanning && (
          <div className="max-w-5xl mx-auto p-4 sm:p-6 lg:p-10 space-y-6 lg:space-y-8">
            {/* Panel plan */}
            <section className="space-y-5">
              <div className="flex items-end justify-between gap-6">
                <div>
                  <h2 className="text-xl sm:text-2xl font-black tracking-tight">Panel plan</h2>
                  <p className="text-sm text-stone-400 mt-1">
                    Sửa nội dung, cỡ cảnh và thời lượng của 4 panel, rồi tạo prompt.
                  </p>
                </div>
                <div className="hidden lg:flex flex-col items-end gap-1.5 shrink-0">
                  <button
                    onClick={handleGenerate}
                    disabled={busy || !!blockReason}
                    className="px-6 py-3.5 bg-black text-gold rounded-[18px] font-black text-xs uppercase tracking-[0.15em] flex items-center gap-2 hover:bg-stone-900 disabled:bg-stone-100 disabled:text-stone-300 transition-all shadow-xl shadow-gold/10 active:scale-[0.98] border border-gold/20"
                  >
                    {isGenerating ? <Loader2 className="animate-spin w-4 h-4" /> : <ArrowRight size={16} />}
                    <span>{result ? 'Tạo lại prompt' : 'Tạo prompt'}</span>
                  </button>
                  {blockReason && <span className="text-xs text-red-500 font-semibold">{blockReason}</span>}
                </div>
              </div>

              {error && (
                <div className="lg:hidden p-3 bg-red-50 text-red-600 text-xs font-semibold rounded-xl border border-red-100 flex items-start gap-2 leading-relaxed">
                  <X size={12} className="shrink-0 mt-0.5" />
                  <span className="break-words min-w-0">{error}</span>
                </div>
              )}

              {(contextBeat || activeBible(bible)) && (
                <div className="flex flex-col gap-2 text-[13px] text-stone-600 bg-stone-50/70 border border-stone-100 rounded-2xl px-4 py-3 leading-relaxed">
                  {prevBeat && (
                    <div className="flex gap-3">
                      {prevBeat.gridImage && (
                        <img
                          src={prevBeat.gridImage.base64}
                          alt=""
                          className="w-20 h-14 rounded-lg object-cover border border-stone-200 shrink-0"
                        />
                      )}
                      <p>
                        <span className="font-bold text-stone-800">Nối tiếp beat trước: </span>
                        {prevBeat.plan.beatSummary || prevBeat.scriptText.slice(0, 80)}
                        {prevBeat.generatedData.endState?.positions && (
                          <span className="block text-stone-400">
                            Bắt đầu từ: {prevBeat.generatedData.endState.positions}
                          </span>
                        )}
                        <span className={`block ${prevBeat.gridImage ? 'text-gold-dark' : 'text-amber-700'}`}>
                          {prevBeat.gridImage
                            ? 'Ảnh lưới của beat trước sẽ được gắn làm mốc (prev_storyboard).'
                            : 'Beat trước chưa có ảnh lưới. Mở beat đó trong Lịch sử và tải ảnh lên để đồng bộ nét vẽ tốt hơn.'}
                        </span>
                      </p>
                    </div>
                  )}
                  {activeBible(bible) && (
                    <p className="flex items-center gap-1.5">
                      <span className="font-bold text-gold-dark">Đang dùng hồ sơ cảnh đã khoá</span>
                      <span className="text-stone-400">(phong cách, bối cảnh, mô tả tham chiếu)</span>
                    </p>
                  )}
                </div>
              )}

              <div className="bg-white rounded-[28px] border border-stone-200/60 shadow-sm p-4 sm:p-6 space-y-5">
                <div>
                  <label className={fieldLabel}>Tóm tắt beat</label>
                  <textarea
                    className={`${fieldBase} h-16 resize-none`}
                    value={plan.beatSummary}
                    onChange={(e) => patchPlan({ beatSummary: e.target.value })}
                  />
                </div>

                <DurationBar plan={plan} />

                <div>
                  <label className={fieldLabel}>Kiểu dựng</label>
                  <div className="bg-stone-50/80 p-1 rounded-2xl flex border border-stone-100/80 max-w-md">
                    {([
                      ['continuous', 'Một cú máy liền'],
                      ['cuts', 'Cắt cảnh giữa các panel'],
                    ] as [EditMode, string][]).map(([mode, label]) => (
                      <button
                        key={mode}
                        onClick={() => patchPlan({ editMode: mode })}
                        className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-all ${
                          plan.editMode === mode
                            ? 'bg-white text-black shadow-[0_2px_8px_rgba(0,0,0,0.04)] border border-stone-200/60'
                            : 'text-stone-400 hover:text-stone-600'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {availableRefs.length > 0 && (
                  <div>
                    <label className={fieldLabel}>Tham chiếu có trong beat (được khai báo trong prompt)</label>
                    <div className="flex flex-wrap gap-2">
                      {availableRefs.map((c) => {
                        const on = plan.refIds.includes(c.id);
                        return (
                          <button
                            key={c.id}
                            onClick={() =>
                              patchPlan({
                                refIds: on ? plan.refIds.filter((x) => x !== c.id) : [...plan.refIds, c.id],
                              })
                            }
                            className={`flex items-center gap-2 pl-1 pr-3 py-1 rounded-xl border text-sm font-semibold transition-colors ${
                              on
                                ? 'bg-gold-light border-gold-light text-gold-dark'
                                : 'border-stone-200 text-stone-400 hover:bg-stone-50'
                            }`}
                          >
                            <img
                              src={c.images[0].base64}
                              alt=""
                              className={`w-8 h-8 rounded-lg object-cover ${on ? '' : 'opacity-40 grayscale'}`}
                            />
                            {c.name || 'Chưa đặt tên'}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {warnings.length > 0 && (
                  <ul className="space-y-2">
                    {warnings.map((w) => (
                      <li
                        key={w}
                        className="flex items-start gap-2.5 text-[13px] text-amber-800 bg-amber-50 border border-amber-100 rounded-xl px-3.5 py-2.5 leading-relaxed"
                      >
                        <TriangleAlert size={14} className="shrink-0 mt-0.5" />
                        <span>{w}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* 4 panels theo đúng thứ tự đọc của lưới 2x2 */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {plan.panels.map((p, i) => (
                  <div
                    key={p.id}
                    className="bg-white rounded-[28px] border border-stone-200/60 p-5 shadow-sm space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <span className="w-7 h-7 rounded-lg bg-black text-gold text-xs font-black flex items-center justify-center">
                          {i + 1}
                        </span>
                        <select
                          value={p.role}
                          onChange={(e) => patchPanel(p.id, { role: e.target.value as PanelRole })}
                          className="bg-transparent text-base sm:text-xs font-bold text-stone-500 outline-none cursor-pointer"
                        >
                          {(Object.keys(ROLE_LABEL) as PanelRole[]).map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABEL[r]}
                            </option>
                          ))}
                        </select>
                        <span className="text-[11px] text-stone-300">
                          {fmtSec(timeline(plan)[i].start)}–{fmtSec(timeline(plan)[i].end)}s
                        </span>
                      </div>
                      <div className="flex items-center gap-0.5">
                        <button
                          onClick={() => movePanel(i, -1)}
                          disabled={i === 0}
                          className="p-2.5 md:p-1.5 text-stone-400 hover:text-gold-dark disabled:opacity-30 disabled:hover:text-stone-400 transition-colors"
                          title="Đưa lên trước"
                        >
                          <ArrowUp size={16} className="md:hidden" />
                          <ArrowLeft size={14} className="hidden md:block" />
                        </button>
                        <button
                          onClick={() => movePanel(i, 1)}
                          disabled={i === plan.panels.length - 1}
                          className="p-2.5 md:p-1.5 text-stone-400 hover:text-gold-dark disabled:opacity-30 disabled:hover:text-stone-400 transition-colors"
                          title="Đưa ra sau"
                        >
                          <ArrowDown size={16} className="md:hidden" />
                          <ArrowRight size={14} className="hidden md:block" />
                        </button>
                      </div>
                    </div>

                    <div>
                      <label className={fieldLabel}>Khoảnh khắc trong panel</label>
                      <textarea
                        className={`${fieldBase} h-20 resize-none`}
                        value={p.moment}
                        onChange={(e) => patchPanel(p.id, { moment: e.target.value })}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2.5">
                      <div>
                        <label className={fieldLabel}>Cỡ cảnh</label>
                        <input
                          className={fieldBase}
                          value={p.shotSize}
                          placeholder="Wide shot"
                          onChange={(e) => patchPanel(p.id, { shotSize: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className={fieldLabel}>Thời lượng (giây)</label>
                        <DurationInput
                          value={p.durationSec}
                          onChange={(v) => patchPanel(p.id, { durationSec: v })}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                      <div>
                        <label className={fieldLabel}>Người nói</label>
                        <input
                          className={fieldBase}
                          value={p.speaker}
                          onChange={(e) => patchPanel(p.id, { speaker: e.target.value })}
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label className={fieldLabel}>Thoại</label>
                        <input
                          className={fieldBase}
                          value={p.dialogue}
                          placeholder="Để trống nếu không có thoại"
                          onChange={(e) => patchPanel(p.id, { dialogue: e.target.value })}
                        />
                      </div>
                    </div>

                    <div>
                      <label className={fieldLabel}>Diễn ra giữa panel này và panel sau</label>
                      <textarea
                        className={`${fieldBase} h-14 resize-none`}
                        value={p.between}
                        onChange={(e) => patchPanel(p.id, { between: e.target.value })}
                      />
                    </div>
                  </div>
                ))}
              </div>

              <div className="lg:hidden sticky bottom-0 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 bg-white/95 backdrop-blur border-t border-stone-100">
                {blockReason && <p className="text-xs text-red-500 font-semibold mb-2">{blockReason}</p>}
                <button
                  onClick={handleGenerate}
                  disabled={busy || !!blockReason}
                  className="w-full py-4 bg-black text-gold rounded-[18px] font-black text-xs uppercase tracking-[0.15em] flex items-center justify-center gap-2 hover:bg-stone-900 disabled:bg-stone-100 disabled:text-stone-300 transition-all active:scale-[0.98] border border-gold/20"
                >
                  {isGenerating ? <Loader2 className="animate-spin w-4 h-4" /> : <ArrowRight size={16} />}
                  <span>
                    {result ? 'Tạo lại prompt' : 'Tạo prompt'} ({fmtSec(totalDuration(plan))}s)
                  </span>
                </button>
              </div>
            </section>

            {/* Generating */}
            {isGenerating && (
              <div className="flex items-center justify-center gap-3 py-16 text-stone-400 text-sm font-medium">
                <Loader2 className="animate-spin w-5 h-5 text-gold" />
                Đang viết prompt ảnh lưới và prompt video...
              </div>
            )}

            {/* Result */}
            {result && !isGenerating && (
              <section ref={resultRef} className="space-y-5 sm:space-y-6 pt-4 border-t border-stone-100 scroll-mt-2">
                <h2 className="text-xl sm:text-2xl font-black tracking-tight pt-4">Prompt</h2>

                {stale && (
                  <div className="flex items-start gap-2.5 text-[13px] text-amber-800 bg-amber-50 border border-amber-100 rounded-xl px-3.5 py-2.5 leading-relaxed">
                    <TriangleAlert size={14} className="shrink-0 mt-0.5" />
                    <span>
                      Plan hoặc tỉ lệ khung hình đã thay đổi sau lần tạo này. Các prompt bên dưới vẫn theo bản cũ, bấm Tạo lại prompt để cập nhật.
                    </span>
                  </div>
                )}

                {result.data.summaryVi && (
                  <div className="relative bg-stone-50/70 rounded-[28px] p-5 sm:p-7 border border-stone-100">
                    <Quote className="absolute top-6 right-6 text-stone-100 w-14 h-14 -rotate-12" />
                    <p className="relative text-stone-600 leading-relaxed text-[15px] font-medium italic max-w-2xl">
                      {result.data.summaryVi}
                    </p>
                  </div>
                )}

                <div>
                  <label className={fieldLabel}>Cách gắn ảnh tham chiếu</label>
                  <div className="bg-stone-50/80 p-1 rounded-2xl flex border border-stone-100/80 max-w-md">
                    {([
                      ['vars', 'Gán biến (Flow)'],
                      ['api', 'IMAGE_REF (API)'],
                    ] as [PromptFormat, string][]).map(([f, label]) => (
                      <button
                        key={f}
                        onClick={() => changeFormat(f)}
                        className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-all ${
                          promptFormat === f
                            ? 'bg-white text-black shadow-[0_2px_8px_rgba(0,0,0,0.04)] border border-stone-200/60'
                            : 'text-stone-400 hover:text-stone-600'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <PromptBlock
                  icon={<ImageIcon size={16} />}
                  title="Prompt ảnh lưới 2x2"
                  hint={promptFormat === 'vars' ? 'Dán vào công cụ tạo ảnh, rồi gõ @ sau mỗi dấu : để chọn ảnh' : 'Dán vào công cụ tạo ảnh, tải ảnh tham chiếu theo đúng thứ tự Ref'}
                  text={gridPrompt}
                />
                <PromptBlock
                  icon={<Video size={16} />}
                  title="Prompt video cho Omni 1.1 Flash"
                  hint={`Một prompt duy nhất, ${fmtSec(resultTotal)}s (tiếng Anh, có timecode)`}
                  text={videoPrompt}
                />

                {currentBeat && <GridImageCard image={currentBeat.gridImage} onChange={setGridImage} />}

                <EndStateCard endState={{ ...emptyEndState(), ...result.data.endState }} onChange={updateEndState} />

                <div className="bg-white rounded-[28px] border border-stone-200/60 shadow-sm p-5 sm:p-6">
                  <h3 className="text-sm font-black mb-4">Cách dùng</h3>
                  <ol className="space-y-4 text-sm text-stone-600 leading-relaxed">
                    <li className="flex gap-3">
                      <span className="w-6 h-6 rounded-full bg-gold-light text-gold-dark text-xs font-black flex items-center justify-center shrink-0">
                        1
                      </span>
                      <span>
                        {promptFormat === 'vars'
                          ? gridRefs.length > 0
                            ? `Tạo ảnh lưới: dán prompt ảnh. Ở các dòng khai báo đầu prompt, đặt con trỏ sau dấu hai chấm, gõ @ rồi chọn đúng ảnh: ${gridRefs.map((r) => `@${r.name} : ${r.label}`).join('; ')}.`
                            : 'Tạo ảnh lưới: dán prompt ảnh vào công cụ tạo ảnh.'
                          : gridRefs.length > 0
                            ? `Tạo ảnh lưới: tải ảnh theo thứ tự ${gridRefs.map((r) => `Ref ${r.index} = ${r.label}`).join(', ')}, rồi dán prompt ảnh.`
                            : 'Tạo ảnh lưới: dán prompt ảnh vào công cụ tạo ảnh.'}
                        {currentBeat && ' Tạo xong, tải ảnh lưới lên ô "Ảnh lưới đã tạo" bên trên để beat sau dùng làm mốc.'}
                      </span>
                    </li>
                    <li className="flex gap-3">
                      <span className="w-6 h-6 rounded-full bg-gold-light text-gold-dark text-xs font-black flex items-center justify-center shrink-0">
                        2
                      </span>
                      <span>
                        {promptFormat === 'vars'
                          ? `Tạo video: dán prompt video. Ở dòng "@storyboard :" gõ @ chọn ảnh lưới vừa tạo${resultRefs.length > 0 ? ', các dòng còn lại chọn ảnh tham chiếu như bước 1' : ''}.`
                          : `Tạo video: đính kèm ảnh lưới trước (Image1)${resultRefs.length > 0 ? `, sau đó ${resultRefs.map((r) => `${r.name} (Image${r.index + 1})`).join(', ')}` : ''}, rồi dán prompt video.`}
                      </span>
                    </li>
                    <li className="flex gap-3">
                      <span className="w-6 h-6 rounded-full bg-gold-light text-gold-dark text-xs font-black flex items-center justify-center shrink-0">
                        3
                      </span>
                      <span>
                        {`Chọn tỉ lệ ${result.aspect}. Nội dung dài ${fmtSec(resultTotal)}s: nếu dùng Flow, chọn ${[4, 6, 8, 10].find((x) => x >= resultTotal) ?? MAX_TOTAL_SEC}s (Flow có các mốc 4, 6, 8, 10 giây).`}
                      </span>
                    </li>
                  </ol>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {result.plan.panels.map((p, i) => {
                    const tl = timeline(result.plan)[i];
                    const img = result.data.imagePanels[i];
                    const vid = result.data.videoBeats[i];
                    return (
                      <div key={p.id} className="bg-white rounded-[28px] border border-stone-200/60 p-5 shadow-sm space-y-3">
                        <div className="flex items-center gap-2.5">
                          <span className="w-7 h-7 rounded-lg bg-black text-gold text-xs font-black flex items-center justify-center">
                            {i + 1}
                          </span>
                          <span className="text-xs font-bold text-stone-500">{ROLE_LABEL[p.role]}</span>
                          <span className="text-[11px] text-stone-300">
                            {fmtSec(tl.start)}–{fmtSec(tl.end)}s · {p.shotSize}
                          </span>
                        </div>
                        {img?.detailsVi && <p className="text-sm text-stone-600 leading-relaxed">{img.detailsVi}</p>}
                        {vid?.noteVi && (
                          <p className="text-sm text-stone-400 leading-relaxed italic">{vid.noteVi}</p>
                        )}
                        {p.dialogue && (
                          <p className="text-sm text-stone-700 border-l-2 border-gold pl-3">
                            {p.speaker ? <span className="font-bold">{p.speaker}: </span> : null}“{p.dialogue}”
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>

                {result.data.audioNoteVi && (
                  <p className="text-sm text-stone-500 leading-relaxed">
                    <span className="font-bold text-stone-700">Âm thanh: </span>
                    {result.data.audioNoteVi}
                  </p>
                )}
              </section>
            )}
          </div>
        )}
      </main>

      {/* Thanh tab cho màn hình nhỏ */}
      <nav className="lg:hidden shrink-0 grid grid-cols-2 border-t border-stone-200 bg-white">
        <button
          onClick={() => setMobileTab('beat')}
          className={`flex flex-col items-center gap-1 py-2.5 text-[11px] font-bold transition-colors ${
            mobileTab === 'beat' ? 'text-black' : 'text-stone-400'
          }`}
        >
          <PenLine size={20} className={mobileTab === 'beat' ? 'text-gold-dark' : ''} />
          Beat
        </button>
        <button
          onClick={() => setMobileTab('result')}
          className={`flex flex-col items-center gap-1 py-2.5 text-[11px] font-bold transition-colors ${
            mobileTab === 'result' ? 'text-black' : 'text-stone-400'
          }`}
        >
          <span className="relative">
            {busy ? (
              <Loader2 size={20} className="animate-spin text-gold" />
            ) : (
              <LayoutGrid size={20} className={mobileTab === 'result' ? 'text-gold-dark' : ''} />
            )}
            {plan && !busy && mobileTab !== 'result' && (
              <span className="absolute -top-0.5 -right-1.5 w-2 h-2 rounded-full bg-gold" />
            )}
          </span>
          Panel & Prompt
        </button>
      </nav>

      {/* History drawer */}
      <AnimatePresence>
        {showHistory && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowHistory(false)}
              className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40"
            />
            <motion.aside
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              className="fixed top-0 right-0 h-full w-full sm:w-[480px] bg-white shadow-2xl z-50 flex flex-col"
            >
              <div className="p-5 sm:p-8 flex items-center justify-between border-b border-stone-100">
                <h2 className="text-xl font-black tracking-tight">Lịch sử beat</h2>
                <button
                  onClick={() => setShowHistory(false)}
                  className="p-2 text-stone-400 hover:text-black hover:bg-stone-50 rounded-xl transition-all"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 sm:p-8 space-y-4 sm:space-y-6 scrollbar-hide">
                {history.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center p-12">
                    <div className="w-20 h-20 bg-stone-50 rounded-[32px] flex items-center justify-center mb-6">
                      <History size={32} strokeWidth={1} className="text-stone-200" />
                    </div>
                    <h3 className="text-lg font-black text-black mb-2">Chưa có lịch sử</h3>
                    <p className="text-stone-400 text-sm font-medium leading-relaxed">
                      Các beat đã tạo prompt sẽ xuất hiện ở đây.
                    </p>
                  </div>
                ) : (
                  history.map((item, index) => (
                    <motion.div
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.05 }}
                      key={item.id}
                      className="group bg-white rounded-[32px] border border-stone-200/60 p-5 sm:p-6 shadow-sm hover:shadow-xl hover:shadow-stone-200/30 transition-all relative overflow-hidden"
                    >
                      <div className="absolute top-0 left-0 w-1 h-full bg-gold opacity-0 group-hover:opacity-100 transition-opacity" />

                      <div className="flex items-start justify-between mb-4">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <div className="px-3 py-1 bg-gold-light text-gold-dark text-[10px] font-black rounded-lg border border-gold-light uppercase tracking-widest">
                            Beat {history.length - index}
                          </div>
                          <span className="text-[11px] font-semibold text-stone-300">
                            {new Date(item.timestamp).toLocaleDateString()} · {fmtSec(totalDuration(item.plan))}s · {item.aspect}
                          </span>
                        </div>
                        <button
                          onClick={async () => {
                            if (await ask('Xóa beat này khỏi lịch sử?')) {
                              setHistory((prev) => prev.filter((h) => h.id !== item.id));
                            }
                          }}
                          className="p-2 text-stone-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all lg:opacity-0 lg:group-hover:opacity-100"
                          title="Xóa"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>

                      <div className="flex gap-3 mb-4">
                        {item.gridImage && (
                          <img
                            src={item.gridImage.base64}
                            alt=""
                            className="w-24 h-16 rounded-xl object-cover border border-stone-100 shrink-0"
                          />
                        )}
                        <p className="text-sm text-stone-600 font-medium leading-relaxed line-clamp-3 italic">
                          “{item.scriptText}”
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 mb-3">
                        <CopyButton
                          text={buildGridImagePrompt(item.plan, item.generatedData, characters, item.aspect, promptFormat)}
                          label="Prompt ảnh"
                        />
                        <CopyButton
                          text={buildVideoPrompt(item.plan, item.generatedData, characters, promptFormat)}
                          label="Prompt video"
                        />
                      </div>

                      <button
                        onClick={() => restoreFromHistory(item)}
                        className="w-full py-3 bg-stone-50 text-black rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-black hover:text-gold transition-all"
                      >
                        Khôi phục beat
                      </button>
                    </motion.div>
                  ))
                )}
              </div>

              <div className="p-5 sm:p-8 border-t border-stone-100 bg-stone-50/50">
                <p className="text-[11px] font-semibold text-stone-400 text-center leading-relaxed">
                  Lịch sử được tự lưu trên trình duyệt này. Bấm nút Lưu project để giữ một bản ra file.
                </p>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {confirmDialog}

      <SettingsModal
        open={showSettings}
        onClose={() => setShowSettings(false)}
        onSaved={() => {
          setError('');
          setSettingsVersion((v) => v + 1);
        }}
      />
    </div>
  );
}
