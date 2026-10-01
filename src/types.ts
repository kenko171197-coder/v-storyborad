// --- Tham chiếu (nhân vật hoặc vật dụng có ảnh) ---
export interface CharacterImage {
  id: string;
  base64: string;
  mimeType: string;
}

export interface Character {
  id: string;
  /** Tên biến dùng trong prompt, ví dụ: cho, meo, xucxich */
  name: string;
  appearance: string;
  images: CharacterImage[];
}

// --- Panel plan (bước 1, người dùng sửa được) ---
export type AspectRatio = '16:9' | '9:16';

/** Vai trò của panel trong beat: thiết lập → hành động → đỉnh → hệ quả */
export type PanelRole = 'setup' | 'action' | 'peak' | 'consequence';

/** continuous = một cú máy liền, cuts = cắt cảnh giữa các panel */
export type EditMode = 'continuous' | 'cuts';

/** vars = khai báo biến "cho :" rồi gõ @ chọn ảnh (Flow); api = <IMAGE_REF_N> theo tài liệu Gemini API */
export type PromptFormat = 'vars' | 'api';

export interface PlanPanel {
  id: string; // chỉ dùng cho React key
  role: PanelRole;
  /** Khoảnh khắc chính được "đóng băng" trong panel (ngôn ngữ của người dùng) */
  moment: string;
  /** Cỡ cảnh, tiếng Anh ngắn gọn: "Wide shot", "Close-up"... */
  shotSize: string;
  durationSec: number;
  speaker: string;
  /** Thoại nguyên văn từ kịch bản, để trống nếu không có */
  dialogue: string;
  /** Hành động nhỏ diễn ra giữa panel này và panel kế tiếp */
  between: string;
}

export interface PanelPlan {
  beatSummary: string;
  editMode: EditMode;
  /** id các tham chiếu xuất hiện trong beat (chỉ những cái này được khai báo trong prompt) */
  refIds: string[];
  /** Luôn đúng 4 panel */
  panels: PlanPanel[];
  /** Cảnh báo do AI đưa ra về nội dung (quá dài, quá mỏng...) */
  warnings: string[];
}

// --- Kết quả bước 2 ---
export interface ImagePanel {
  n: number;
  /** Cỡ cảnh + góc máy + hướng máy */
  framing: string;
  /** Ai/cái gì trong khung, tư thế, biểu cảm và khoảnh khắc hành động (một lần, không lặp) */
  content: string;
  environment: string;
  lens: string;
  detailsVi: string;
}

export interface VideoBeat {
  n: number;
  camera: string;
  /** Không chứa thoại, thoại được ghép từ plan */
  action: string;
  noteVi: string;
}

export interface GeneratedData {
  summaryVi: string;
  sceneEn: string;
  /** Khối phong cách và nhất quán, dùng chung cho prompt ảnh và prompt video */
  styleBlock: string;
  /** id tham chiếu -> cụm danh từ tiếng Anh ngắn, ví dụ "the mastiff dog" */
  descriptors: Record<string, string>;
  imagePanels: ImagePanel[];
  videoBeats: VideoBeat[];
  audio: { ambience: string; music: string; sfx: string };
  audioNoteVi: string;
}

export interface BeatSequence {
  id: string;
  timestamp: number;
  scriptText: string;
  aspect: AspectRatio;
  plan: PanelPlan;
  generatedData: GeneratedData;
}
