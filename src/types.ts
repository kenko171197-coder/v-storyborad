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
  /** Hành động chính mà storyboard này diễn (tiếng Việt, tối đa 2 cho một video) */
  actions?: string[];
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
  /** Âm thanh xảy ra trong cảnh này (tiếng Anh); có thể thiếu ở project cũ */
  sfx?: string;
}

/** Ảnh lưu trong project (data URL base64) */
export interface StoredImage {
  base64: string;
  mimeType: string;
}

// --- Hồ sơ cảnh: khoá chung cho mọi beat trong cùng một cảnh ---
export interface SceneBible {
  /** true = áp dụng cho mọi beat; false = giữ nội dung nhưng tạm không dùng */
  enabled: boolean;
  /** Phong cách hình ảnh, bảng màu, ánh sáng, ống kính (tiếng Anh, gọi tham chiếu bằng @tên) */
  style: string;
  /** Bối cảnh: bố trí không gian, vật liệu, nguồn sáng, giờ trong ngày (tiếng Anh) */
  location: string;
  /** Vị trí và hướng của nhân vật trong khung hình, giữ theo trục 180° (tiếng Anh) */
  blocking: string;
  /** id tham chiếu -> cụm danh từ tiếng Anh cố định, ví dụ "the tan mastiff dog with a red collar" */
  descriptors: Record<string, string>;
  /** Ảnh bối cảnh (không bắt buộc), dùng làm tham chiếu "location" cho mọi beat */
  locationImage?: StoredImage | null;
}

/** Trạng thái ở cuối beat (tiếng Việt); panel 1 của beat nối tiếp phải bắt đầu đúng từ đây. */
export interface EndState {
  /** Vị trí, tư thế, hướng nhìn của từng nhân vật */
  positions: string;
  /** Đồ vật đang ở đâu, trong tay ai */
  props: string;
  /** Những gì đã thay đổi trong beat (trang phục, đồ bị vỡ, ánh sáng...) */
  changes: string;
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
  /** Có thể thiếu ở project cũ */
  endState?: EndState;
  /** Bối cảnh và hướng nhân vật lấy từ hồ sơ cảnh lúc tạo (dạng token {{tên}}) */
  scene?: { location: string; blocking: string };
  /** Tiếng Anh: những thay đổi từ beat trước phải còn thấy trong beat này (vòng cổ đã mất, đĩa vỡ...) */
  continuityEn?: string;
  /** Tiếng Anh, một câu ngắn: phong cách, ánh sáng, bối cảnh cho prompt video */
  videoLookEn?: string;
  /** Ảnh mốc được gắn kèm prompt ảnh lưới: ảnh bối cảnh, ảnh lưới của beat trước */
  anchors?: { location: boolean; prevGrid: boolean };
}

export interface BeatSequence {
  id: string;
  timestamp: number;
  scriptText: string;
  aspect: AspectRatio;
  plan: PanelPlan;
  generatedData: GeneratedData;
  /** id của beat mà beat này nối tiếp (nếu có) */
  prevId?: string;
  /** Ảnh lưới 2x2 người dùng đã tạo cho beat này, làm mốc cho beat sau */
  gridImage?: StoredImage;
}
