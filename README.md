Lifting Weight Limit Web App
คำอธิบายโค้ด: ข้อจำกัด · หน้าที่ของแต่ละไฟล์ · เทียบกับ Colab (ton, Nick, pond)

1. ข้อจำกัดที่ยังมี (ไม่ใช่บั๊กที่แก้ได้ในโค้ดนี้)
•	เฟรมไม่ตรงกับ Colab เสมอ: เว็บใช้ floor(duration × fps) ตามค่า FPS ที่ผู้ใช้กรอก คลิปตัวอย่าง G04 มีจริง 313 เฟรม (เฉลี่ย 29.59 fps) แต่เว็บประมวลผล 317 เฟรมเพราะกรอก 30
•	seek() รอ event seeked ถ้า currentTime ไม่เปลี่ยนจะค้าง ปัจจุบันไม่เกิดเพราะแต่ละเฟรมใช้เวลาต่างกันเสมอ
•	ถ้า pipeline error กลางทาง Mat ของ OpenCV ที่สร้างค้างไว้ไม่ถูก .delete() ยอมรับได้เพราะผู้ใช้ต้องโหลดหน้าใหม่อยู่แล้ว

2. แต่ละไฟล์ทำอะไร
ไฟล์	หน้าที่
routes/web.php	2 route: / → analyzer, /design → design (ไม่มี logic ฝั่งเซิร์ฟเวอร์)
routes/console.php	คำสั่ง export:static เรนเดอร์ Blade เป็น docs/*.html สำหรับ GitHub Pages (Settings → Pages → main /docs)
resources/views/layout.blade.php	โครงหน้า header, nav, footer ใช้ path แบบ relative
resources/views/analyzer.blade.php	HTML ของ 3 ส่วน: Upload, Processing, Dashboard
resources/views/design.blade.php	User flow, wireframe, โครงสร้าง, ตารางเทียบ Colab
public/css/app.css	หน้าตาทั้งหมด และ @media print ที่ใช้พิมพ์ PDF
public/js/vendor/ffmpeg/*	wrapper ของ ffmpeg.wasm สำหรับแปลง HEVC
public/js/pipeline.js, public/js/app.js	อธิบายละเอียดในหัวข้อ 3 และ 4

3. pipeline.js (พอร์ตจาก Colab)
ไฟล์นี้ไม่แตะ DOM ยกเว้น canvas ที่รับเข้ามา ส่งออกฟังก์ชันให้ app.js ใช้
ส่วน	สิ่งที่ทำ	ต้นฉบับใน Colab (cell)
ค่าคงที่ (บรรทัด 17–34)	MIN_CONFIDENCE, CALIB_SECONDS, FOV 70°, WEIGHT_LIMITS_KG, SKELETON ฯลฯ ค่าเดิมทุกตัว	12, 18, 25, 27, 29
ตัวช่วย numpy (nanmean, nanmedian, unit, cross, เมทริกซ์เล็ก)	JS ไม่มี numpy จึงเขียนเอง คงพฤติกรรมข้าม NaN	ใช้ทั่วไป
loadLibraries	โหลด OpenCV.js และ FilesetResolver ของ MediaPipe	cell 2 (import)
create_pose_detector, extract_keypoints	โหมด VIDEO, numPoses:1, โมเดล lite เดิม ลอง GPU ก่อน แล้ว CPU คืน xy, world, conf	10
create_kalman, PointTracker, PoseSmoother	เขียนสมการ predict/correct ของ cv2.KalmanFilter ด้วยมือ (Q, R, gate, MAX_PREDICT_FRAMES, moving average, world average เดิม)	12
draw_skeleton	ใช้ cv.line / cv.circle สี BGR เดิม	16
calc_cm_per_px, camera_matrix, calc_world_scale	สเกล ซม./พิกเซล, เมทริกซ์กล้องจาก FOV, สเกลโครงร่าง 3 มิติ	18
solve_camera_pose, to_camera_3d, project	ใช้ cv.solvePnP และ cv.Rodrigues (ส่ง rvec/tvec เฟรมก่อนเป็นค่าเริ่มต้น)	18
body_frame, body_coords, twist_angle, calibrate	แกน O/up/side/front, ระดับพื้น เข่า เอว ไหล่ และ baseline การบิด	18
orientation_angle, twist_from_baseline	มุมหันเทียบกล้อง และมุมบิด (แก้ % ให้เป็นแบบ Python)	22, 25
table_row, table_col, measure_hands	คำนวณ H, V แล้วหาช่องในตาราง	27
cell_color, make_table_image	วาดตาราง 3×4 และช่อง alpha	29
draw_weight_table, draw_hand_label	getPerspectiveTransform + warpPerspective แล้วผสมภาพ, ป้าย MAX kg	29
draw_info_panel, run_pipeline	ลูปรวมขั้น ①–⑨ ต่อเฟรม แล้วคืน records, calib, info	31

4. app.js (ส่วนที่ไม่มีใน Colab)
ส่วน	หน้าที่	อ้างอิง Colab
buildMatrix, highlight	วาด Matrix 3×4 (สีจาก cell_color เดิม) และไฮไลต์ช่องปัจจุบัน	แทนตารางที่วาดบนวิดีโอ
plot	กราฟเส้นด้วย canvas แทน matplotlib (แถบเทาช่วง calibrate เส้นประขอบตาราง)	cell 37
canDecode, toH264, checkLimits, onFile	ตรวจสกุลไฟล์/ขนาด/เฟรม, แปลง HEVC ด้วย ffmpeg.wasm	ไม่มีใน Colab (เพิ่มเอง)
start	โหลดไลบรารี เรียก run_pipeline อัปเดต UI ทุกเฟรม เก็บภาพนิ่ง 3 จังหวะ	cell 32, 35
renderDashboard	KPI, เวลาในแต่ละช่อง (groupby), กราฟ V/H/มุม/limit, เวลารวมต่อโซน	cell 37, 39
rwl	RWL และ LH Index จากแบบประเมินหน้า 254	ไม่มีใน Colab (จากภาพ PNG)
downloadCSV, window.print	CSV คอลัมน์เดียวกับ results.to_csv ส่วน PDF ใช้ print	cell 32
show	สลับ section	—

5. เทียบ 3 notebook (ton, Nick, pond)
เทียบด้วย diff จริง:
•	Nick กับ ton: cell 0–43 เหมือนกันทุกบรรทัด ต่างกันเฉพาะ Nick มี cell 44–47 เพิ่ม (ข้อ 3: รันซ้ำกับ 0215(1).mp4 ดาวน์โหลดผ่าน gdown) ส่วนคำตอบข้อ A/B/C อยู่ใน cell 43 ของทั้งสองไฟล์
•	pond ต่างจากอีกสอง 76 บรรทัด ใน 3 จุด (ดูตารางด้านล่าง) และเลือกแบบ Nick/ton
•	ทั้ง 3 ไฟล์มีโค้ดอัลกอริทึม (cell 8–31) เหมือนกัน จึงไม่ได้ผสมมาจากหลายไฟล์ ใช้ชุดเดียวกัน
•	ผลรันที่บันทึกใน notebook ของ pond มาจากคลิปคนละคลิป (ชื่อไฟล์ที่ตรวจพบเป็น WS-KW_RN_T0) จึงเทียบกับเว็บไม่ได้ เทียบเฉพาะผลของ Nick ที่เป็นคลิป G04 เดียวกัน

Cell	pond	Nick / ton	ในเว็บ
29 make_table_image	alpha เป็น float32 วาดตัวหนังสือด้วยค่า 1.0	alpha_uint8 (0–255) แล้วแปลงเป็น float ตอนท้าย	ใช้แบบ Nick/ton (Mat 8 บิตแล้ว convertTo เป็น float)
34 แปลงวิดีโอ	ไม่เช็คตัวแปร	เช็คว่า stem, RAW_OUT, FINAL_OUT มีอยู่ก่อน	ไม่ได้ใช้ (เว็บไม่เขียนไฟล์วิดีโอ)
35 ภาพนิ่ง 3 จังหวะ	ไม่ดึง results จาก CSV	ดึง results จาก CSV ถ้าไม่มีตัวแปร	เก็บภาพนิ่งระหว่างประมวลผลใน start()

ส่วนที่เว็บเพิ่มเอง ไม่มีใน Colab: การตรวจและแปลงไฟล์, Matrix สดบนหน้าเว็บ, Dashboard แบบ KPI, แบบประเมิน RWL/LH Index และการส่งออก PDF นอกนั้นคือโค้ดเดิม
