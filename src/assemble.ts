import type {
  AspectRatio,
  BeatSequence,
  Character,
  EndState,
  GeneratedData,
  PanelPlan,
  PanelRole,
  PromptFormat,
  SceneBible,
} from './types.ts';
import { newId } from './id.ts';

// Giới hạn của Gemini Omni 1.1 Flash: mỗi lần tạo tối đa 10 giây.
export const MIN_TOTAL_SEC = 6;
export const MAX_TOTAL_SEC = 10;
export const MIN_PANEL_SEC = 1.5;

export const PANEL_ROLES: PanelRole[] = ['setup', 'action', 'peak', 'consequence'];
export const GRID_POSITIONS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

const round1 = (n: number) => Math.round(n * 10) / 10;
export const fmtSec = (n: number) => String(round1(n));

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/**
 * Bỏ dấu ngoặc kép. Với Omni (và model tạo ảnh của Google), chữ trong ngoặc kép bị hiểu là chữ
 * cần hiện lên hình, nên thoại viết trong ngoặc kép sẽ thành phụ đề thay vì được nói.
 */
export const stripQuotes = (t: string): string => t.replace(/["“”„«»]/g, '');

/** Thêm dấu chấm cuối câu nếu thiếu, để ghép câu không bị dính. */
const sentence = (t: string): string => {
  const x = t.trim();
  return x && !/[.!?…"”]$/.test(x) ? `${x}.` : x;
};

/** Viết hoa chữ cái đầu câu ("first @cho leaps" -> "First @cho leaps"). */
const capFirst = (t: string): string => t.replace(/^\p{Ll}/u, (c) => c.toUpperCase());
/** Viết thường chữ đầu khi ghép vào giữa câu ("Wide shot" -> "wide shot"), giữ nguyên chữ viết tắt. */
const lcFirst = (t: string): string => t.replace(/^([A-Z])(?=[a-z])/, (c) => c.toLowerCase());

// --- Thời lượng ---
export function totalDuration(plan: PanelPlan): number {
  return round1(
    plan.panels.reduce((sum, p) => sum + (Number.isFinite(p.durationSec) ? p.durationSec : 0), 0),
  );
}

/** Độ dài clip cần chọn trong Flow (4, 6, 8 hoặc 10 giây) cho tổng thời lượng của plan. */
export const clipSeconds = (total: number): number =>
  [4, 6, 8, 10].find((x) => x >= total - 0.05) ?? MAX_TOTAL_SEC;

export function timeline(plan: PanelPlan): { start: number; end: number }[] {
  let t = 0;
  return plan.panels.map((p) => {
    const start = t;
    t = round1(t + (Number.isFinite(p.durationSec) ? p.durationSec : 0));
    return { start, end: t };
  });
}

const VI_CHARS =
  /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;

/**
 * Ước lượng số giây cần để nói hết câu thoại.
 * Đây chỉ là ước lượng: ~2.5 từ/giây với tiếng Anh, ~4 âm tiết/giây với tiếng Việt.
 */
export function speechSeconds(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  if (!words) return 0;
  const rate = VI_CHARS.test(text) ? 4 : 2.5;
  return round1(words / rate);
}

/** Cảnh báo tính bằng code (không cần hỏi AI), chạy lại mỗi khi người dùng sửa plan. */
export function analyzePlan(plan: PanelPlan): string[] {
  const out: string[] = [];
  const total = totalDuration(plan);

  if (plan.panels.length !== 4) out.push(`Cần đúng 4 panel (hiện có ${plan.panels.length}).`);

  if (total > MAX_TOTAL_SEC) {
    out.push(
      `Tổng thời lượng ${fmtSec(total)}s vượt giới hạn ${MAX_TOTAL_SEC}s của Omni. Hãy giảm thời lượng các panel hoặc tách beat.`,
    );
  } else if (total < MIN_TOTAL_SEC) {
    out.push(
      `Tổng thời lượng ${fmtSec(total)}s hơi ngắn (nên từ ${MIN_TOTAL_SEC}s). Có thể thêm nội dung hoặc kéo dài khoảng lặng.`,
    );
  }

  plan.panels.forEach((p, i) => {
    const n = i + 1;
    if (!p.moment.trim()) out.push(`Panel ${n} chưa có nội dung.`);
    if (p.durationSec < MIN_PANEL_SEC) {
      out.push(`Panel ${n} chỉ ${fmtSec(p.durationSec)}s, dưới ${MIN_PANEL_SEC}s nên khó thể hiện rõ.`);
    }
    const need = speechSeconds(p.dialogue);
    if (need > p.durationSec) {
      out.push(
        `Panel ${n}: thoại cần khoảng ${fmtSec(need)}s (ước lượng) nhưng panel chỉ có ${fmtSec(p.durationSec)}s. Thoại quá dài có thể khiến video bị cắt giữa chừng.`,
      );
    }
  });

  return out;
}

/** Chặn tạo prompt khi plan chắc chắn không dùng được. */
export function planBlockReason(plan: PanelPlan): string | null {
  if (plan.panels.length !== 4) return 'Cần đúng 4 panel.';
  if (plan.panels.some((p) => !p.moment.trim())) return 'Mỗi panel cần có nội dung.';
  const bad = plan.panels.findIndex((p) => !(Number.isFinite(p.durationSec) && p.durationSec > 0));
  if (bad >= 0) return `Panel ${bad + 1} cần thời lượng lớn hơn 0 giây.`;
  if (totalDuration(plan) > MAX_TOTAL_SEC) return `Tổng thời lượng phải ≤ ${MAX_TOTAL_SEC}s.`;
  return null;
}

// --- Tham chiếu (nhân vật và vật dụng) ---
export const STORYBOARD_VAR = 'storyboard';
/** Tên biến của ảnh bối cảnh và ảnh lưới beat trước trong prompt ảnh lưới */
export const LOCATION_VAR = 'location';
export const PREV_GRID_VAR = 'prev_storyboard';

export interface RefInfo {
  id: string;
  /** Tên biến trong prompt */
  name: string;
  /** Cụm danh từ tiếng Anh, ví dụ "the mastiff dog" (có thể trống) */
  en: string;
  /** Thứ tự 1, 2, 3... trong số các tham chiếu của beat (ảnh lưới là IMAGE_REF_0) */
  index: number;
}

/** Tham chiếu có ảnh, theo thứ tự trong app. Nếu truyền refIds thì chỉ lấy những cái có trong beat. */
export function refCharacters(characters: Character[], refIds?: string[]): Character[] {
  const withImage = characters.filter((c) => c.images.length > 0);
  return refIds ? withImage.filter((c) => refIds.includes(c.id)) : withImage;
}

export function buildRefs(
  characters: Character[],
  refIds: string[],
  descriptors: Record<string, string> = {},
): RefInfo[] {
  const used = new Set<string>([STORYBOARD_VAR, LOCATION_VAR, PREV_GRID_VAR]);
  return refCharacters(characters, refIds).map((c, i) => {
    // Tên biến phải khác nhau, nếu trùng thì thêm hậu tố _2, _3...
    const base = c.name.trim() || `ref${i + 1}`;
    let name = base;
    for (let k = 2; used.has(name.toLowerCase()); k++) name = `${base}_${k}`;
    used.add(name.toLowerCase());
    return { id: c.id, name, en: (descriptors[c.id] ?? '').trim(), index: i + 1 };
  });
}

/** Tên tham chiếu trùng nhau (không phân biệt hoa thường) sẽ làm biến trong prompt bị nhầm. */
export function duplicateRefNames(characters: Character[]): string[] {
  const seen = new Map<string, number>();
  refCharacters(characters).forEach((c) => {
    const k = c.name.trim().toLowerCase();
    if (k) seen.set(k, (seen.get(k) ?? 0) + 1);
  });
  return [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Ký tự thuộc một từ (gồm cả chữ có dấu tiếng Việt). */
const WORD = '[\\p{L}\\p{M}\\p{N}_]';

/** Tên đứng thành từ riêng: "an" không khớp với "bạn", "meo" không khớp với "meow". */
const hasWord = (script: string, name: string) =>
  new RegExp(`(^|[^\\p{L}\\p{M}\\p{N}_])${escapeRe(name)}(?!${WORD})`, 'iu').test(script);

const isWordChar = (ch: string | undefined) => !!ch && /[\p{L}\p{M}\p{N}_]/u.test(ch);

/** Bỏ dấu và chữ hoa để "@Chó" khớp với tham chiếu tên "cho". Giữ nguyên độ dài chuỗi (dạng NFC). */
const fold = (s: string) =>
  Array.from(s, (ch) => ch.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').replace(/Đ/g, 'D') || ch)
    .join('')
    .toLowerCase();

export type ScriptPart =
  | { kind: 'text'; text: string }
  | { kind: 'ref'; ref: Character; raw: string }
  | { kind: 'unknown'; name: string };

/**
 * Tách kịch bản thành đoạn chữ thường và các @mention.
 * @tên khớp với tham chiếu có ảnh (không phân biệt hoa thường, có dấu hay không dấu; tên dài được ưu tiên).
 * @tên không khớp tham chiếu nào được trả về dạng "unknown". Không tính @ nằm giữa từ, ví dụ email.
 */
export function parseScript(scriptText: string, characters: Character[]): ScriptPart[] {
  const text = scriptText.normalize('NFC');
  const refs = refCharacters(characters)
    .map((c) => ({ c, key: fold(c.name.normalize('NFC').trim()) }))
    .filter((r) => r.key !== '')
    .sort((a, b) => b.key.length - a.key.length);

  const parts: ScriptPart[] = [];
  let buf = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] === '@' && !isWordChar(text[i - 1])) {
      const hit = refs.find(({ key }) => {
        const end = i + 1 + key.length;
        return fold(text.slice(i + 1, end)) === key && !isWordChar(text[end]);
      });
      if (hit) {
        if (buf) parts.push({ kind: 'text', text: buf });
        buf = '';
        const len = 1 + hit.key.length;
        parts.push({ kind: 'ref', ref: hit.c, raw: text.slice(i, i + len) });
        i += len;
        continue;
      }
      const word = /^[\p{L}\p{M}\p{N}_]+/u.exec(text.slice(i + 1))?.[0];
      if (word) {
        if (buf) parts.push({ kind: 'text', text: buf });
        buf = '';
        parts.push({ kind: 'unknown', name: word });
        i += 1 + word.length;
        continue;
      }
    }
    buf += text[i];
    i++;
  }
  if (buf) parts.push({ kind: 'text', text: buf });
  return parts;
}

/** Tham chiếu được @ trong kịch bản (theo thứ tự xuất hiện, không trùng) và các @tên không khớp. */
export function scriptMentions(scriptText: string, characters: Character[]) {
  const refs: Character[] = [];
  const unknown: string[] = [];
  parseScript(scriptText, characters).forEach((p) => {
    if (p.kind === 'ref' && !refs.includes(p.ref)) refs.push(p.ref);
    if (p.kind === 'unknown' && !unknown.includes(p.name)) unknown.push(p.name);
  });
  return { refs, unknown };
}

/** Viết lại mọi @mention theo đúng tên tham chiếu ("@Chó" -> "@cho") trước khi gửi cho AI. */
export function canonicalScript(scriptText: string, characters: Character[]): string {
  return parseScript(scriptText, characters)
    .map((p) => (p.kind === 'text' ? p.text : p.kind === 'ref' ? `@${p.ref.name.trim()}` : `@${p.name}`))
    .join('');
}

/**
 * Đoán tham chiếu dùng trong beat: tên AI trả về + tên xuất hiện trong kịch bản.
 * Nếu kịch bản có dùng @mention thì chỉ tính các @mention, vì tên biến như "cho"
 * trùng với từ thường gặp trong tiếng Việt.
 */
export function detectRefIds(characters: Character[], scriptText: string, aiNames: string[]): string[] {
  const script = scriptText.normalize('NFC');
  const ai = aiNames.map((n) => fold(n.normalize('NFC').trim())).filter(Boolean);
  const mentioned = new Set(scriptMentions(script, characters).refs.map((c) => c.id));
  return refCharacters(characters)
    .filter((c) => {
      const name = c.name.normalize('NFC').trim();
      if (!name) return false;
      if (ai.includes(fold(name))) return true;
      return mentioned.size ? mentioned.has(c.id) : hasWord(script, name);
    })
    .map((c) => c.id);
}

// --- Hồ sơ cảnh ---
export const emptyBible = (): SceneBible => ({
  enabled: false,
  style: '',
  location: '',
  blocking: '',
  descriptors: {},
});

export const hasBibleContent = (b: SceneBible): boolean =>
  !!(b.style.trim() || b.location.trim() || b.blocking.trim() || b.locationImage) ||
  Object.values(b.descriptors).some((d) => !!d.trim());

/** Hồ sơ cảnh đang được áp dụng (bật và có nội dung), hoặc null. */
export function activeBible(b: SceneBible | null | undefined): SceneBible | null {
  return b?.enabled && hasBibleContent(b) ? b : null;
}

/** Dấu vân tay của hồ sơ cảnh, để biết prompt đã tạo có còn khớp không. */
export const bibleKey = (b: SceneBible | null | undefined): string => {
  const a = activeBible(b);
  const img = a?.locationImage ? `${a.locationImage.base64.length}:${a.locationImage.base64.slice(-24)}` : '';
  return a ? JSON.stringify([a.style, a.location, a.blocking, a.descriptors, img]) : '';
};

/** "@cho" trong hồ sơ cảnh -> "{{cho}}" để được đổi theo định dạng prompt giống chữ do AI viết. */
export const mentionsToTokens = (text: string, characters: Character[]): string =>
  parseScript(text, characters)
    .map((p) => (p.kind === 'text' ? p.text : p.kind === 'ref' ? `{{${p.ref.name.trim()}}}` : `@${p.name}`))
    .join('');

/** "{{cho}}" -> "@cho", dùng khi lấy phong cách từ một beat đã tạo vào hồ sơ cảnh. */
export const tokensToMentions = (text: string): string =>
  text.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, n: string) => `@${n.trim()}`);

/**
 * Áp hồ sơ cảnh lên kết quả AI: phong cách và mô tả tham chiếu lấy nguyên văn từ hồ sơ
 * (AI không được viết lại), bối cảnh và hướng nhân vật được lưu kèm để ghép vào prompt.
 */
export function applyBible(
  data: GeneratedData,
  bible: SceneBible | null,
  characters: Character[],
  refs: RefInfo[],
): GeneratedData {
  const b = activeBible(bible);
  if (!b) return data;
  const descriptors = { ...data.descriptors };
  refs.forEach((r) => {
    const d = (b.descriptors[r.id] ?? '').trim();
    if (d) descriptors[r.id] = d;
  });
  return {
    ...data,
    styleBlock: b.style.trim() ? mentionsToTokens(b.style.trim(), characters) : data.styleBlock,
    descriptors,
    scene: {
      location: mentionsToTokens(b.location.trim(), characters),
      blocking: mentionsToTokens(b.blocking.trim(), characters),
    },
  };
}

type TokenMode = 'plain' | 'apiImage' | 'apiVideo';

/** Chế độ Gán biến (Flow): tên luôn có @ phía trước để không bị hiểu nhầm thành từ tiếng Anh. */
export const atName = (name: string) => `@${name}`;

/**
 * AI viết tham chiếu dưới dạng {{tên}}. Hàm này đổi token theo định dạng:
 * plain -> @cho, apiImage -> cho (Ref 1), apiVideo -> cho <IMAGE_REF_1>.
 */
export function renderTokens(text: string, refs: RefInfo[], mode: TokenMode): string {
  return text.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, raw: string) => {
    const r = refs.find((x) => x.name.toLowerCase() === raw.trim().toLowerCase());
    if (!r) return raw.trim();
    if (mode === 'apiImage') return `${r.name} (Ref ${r.index})`;
    if (mode === 'apiVideo') return `${r.name} <IMAGE_REF_${r.index}>`;
    return atName(r.name);
  });
}

/** Bỏ dấu câu ở cuối, dùng khi ghép nhiều mục bằng dấu chấm phẩy. */
const bare = (t: string): string => t.trim().replace(/[\s.;,!]+$/, '');

const listJoin = (items: string[]): string => items.join('; ');

/** "cho is the mastiff dog; meo is the Siamese cat." */
function identityLine(refs: RefInfo[], mode: TokenMode): string {
  const parts = refs.map((r) => {
    const label = mode === 'apiVideo' ? `${r.name} <IMAGE_REF_${r.index}>` : mode === 'apiImage' ? `${r.name} (Ref ${r.index})` : atName(r.name);
    return r.en ? `${label} is ${bare(r.en)}` : label;
  });
  return `${listJoin(parts)}.`;
}

/** Ảnh mốc thêm vào prompt ảnh lưới, đánh số tiếp sau các tham chiếu nhân vật/vật dụng. */
export interface AnchorRef {
  kind: 'location' | 'prevGrid';
  name: string;
  index: number;
}

export function anchorRefs(refs: RefInfo[], data: GeneratedData): AnchorRef[] {
  const out: AnchorRef[] = [];
  if (data.anchors?.location) out.push({ kind: 'location', name: LOCATION_VAR, index: refs.length + out.length + 1 });
  if (data.anchors?.prevGrid) out.push({ kind: 'prevGrid', name: PREV_GRID_VAR, index: refs.length + out.length + 1 });
  return out;
}

/** Mọi ảnh cần gắn khi tạo ảnh lưới, theo đúng thứ tự Ref 1, 2, 3... (dùng cho phần hướng dẫn). */
export function gridImageRefs(plan: PanelPlan, data: GeneratedData, characters: Character[]) {
  const refs = buildRefs(characters, plan.refIds, data.descriptors);
  return [
    ...refs.map((r) => ({ name: r.name, index: r.index, label: r.name })),
    ...anchorRefs(refs, data).map((a) => ({
      name: a.name,
      index: a.index,
      label: a.kind === 'location' ? 'ảnh bối cảnh' : 'ảnh lưới của beat trước',
    })),
  ];
}

// --- Ghép prompt cuối ---
// Bố cục theo hướng dẫn prompt của Nano Banana và Gemini Omni (đã thử thực tế trên Flow):
// phong cách nêu trước, bối cảnh chỉ nói một lần, thay đổi so với ảnh tham chiếu đặt ngay sau phần nhân vật,
// câu "không có chữ" viết dạng mô tả điều mong muốn thay vì liệt kê điều cấm.
export function buildGridImagePrompt(
  plan: PanelPlan,
  data: GeneratedData,
  characters: Character[],
  aspect: AspectRatio,
  format: PromptFormat,
): string {
  const refs = buildRefs(characters, plan.refIds, data.descriptors);
  const mode: TokenMode = format === 'api' ? 'apiImage' : 'plain';
  const r = (t: string) => stripQuotes(renderTokens(t, refs, mode));
  const anchors = anchorRefs(refs, data);
  const label = (a: AnchorRef) => (format === 'api' ? `${a.name} (Ref ${a.index})` : atName(a.name));
  const loc = anchors.find((a) => a.kind === 'location');
  const prev = anchors.find((a) => a.kind === 'prevGrid');
  const locationText = data.scene?.location ? bare(r(data.scene.location)) : '';
  // Bối cảnh đã cố định (ảnh hoặc hồ sơ cảnh) thì không tả lại bối cảnh riêng cho từng panel, tránh lệch nhau.
  const setLocked = !!loc || !!locationText;
  const out: string[] = [];

  if (format === 'vars' && refs.length + anchors.length) {
    out.push([...refs, ...anchors].map((x) => `${atName(x.name)} :`).join('\n'));
  }

  const style = bare(r(data.styleBlock));
  out.push(
    `A 2x2 storyboard sheet: four equal ${aspect} panels read left to right, top to bottom, with thin white gutters. The four panels are consecutive keyframes of one continuous scene.${
      style ? ` ${sentence(style)} Keep this look identical in all four panels.` : ''
    }`,
  );

  const cast = refs.length
    ? format === 'api'
      ? `Cast (attached in this order), matching each reference image exactly: ${identityLine(refs, 'apiImage')}`
      : `Cast, matching each reference image exactly: ${identityLine(refs, 'plain')}`
    : '';
  const changed = data.continuityEn ? `Changed since the references: ${sentence(r(data.continuityEn))}` : '';
  if (cast || changed) out.push([cast, changed].filter(Boolean).join('\n'));

  const set = loc
    ? locationText
      ? `Set: build it exactly like ${label(loc)}, ${lcFirst(locationText)}.`
      : `Set: build it exactly like ${label(loc)}, with the same layout, furniture, materials, colours and light sources.`
    : locationText
      ? `Set: ${sentence(locationText)}`
      : `Scene: ${sentence(r(data.sceneEn))}`;
  out.push([set, data.scene?.blocking ? sentence(r(data.scene.blocking)) : ''].filter(Boolean).join(' '));

  if (prev) {
    out.push(
      `${label(prev)} is the previous beat: same art style, characters, set and lighting. Panel 1 continues from its bottom-right panel; compose new panels rather than copying it.`,
    );
  }

  out.push(
    data.imagePanels
      .map((p, i) => {
        const shot = [bare(r(p.framing)), bare(r(p.lens))].filter(Boolean).join(', ');
        const setting = !setLocked && p.environment ? ` Setting: ${sentence(r(p.environment))}` : '';
        return `Panel ${i + 1} (${GRID_POSITIONS[i]})${shot ? `, ${lcFirst(shot)}` : ''}: ${capFirst(sentence(r(p.content)))}${setting}`;
      })
      .join('\n'),
  );

  out.push('Clean frames: every surface is plain, with no lettering, numbers, captions or logos anywhere.');
  return out.join('\n\n');
}

export function buildVideoPrompt(
  plan: PanelPlan,
  data: GeneratedData,
  characters: Character[],
  format: PromptFormat,
): string {
  const refs = buildRefs(characters, plan.refIds, data.descriptors);
  const mode: TokenMode = format === 'api' ? 'apiVideo' : 'plain';
  const r = (t: string) => stripQuotes(renderTokens(t, refs, mode));
  const clip = clipSeconds(totalDuration(plan));
  // Panel cuối kéo dài tới hết clip (vd. plan 9.5s, clip Flow 10s), để không có khoảng trống không được mô tả.
  const tl = timeline(plan).map((t, i, all) => (i === all.length - 1 && clip > t.end ? { ...t, end: clip } : t));
  const lines = plan.panels.filter((p) => p.dialogue.trim()).length;
  const board = format === 'api' ? '<IMAGE_REF_0>' : atName(STORYBOARD_VAR);
  const out: string[] = [];
  // Người nói trùng tên một tham chiếu thì viết như tham chiếu (@cho), còn lại giữ nguyên.
  const speakerName = (speaker: string) => {
    const ref = refs.find((x) => fold(x.name) === fold(speaker.replace(/^@/, '')));
    return ref ? r(`{{${ref.name}}}`) : stripQuotes(speaker);
  };

  if (format === 'vars') {
    out.push([STORYBOARD_VAR, ...refs.map((x) => x.name)].map((n) => `${atName(n)} :`).join('\n'));
  } else {
    const decl = [0, ...refs.map((x) => x.index)].map((n) => `<IMAGE_REF_${n}>@Image${n + 1}`).join(' ');
    out.push(`[# References ${decl}]`);
  }
  out.push('');

  out.push(
    `Follow ${board} exactly, in order starting top left: panel 1 is the opening, panel 4 is the ending. Use it only as a guide for composition, action and camera; never show the grid or its borders. The whole story takes ${fmtSec(clip)} seconds ${
      plan.editMode === 'continuous'
        ? 'in one single continuous shot with no cuts.'
        : 'with a hard cut between panels, one clean shot per panel.'
    }`,
  );
  const cast = refs.length ? `Cast: ${identityLine(refs, mode)}` : '';
  const changed = data.continuityEn ? `Changed since the references: ${sentence(r(data.continuityEn))}` : '';
  if (cast || changed) out.push([cast, changed].filter(Boolean).join(' '));
  // Một câu ngắn về phong cách, ánh sáng, bối cảnh: chi tiết đã có trong ảnh lưới, Omni chỉ cần định hướng.
  const look = data.videoLookEn
    ? sentence(r(data.videoLookEn))
    : [sentence(r(data.styleBlock)), data.scene?.location ? sentence(r(data.scene.location)) : ''].filter(Boolean).join(' ');
  const blocking = data.scene?.blocking ? sentence(r(data.scene.blocking)) : '';
  if (look || blocking) out.push([look, blocking].filter(Boolean).join(' '));
  out.push('');

  data.videoBeats.forEach((b, i) => {
    const t = tl[i];
    const p = plan.panels[i];
    if (!t || !p) return;
    let line = `[${fmtSec(t.start)}-${fmtSec(t.end)}s] (panel ${i + 1}) ${capFirst(sentence(r(b.camera)))} ${capFirst(sentence(r(b.action)))}`.trim();
    if (p.dialogue.trim()) {
      // Omni: dấu hai chấm + thoại KHÔNG ngoặc kép = lời nói; có ngoặc kép = chữ hiện trên hình.
      line += ` ${speakerName(p.speaker.trim()) || 'The character'} says: ${sentence(stripQuotes(p.dialogue.trim()))}`;
    }
    out.push(line);
  });
  out.push('');

  const { ambience, music, sfx } = data.audio;
  const isNone = (x: string) => !x || /^(none|no|silence|n\/a)$/i.test(x);
  const sounds = [bare(ambience), bare(sfx)].filter((x) => !isNone(x));
  const m = bare(music);
  out.push(`Audio: ${[sounds.join(', '), isNone(m) ? 'no music' : `music: ${m}`].filter(Boolean).join('; ')}.`);
  out.push(
    `No subtitles or on-screen text. ${
      lines ? `Only the ${lines > 1 ? 'lines above are' : 'line above is'} spoken.` : 'No dialogue.'
    }`,
  );
  // Google khuyên đặt câu chỉ dẫn về vai trò ảnh ở cuối prompt.
  out.push(
    format === 'api'
      ? 'Use the images only as references for this video, not as first frames.'
      : `Use ${[STORYBOARD_VAR, ...refs.map((x) => x.name)].map(atName).join(', ')} only as references for this video, not as first frames.`,
  );

  return out.join('\n').replace(/\n\n\n+/g, '\n\n').trim();
}

/** Tóm tắt trạng thái cuối của beat trước để beat sau nối tiếp liền mạch. */
export function describePreviousBeat(seq: BeatSequence): string {
  const panels = seq.plan.panels;
  const last = panels[panels.length - 1];
  const img = seq.generatedData.imagePanels[seq.generatedData.imagePanels.length - 1];
  const vid = seq.generatedData.videoBeats[seq.generatedData.videoBeats.length - 1];
  const end = seq.generatedData.endState;
  return [
    `Previous beat summary: ${seq.plan.beatSummary}`,
    last ? `Final panel of the previous beat: ${last.moment}` : '',
    img ? `Final panel visuals: ${img.content} Setting: ${img.environment}` : '',
    vid ? `Final video beat: ${vid.action}` : '',
    end && hasEndState(end)
      ? [
          'END STATE of the previous beat (authoritative; panel 1 of this beat must start exactly from it; where it differs from the scene bible, the END STATE wins):',
          end.positions ? `- Positions, poses, facing: ${end.positions}` : '',
          end.props ? `- Props: ${end.props}` : '',
          end.changes ? `- Changes that persist: ${end.changes}` : '',
        ]
          .filter(Boolean)
          .join('\n')
      : '',
    `Established style: ${seq.generatedData.styleBlock}`,
  ]
    .filter(Boolean)
    .join('\n');
}

export const emptyEndState = (): EndState => ({ positions: '', props: '', changes: '' });

export const hasEndState = (e: EndState | undefined): boolean =>
  !!e && !!(e.positions.trim() || e.props.trim() || e.changes.trim());

// --- Chuẩn hóa dữ liệu AI trả về (không tin tuyệt đối vào schema) ---
export function normalizePlan(raw: any, refIds: string[]): PanelPlan {
  const rawPanels: any[] = Array.isArray(raw?.panels) ? raw.panels : [];
  const notes: string[] = [];
  if (rawPanels.length > 4) notes.push(`AI trả về ${rawPanels.length} panel, đã giữ 4 panel đầu.`);
  if (rawPanels.length < 4) {
    notes.push(`AI chỉ trả về ${rawPanels.length} panel, đã thêm panel trống để bạn tự điền.`);
  }

  const panels = Array.from({ length: 4 }, (_, i) => {
    const p = rawPanels[i] ?? {};
    const dur = Number(p.durationSec);
    return {
      id: newId(),
      role: PANEL_ROLES.includes(p.role) ? (p.role as PanelRole) : PANEL_ROLES[i],
      moment: str(p.moment),
      shotSize: str(p.shotSize),
      durationSec: Number.isFinite(dur) && dur > 0 ? round1(dur) : 2.5,
      speaker: str(p.speaker),
      dialogue: str(p.dialogue),
      between: str(p.between),
    };
  });

  const aiWarnings: string[] = Array.isArray(raw?.warnings) ? raw.warnings.map(str).filter(Boolean) : [];

  return {
    beatSummary: str(raw?.beatSummary),
    editMode: raw?.editMode === 'cuts' ? 'cuts' : 'continuous',
    refIds,
    panels,
    warnings: [...aiWarnings, ...notes],
  };
}

export function normalizeGenerated(raw: any, refs: RefInfo[]): GeneratedData {
  const imgs: any[] = Array.isArray(raw?.imagePanels) ? raw.imagePanels : [];
  const vids: any[] = Array.isArray(raw?.videoBeats) ? raw.videoBeats : [];
  const descs: any[] = Array.isArray(raw?.refDescriptors) ? raw.refDescriptors : [];

  const descriptors: Record<string, string> = {};
  descs.forEach((d) => {
    const ref = refs.find((r) => r.name.toLowerCase() === str(d?.name).toLowerCase());
    if (ref && str(d?.en)) descriptors[ref.id] = str(d.en);
  });

  return {
    summaryVi: str(raw?.summaryVi),
    sceneEn: str(raw?.sceneEn),
    styleBlock: str(raw?.styleBlock),
    descriptors,
    imagePanels: Array.from({ length: 4 }, (_, i) => {
      const p = imgs[i] ?? {};
      return {
        n: i + 1,
        framing: str(p.framing),
        content: str(p.content),
        environment: str(p.environment),
        lens: str(p.lens),
        detailsVi: str(p.detailsVi),
      };
    }),
    videoBeats: Array.from({ length: 4 }, (_, i) => {
      const b = vids[i] ?? {};
      return { n: i + 1, camera: str(b.camera), action: str(b.action), noteVi: str(b.noteVi) };
    }),
    audio: {
      ambience: str(raw?.audio?.ambience),
      music: str(raw?.audio?.music),
      sfx: str(raw?.audio?.sfx),
    },
    audioNoteVi: str(raw?.audioNoteVi),
    continuityEn: str(raw?.continuityEn),
    videoLookEn: str(raw?.videoLookEn),
    endState: {
      positions: str(raw?.endState?.positions),
      props: str(raw?.endState?.props),
      changes: str(raw?.endState?.changes),
    },
  };
}

/** Dấu vân tay của plan, dùng để biết prompt đã tạo có còn khớp với plan hiện tại không. */
export function planKey(plan: PanelPlan): string {
  return JSON.stringify({
    m: plan.editMode,
    s: plan.beatSummary,
    r: [...plan.refIds].sort(),
    p: plan.panels.map(({ role, moment, shotSize, durationSec, speaker, dialogue, between }) => [
      role,
      moment,
      shotSize,
      durationSec,
      speaker,
      dialogue,
      between,
    ]),
  });
}
