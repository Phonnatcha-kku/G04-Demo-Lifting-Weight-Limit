@extends('layout', ['page' => 'design'])
@section('title', 'Design')

@section('content')
<section class="card">
    <h1>1 · User Flow</h1>
    <div class="flow">
        <div class="step">เปิดเว็บ<small>Laravel ส่ง HTML/CSS/JS</small></div>
        <div class="step">เลือก/ลากวิดีโอ<small>ไฟล์อยู่ในเบราว์เซอร์ ไม่อัปโหลด</small></div>
        <div class="step">ตรวจไฟล์<small>สกุลไฟล์ · ≤1 GB · ≤9,000 เฟรม · codec ไม่รองรับ → แปลงเป็น H.264 (ffmpeg.wasm)</small></div>
        <div class="step">กรอกส่วนสูง + FPS</div>
        <div class="step accent">กด “เริ่มวิเคราะห์”<small>โหลด OpenCV.js + MediaPipe (GPU→CPU)</small></div>
        <div class="step">Calibrate 1.5 วิแรก<small>cm/px, พื้น, เข่า/เอว/ไหล่</small></div>
        <div class="step accent">ประมวลผลทีละเฟรม ①–⑨<small>ดูผล live + Matrix 3×4 ไฮไลต์</small></div>
        <div class="step">Dashboard<small>KPI · heat matrix · กราฟ · RWL</small></div>
        <div class="step accent">ดาวน์โหลด CSV / PDF<small>สร้างในเบราว์เซอร์ทันที</small></div>
    </div>
    <p class="muted">ทางแยก: กด “หยุด” ระหว่างประมวลผล → ไป Dashboard ด้วยเฟรมที่ทำแล้ว · คลิปสั้นกว่าช่วง calibrate → แจ้งเตือน · GPU ใช้ไม่ได้ → สลับ CPU อัตโนมัติ</p>
</section>

<section class="card">
    <h1>2 · Wireframe</h1>
    <div class="wires">
        <div class="wire">
            <div class="wt">A · Upload</div>
            <div class="wb nav">LOGO ─ วิเคราะห์วิดีโอ ─ Design</div>
            <div class="wsplit">
                <div>
                    <div class="wb tall">[ ลากวิดีโอมาวาง / คลิกเลือก ]</div>
                    <div class="wb">ข้อมูลไฟล์ + จำนวนเฟรม + ✕ ข้อจำกัด</div>
                    <div class="wb">ส่วนสูง [160] · FPS [30]</div>
                    <div class="wb btnw">▶ เริ่มวิเคราะห์</div>
                </div>
                <div><div class="wb tall">Matrix 3×4<br>(ตารางเกณฑ์ kg)</div></div>
            </div>
        </div>
        <div class="wire">
            <div class="wt">B · Processing (live)</div>
            <div class="wb">สถานะ · [██████░░░] 62% · 12 fps · ■ หยุด</div>
            <div class="wsplit">
                <div><div class="wb tall2">Canvas วิดีโอ + โครงกระดูก<br>+ ตาราง perspective<br>+ ป้าย MAX kg</div></div>
                <div>
                    <div class="wb">twist · orient · H · V</div>
                    <div class="wb">LIMIT xx kg</div>
                    <div class="wb tall">Matrix 3×4<br>ช่องปัจจุบันสีเหลือง</div>
                </div>
            </div>
        </div>
        <div class="wire">
            <div class="wt">C · Dashboard / Report (= หน้า PDF)</div>
            <div class="wb">หัวรายงาน · [⬇ CSV] [⬇ PDF] [ใหม่]</div>
            <div class="wb">KPI ×6 : limit ต่ำสุด · twist สูงสุด · H สูงสุด · orient · scale · เข่า/เอว/ไหล่</div>
            <div class="wsplit">
                <div class="wb tall">Heat Matrix 3×4<br>(วินาทีในแต่ละช่อง)</div>
                <div class="wb tall">แบบประเมิน RWL<br>น้ำหนัก · ความถี่ · บิดตัว<br>→ LH Index ระดับ 1–4</div>
            </div>
            <div class="wb">กราฟ V(t) · H(t) · มุม(t) · limit(t)</div>
            <div class="wb">ภาพนิ่ง 3 จังหวะ</div>
        </div>
    </div>
</section>

<section class="card">
    <h1>3 · โครงสร้างซอฟต์แวร์</h1>
    <div class="grid2">
<pre class="tree">lifting-web/                 (Laravel 13 · Herd)
├─ routes/web.php            GET / → analyzer · GET /design
├─ routes/console.php        php artisan export:static → ../docs/
├─ resources/views/
│  ├─ layout.blade.php       header · nav · footer
│  ├─ analyzer.blade.php     Upload · Processing · Dashboard
│  └─ design.blade.php       หน้านี้
├─ public/
│  ├─ css/app.css            UI + @media print (PDF)
│  └─ js/
│     ├─ pipeline.js         พอร์ตจาก Colab ①–⑨
│     ├─ app.js              UI · Dashboard · CSV/PDF · RWL
│     └─ vendor/ffmpeg/      ffmpeg.wasm wrapper (แปลง H.265 → H.264)
└─ ../docs/                   ไฟล์ static สำหรับ GitHub Pages (main /docs)</pre>
        <div class="arch">
            <div class="layer"><b>เบราว์เซอร์ผู้ใช้ (CPU/GPU)</b>
                <div class="boxes"><span>app.js<br>UI/Dashboard</span><span>pipeline.js<br>①–⑨</span></div>
                <div class="boxes"><span>MediaPipe Tasks<br>WASM + WebGL</span><span>OpenCV.js<br>WASM</span><span>Canvas 2D<br>กราฟ/วิดีโอ</span></div>
                <div class="boxes"><span>Blob → CSV</span><span>window.print → PDF</span></div>
            </div>
            <div class="arrow">↑ HTML · CSS · JS (ครั้งเดียว) &nbsp;&nbsp; ✕ ไม่มีวิดีโอส่งกลับ</div>
            <div class="layer"><b>Laravel (PHP) บน Herd / GitHub Pages (static export)</b>
                <div class="boxes"><span>Route + Blade</span><span>public/ assets</span></div>
            </div>
            <div class="arrow">CDN: jsdelivr (MediaPipe · OpenCV.js · ffmpeg.wasm core) · storage.googleapis.com (โมเดล .task)</div>
        </div>
    </div>
</section>

<section class="card">
    <h1>4 · โค้ด Colab → เว็บ</h1>
    <table class="map">
        <tr><th>ขั้น</th><th>Colab (Python)</th><th>เว็บ (pipeline.js)</th><th>เปลี่ยนอะไร</th></tr>
        <tr><td>①</td><td><code>cv2.VideoCapture · cap.read()</code></td><td><code>&lt;video&gt;</code> seek ทีละเฟรม → canvas</td><td>แหล่งเฟรมเท่านั้น</td></tr>
        <tr><td>②</td><td><code>create_pose_detector · extract_keypoints</code></td><td>ชื่อเดิม · <code>PoseLandmarker</code> JS โหมด VIDEO, model lite เดิม</td><td>delegate GPU→CPU</td></tr>
        <tr><td>③</td><td><code>create_kalman · PointTracker · PoseSmoother</code></td><td>ชื่อเดิม · สมการ cv2.KalmanFilter เขียนเป็น JS</td><td>–</td></tr>
        <tr><td>④</td><td><code>draw_skeleton</code></td><td>ชื่อเดิม · cv.line/cv.circle (OpenCV.js) สี BGR เดิม</td><td>–</td></tr>
        <tr><td>⑤</td><td><code>calc_cm_per_px · camera_matrix · calc_world_scale · solve_camera_pose · to_camera_3d · project · body_frame · body_coords · calibrate</code></td><td>ชื่อเดิม · <code>cv.solvePnP</code>, <code>cv.Rodrigues</code></td><td>–</td></tr>
        <tr><td>⑥ ⑦</td><td><code>orientation_angle · twist_angle · twist_from_baseline</code></td><td>ชื่อเดิม</td><td>–</td></tr>
        <tr><td>⑧</td><td><code>table_row · table_col · measure_hands · cell_color · make_table_image · draw_weight_table · draw_hand_label</code></td><td>ชื่อเดิม · <code>cv.getPerspectiveTransform</code>, <code>cv.warpPerspective</code>, alpha uint8 (แบบ Nick/ton)</td><td>–</td></tr>
        <tr><td>⑨</td><td><code>draw_info_panel · run_pipeline · VideoWriter · to_csv</code></td><td>ชื่อเดิม · แสดงบน canvas · CSV จาก Blob</td><td>ไม่เขียนไฟล์ mp4</td></tr>
        <tr><td>10</td><td>matplotlib 4 กราฟ · groupby เวลาในช่อง · ภาพนิ่ง 3 จังหวะ</td><td>app.js: <code>plot()</code> canvas · heat matrix · snapshot</td><td>matplotlib → canvas</td></tr>
    </table>
</section>
@endsection
