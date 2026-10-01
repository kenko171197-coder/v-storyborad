import type {
  AspectRatio,
  BeatSequence,
  Character,
  GeneratedData,
  PanelPlan,
  PanelRole,
  PromptFormat,
} from './types.ts';

// Giới hạn của Gemini Omni 1.1 Flash: mỗi lần tạo tối đa 10 giây.
export const MIN_TOTAL_SEC = 6;
export const MAX_TOTAL_SEC = 10;
export const MIN_PANEL_SEC = 1.5;

export const PANEL_ROLES: PanelRole[] = ['setup', 'action', 'peak', 'consequence'];
export const GRID_POSITIONS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

const round1 = (n: number) => Math.round(n * 10) / 10;
export const fmtSec = (n: number) => String(round1(n));

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** Thêm dấu chấm cuối câu nếu thiếu, để ghép câu không bị dính. */
const sentence = (t: string): string => {
  const x = t.trim();
  return x && !/[.!?…"”]$/.test(x) ? `${x}.` : x;
};

// --- Thời lượng ---
export function totalDuration(plan: PanelPlan): number {
  return round1(
    plan.panels.reduce((sum, p) => sum + (Number.isFinite(p.durationSec) ? p.durationSec : 0), 0),
  );
}

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
  if (totalDuration(plan) > MAX_TOTAL_SEC) return `Tổng thời lượng phải ≤ ${MAX_TOTAL_SEC}s.`;
  return null;
}

// --- Tham chiếu (nhân vật và vật dụng) ---
export const STORYBOARD_VAR = 'storyboard';

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
  const used = new Set<string>([STORYBOARD_VAR]);
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

/** Đoán tham chiếu dùng trong beat: tên AI trả về + tên xuất hiện trong kịch bản (kể cả @mention). */
export function detectRefIds(characters: Character[], scriptText: string, aiNames: string[]): string[] {
  const script = scriptText.toLowerCase();
  const ai = aiNames.map((n) => n.trim().toLowerCase()).filter(Boolean);
  return refCharacters(characters)
    .filter((c) => {
      const n = c.name.trim().toLowerCase();
      return n !== '' && (ai.includes(n) || script.includes(n));
    })
    .map((c) => c.id);
}

type TokenMode = 'plain' | 'apiImage' | 'apiVideo';

/**
 * AI viết tham chiếu dưới dạng {{tên}}. Hàm này đổi token theo định dạng:
 * plain -> cho, apiImage -> cho (Ref 1), apiVideo -> cho <IMAGE_REF_1>.
 */
export function renderTokens(text: string, refs: RefInfo[], mode: TokenMode): string {
  return text.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, raw: string) => {
    const r = refs.find((x) => x.name.toLowerCase() === raw.trim().toLowerCase());
    if (!r) return raw.trim();
    if (mode === 'apiImage') return `${r.name} (Ref ${r.index})`;
    if (mode === 'apiVideo') return `${r.name} <IMAGE_REF_${r.index}>`;
    return r.name;
  });
}

/** Bỏ dấu câu ở cuối, dùng khi ghép nhiều mục bằng dấu chấm phẩy. */
const bare = (t: string): string => t.trim().replace(/[\s.;,!]+$/, '');

const listJoin = (items: string[]): string => items.join('; ');

/** "cho is the mastiff dog; meo is the Siamese cat." */
function identityLine(refs: RefInfo[], mode: TokenMode): string {
  const parts = refs.map((r) => {
    const label = mode === 'apiVideo' ? `${r.name} <IMAGE_REF_${r.index}>` : mode === 'apiImage' ? `${r.name} (Ref ${r.index})` : r.name;
    return r.en ? `${label} is ${bare(r.en)}` : label;
  });
  return `${listJoin(parts)}.`;
}

// --- Ghép prompt cuối ---
export function buildGridImagePrompt(
  plan: PanelPlan,
  data: GeneratedData,
  characters: Character[],
  aspect: AspectRatio,
  format: PromptFormat,
): string {
  const refs = buildRefs(characters, plan.refIds, data.descriptors);
  const mode: TokenMode = format === 'api' ? 'apiImage' : 'plain';
  const r = (t: string) => renderTokens(t, refs, mode);
  const out: string[] = [];

  if (format === 'vars' && refs.length) {
    out.push(refs.map((x) => `${x.name} :`).join('\n'));
  }

  out.push(
    `Create ONE image: a 2x2 storyboard grid of four equal ${aspect} panels, ordered left to right, top to bottom, separated by thin white gutters. The four panels are consecutive keyframes of one continuous scene. Do not add any text, numbers, captions, logos or watermarks anywhere in the image.`,
  );
  if (refs.length) {
    out.push(
      format === 'api'
        ? `References (attached in this order): ${identityLine(refs, 'apiImage')} Match each one exactly to its reference image.`
        : `References: ${identityLine(refs, 'plain')} Match each one exactly to its reference image.`,
    );
  }
  out.push(`Scene: ${sentence(r(data.sceneEn))}`);
  out.push(`Shared style and consistency (identical in all four panels): ${sentence(r(data.styleBlock))}`);

  data.imagePanels.forEach((p, i) => {
    const body = [sentence(r(p.framing)), sentence(r(p.content))].filter(Boolean).join(' ');
    const extra = [
      p.environment ? `Setting: ${sentence(r(p.environment))}` : '',
      p.lens ? `Lens: ${sentence(r(p.lens))}` : '',
    ]
      .filter(Boolean)
      .join(' ');
    out.push(`Panel ${i + 1} (${GRID_POSITIONS[i]}): ${body} ${extra}`.trim());
  });

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
  const r = (t: string) => renderTokens(t, refs, mode);
  const tl = timeline(plan);
  const hasDialogue = plan.panels.some((p) => p.dialogue.trim());
  const board = format === 'api' ? '<IMAGE_REF_0>' : STORYBOARD_VAR;
  const out: string[] = [];

  if (format === 'vars') {
    out.push([STORYBOARD_VAR, ...refs.map((x) => x.name)].map((n) => `${n} :`).join('\n'));
    out.push('');
  } else {
    const decl = [0, ...refs.map((x) => x.index)].map((n) => `<IMAGE_REF_${n}>@Image${n + 1}`).join(' ');
    out.push(`[# References ${decl}]`);
  }

  out.push(
    `${board} is a 2x2 storyboard. Use it only as a guide for composition, action and camera. Its four panels (top-left, top-right, bottom-left, bottom-right) are the four beats in order: panel 1 is how the video begins and panel 4 is how it ends. Never show the grid, panel borders or gutters.`,
  );
  if (refs.length) out.push(identityLine(refs, mode));
  out.push(
    plan.editMode === 'continuous'
      ? 'Format: One single continuous shot, no scene cuts, no jump cuts.'
      : 'Format: Hard cuts between the four beats, one clean shot per beat.',
  );
  out.push(`Style and consistency: ${sentence(r(data.styleBlock))}`);

  data.videoBeats.forEach((b, i) => {
    const t = tl[i];
    const p = plan.panels[i];
    if (!t || !p) return;
    let line = `[${fmtSec(t.start)}-${fmtSec(t.end)}s] (panel ${i + 1}) ${sentence(r(b.camera))} ${sentence(r(b.action))}`.trim();
    if (p.dialogue.trim()) {
      line += ` ${p.speaker.trim() || 'The character'} says: "${p.dialogue.trim()}"`;
    }
    out.push(line);
  });

  const { ambience, music, sfx } = data.audio;
  out.push(
    `Audio: ambience: ${bare(ambience) || 'none'}; music: ${bare(music) || 'none'}; sound effects: ${bare(sfx) || 'none'}.`,
  );
  out.push(
    `No subtitles, no on-screen text, no watermark.${hasDialogue ? ' Only the dialogue lines above are spoken.' : ' No dialogue.'}`,
  );
  // Google khuyên đặt câu chỉ dẫn về vai trò ảnh ở cuối prompt.
  out.push(
    format === 'api'
      ? 'Use the images only as references for this video, not as literal first frames.'
      : `Use ${[STORYBOARD_VAR, ...refs.map((x) => x.name)].join(', ')} only as references for this video, not as literal first frames.`,
  );

  // Dòng trống sau khối khai báo biến đã được thêm ở trên, các dòng còn lại cách nhau một xuống dòng.
  return out.join('\n').replace(/\n\n\n+/g, '\n\n');
}

/** Tóm tắt trạng thái cuối của beat trước để beat sau nối tiếp liền mạch. */
export function describePreviousBeat(seq: BeatSequence): string {
  const panels = seq.plan.panels;
  const last = panels[panels.length - 1];
  const img = seq.generatedData.imagePanels[seq.generatedData.imagePanels.length - 1];
  const vid = seq.generatedData.videoBeats[seq.generatedData.videoBeats.length - 1];
  return [
    `Previous beat summary: ${seq.plan.beatSummary}`,
    last ? `Final panel of the previous beat (the state this beat must continue from): ${last.moment}` : '',
    img ? `Final panel visuals: ${img.content} Setting: ${img.environment}` : '',
    vid ? `Final video beat: ${vid.action}` : '',
    `Established style: ${seq.generatedData.styleBlock}`,
  ]
    .filter(Boolean)
    .join('\n');
}

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
      id: crypto.randomUUID(),
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
