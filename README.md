# Storyboard (Huy Animation) — bản Omni 1.1

Công cụ chia **một beat** (6–10 giây) thành lưới storyboard **2x2** và tạo prompt cho **Gemini Omni 1.1 Flash**.

## Luồng làm việc

1. Thêm nhân vật (ảnh + mô tả), viết nội dung của một beat trong ô *Script / Idea*.
   Có thể dán sẵn kịch bản có `@tên`: app tự gắn `@tên` với tham chiếu cùng tên (không phân biệt hoa thường, có dấu hay không dấu, ví dụ `@Chó` khớp với `cho`). Tên chưa có tham chiếu sẽ được báo bên dưới ô kịch bản.
2. Bấm **Phân tích panel**: AI chia beat thành đúng 4 panel (khoảnh khắc chính, cỡ cảnh, thời lượng, thoại, hành động giữa các panel).
3. **Sửa panel plan** (nội dung, cỡ cảnh, thời lượng, thoại, thứ tự, kiểu dựng liền/cắt cảnh).
4. Bấm **Tạo prompt**: app trả về prompt ảnh lưới 2x2 và prompt video Omni (có timecode, âm thanh, thoại đúng mốc).
5. Chọn **cách gắn ảnh tham chiếu**:
   - **Gán biến (Flow)** (mặc định): đầu prompt có các dòng `@cho :`, `@meo :`... Đặt con trỏ sau dấu hai chấm, gõ @ và chọn ảnh. Prompt video có thêm dòng `@storyboard :` cho ảnh lưới. Trong toàn bộ prompt, tên luôn viết kèm `@` (`@cho`) để không bị hiểu nhầm thành từ tiếng Anh.
   - **IMAGE_REF (API)**: dùng `[# References <IMAGE_REF_0>@Image1 ...]` theo tài liệu Gemini API.

Tham chiếu gồm cả nhân vật và vật dụng có ảnh. Chỉ những tham chiếu có trong beat mới được khai báo; có thể bật/tắt trong panel plan. Tên tham chiếu chính là tên biến, nên đặt ngắn, không trùng nhau.

Tổng thời lượng 4 panel không được vượt 10 giây (giới hạn của Omni cho mỗi lần tạo).

## Đồng bộ các beat trong cùng một cảnh

- **Hồ sơ cảnh** (thẻ ở thanh bên, dưới phần Tham chiếu): phong cách, bối cảnh, vị trí/hướng nhân vật (trục 180°) và mô tả cố định của từng tham chiếu, viết bằng tiếng Anh, gọi tham chiếu bằng `@tên`.
  - **AI viết nháp**: AI đọc ảnh tham chiếu và kịch bản rồi viết bản nháp; bạn sửa lại.
  - **Lấy từ beat đang xem**: lấy phong cách và mô tả tham chiếu của beat bạn ưng ý.
  - Khi bật **Khoá cho mọi beat**, mọi beat dùng nguyên văn hồ sơ này (AI không viết lại phong cách và mô tả tham chiếu); prompt ảnh và video có thêm dòng *Location* và *Screen direction*. Sửa hồ sơ sau khi tạo prompt sẽ hiện cảnh báo prompt đã cũ.
- **Ảnh bối cảnh** (trong Hồ sơ cảnh, không bắt buộc): khi hồ sơ đang khoá, prompt ảnh lưới của mọi beat có thêm tham chiếu `location`.
- **Ảnh lưới đã tạo** (dưới prompt video): tải lên ảnh lưới 2x2 bạn đã tạo cho beat. Beat sau (khi bật *Nối tiếp beat trước*) gắn ảnh này làm tham chiếu `prev_storyboard` để giữ cùng nét vẽ, nhân vật và bối cảnh; AI ở bước 2 cũng được xem ảnh này. Ảnh lớn được thu nhỏ còn cạnh dài 1536px.
- **Trạng thái cuối beat** (dưới prompt video): vị trí và tư thế, đồ vật, thay đổi cần giữ ở cuối panel 4. AI ghi sẵn, bạn sửa được. Khi bật **Nối tiếp beat trước**, panel 1 của beat sau bắt buộc bắt đầu từ trạng thái này. Nếu trạng thái cuối khác với hồ sơ cảnh (vd. vòng cổ đã mất), trạng thái cuối được ưu tiên, và prompt có thêm dòng *Continuity* để công cụ vẽ cũng biết.

## Cấu trúc mã

- `src/assemble.ts` — logic thuần: thời lượng, cảnh báo, chuẩn hóa dữ liệu AI, ghép prompt cuối. Timecode và thoại được ghép bằng code, không phụ thuộc AI.
- `src/gemini.ts` — hai lời gọi Gemini (đề xuất plan; viết nội dung chi tiết từ plan đã sửa), dùng `responseSchema`.
- `src/App.tsx` — giao diện.
- `src/SceneCards.tsx` — thẻ Hồ sơ cảnh, Ảnh lưới đã tạo và Trạng thái cuối beat.
- `src/image.ts` — đọc và thu nhỏ ảnh tải lên.
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
