# Storyboard (Huy Animation) — bản Omni 1.1

Công cụ chia **một beat** (6–10 giây) thành lưới storyboard **2x2** và tạo prompt cho **Gemini Omni 1.1 Flash**.

## Luồng làm việc

1. Thêm nhân vật (ảnh + mô tả), viết nội dung của một beat trong ô *Script / Idea*.
   Có thể dán sẵn kịch bản có `@tên`: app tự gắn `@tên` với tham chiếu cùng tên (không phân biệt hoa thường, có dấu hay không dấu, ví dụ `@Chó` khớp với `cho`). Tên chưa có tham chiếu sẽ được báo bên dưới ô kịch bản.
2. Bấm **Phân tích panel**: AI chia beat thành đúng 4 panel (khoảnh khắc chính, cỡ cảnh, thời lượng, thoại, hành động giữa các panel).
3. **Sửa panel plan** (nội dung, cỡ cảnh, thời lượng, thoại, thứ tự, kiểu dựng liền/cắt cảnh).
4. Bấm **Tạo prompt**: app trả về prompt ảnh lưới 2x2 và prompt video Omni (có timecode, âm thanh, thoại đúng mốc).
5. Chọn **cách gắn ảnh tham chiếu**:
   - **Gán biến (Flow)** (mặc định): đầu prompt có các dòng `cho :`, `meo :`... Đặt con trỏ sau dấu hai chấm, gõ @ và chọn ảnh. Prompt video có thêm dòng `storyboard :` cho ảnh lưới.
   - **IMAGE_REF (API)**: dùng `[# References <IMAGE_REF_0>@Image1 ...]` theo tài liệu Gemini API.

Tham chiếu gồm cả nhân vật và vật dụng có ảnh. Chỉ những tham chiếu có trong beat mới được khai báo; có thể bật/tắt trong panel plan. Tên tham chiếu chính là tên biến, nên đặt ngắn, không trùng nhau.

Tổng thời lượng 4 panel không được vượt 10 giây (giới hạn của Omni cho mỗi lần tạo).

## Cấu trúc mã

- `src/assemble.ts` — logic thuần: thời lượng, cảnh báo, chuẩn hóa dữ liệu AI, ghép prompt cuối. Timecode và thoại được ghép bằng code, không phụ thuộc AI.
- `src/gemini.ts` — hai lời gọi Gemini (đề xuất plan; viết nội dung chi tiết từ plan đã sửa), dùng `responseSchema`.
- `src/App.tsx` — giao diện.
- `src/SettingsModal.tsx`, `src/settings.ts` — hộp Cài đặt và lưu key/model.
- `src/types.ts` — kiểu dữ liệu.

## Trên điện thoại

Màn hình nhỏ (dưới 1024px) dùng thanh tab ở đáy: **Beat** (nhân vật, kịch bản, phân tích) và **Panel & Prompt**. App tự chuyển sang tab Panel & Prompt khi phân tích xong, nút **Tạo prompt** dính ở đáy khi xem 4 panel, và tự cuộn tới prompt sau khi tạo.

## API key và model

Bấm biểu tượng bánh răng ở đầu sidebar để mở **Cài đặt**:

- Nhập Gemini API key (ưu tiên hơn key trong Secrets / `.env.local`). Để trống thì app dùng key có sẵn.
- Chọn model (mặc định `gemini-3.8-flash`).
- **Kiểm tra kết nối** để biết key và model có dùng được không trước khi lưu.
- Tùy chọn *Nhớ key trên trình duyệt này* lưu key vào localStorage. Bỏ chọn trên máy dùng chung.

Chấm vàng trên biểu tượng bánh răng nghĩa là chưa có key nào.

## Chạy

1. `npm install`
2. Có thể đặt `GEMINI_API_KEY` trong `.env.local`, hoặc nhập key trong Cài đặt của app
3. `npm run dev`

Project file `.json` lưu từ bản cũ (3x3/2x2) chỉ nạp lại được nhân vật và kịch bản.
