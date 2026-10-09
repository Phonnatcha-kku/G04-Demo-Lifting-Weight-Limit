// UI + Dashboard. Summary maths = notebook steps 10.1–10.3 (cells 37, 39, 41); export = CSV / print-to-PDF.
import { loadLibraries, create_pose_detector, run_pipeline, cell_color, nanmedian,
         ROW_NAMES, COL_NAMES, WEIGHT_LIMITS_KG, REACH_LIMITS_CM, TWIST_WARN_DEG, CALIB_SECONDS } from './pipeline.js';

const $ = id => document.getElementById(id);
const CSV_COLS = ['frame_number', 'time_s', 'orientation_deg', 'twist_deg', 'H_cm', 'V_cm', 'zone', 'reach_class', 'limit_kg'];
// แบบประเมินหน้า 254 ขั้นตอนที่ 3 (ตัวคูณความถี่) — แถว = รอบยก/นาที, คอลัมน์ = <1, 1–2, >2 ชม./วัน
const FREQ = [['ยก 1 ครั้งทุก 2-5 นาที', 1.0, 0.95, 0.85], ['ยก 1 ครั้งทุก 1 นาที', 0.95, 0.9, 0.75],
              ['ยก 2-3 ครั้งทุก 1 นาที', 0.9, 0.85, 0.65], ['ยก 4-5 ครั้งทุก 1 นาที', 0.85, 0.7, 0.45],
              ['ยก 6-7 ครั้งทุก 1 นาที', 0.75, 0.5, 0.25], ['ยก 8-9 ครั้งทุก 1 นาที', 0.6, 0.35, 0.15],
              ['ยกมากกว่า 10 ครั้งทุก 1 นาที', 0.3, 0.2, 0.0]];

let detector = null, vision = null, file = null, stop = false, result = null, snaps = {};
const bgr2css = ([b, g, r]) => `rgb(${r},${g},${b})`;
const fmt = (v, d = 1) => v === undefined || Number.isNaN(v) ? '–' : v.toFixed(d);

// ---------------------------------------------------------------- Matrix 3×4
function buildMatrix(el, values = null) {
    el.innerHTML = '<div></div>' + COL_NAMES.map((c, j) =>
        `<div class="mh">${c}<small>${['0–7″', '7–12″', '>12″'][j]}</small></div>`).join('');
    ROW_NAMES.forEach((r, i) => {
        el.innerHTML += `<div class="mh row">${r}</div>`;
        COL_NAMES.forEach((_, j) => {
            const kg = WEIGHT_LIMITS_KG[i][j];
            const sec = values ? `<small>${values[i][j].toFixed(2)} s</small>` : '';
            el.innerHTML += `<div class="cell" data-r="${i}" data-c="${j}" style="background:${bgr2css(cell_color(kg))}${kg >= 35 ? ";color:#5a3b00;text-shadow:none" : ""}">${kg}<span>kg</span>${sec}</div>`;
        });
    });
}
function highlight(el, r, c) {
    el.querySelectorAll('.cell').forEach(x => x.classList.toggle('on', +x.dataset.r === r && +x.dataset.c === c));
}

// ---------------------------------------------------------------- canvas line chart (แทน matplotlib)
function plot(canvas, { series, hlines = [], ylabel, ymin, ymax, step = false }) {
    const dpr = window.devicePixelRatio || 1, W = canvas.clientWidth, H = canvas.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    const g = canvas.getContext('2d'); g.scale(dpr, dpr); g.clearRect(0, 0, W, H);
    const L = 48, R = 70, Tp = 10, B = 22, t = series[0].x, tmax = t[t.length - 1] || 1;
    const ys = series.flatMap(s => s.y).concat(hlines.map(h => h.y)).filter(Number.isFinite);
    const lo = ymin ?? Math.min(...ys), hi = ymax ?? Math.max(...ys);
    const X = v => L + (v / tmax) * (W - L - R), Y = v => Tp + (1 - (v - lo) / ((hi - lo) || 1)) * (H - Tp - B);
    g.fillStyle = '#e8eaed'; g.fillRect(X(0), Tp, X(CALIB_SECONDS) - X(0), H - Tp - B);      // ช่วง calibrate
    g.font = '11px system-ui'; g.fillStyle = '#5f6368'; g.strokeStyle = '#dadce0';
    for (let k = 0; k <= 4; k++) {
        const v = lo + (hi - lo) * k / 4;
        g.beginPath(); g.moveTo(L, Y(v)); g.lineTo(W - R, Y(v)); g.stroke();
        g.fillText(v.toFixed(0), 4, Y(v) + 4);
    }
    for (let k = 0; k <= 5; k++) g.fillText((tmax * k / 5).toFixed(1) + 's', X(tmax * k / 5) - 10, H - 6);
    g.save(); g.setLineDash([4, 3]); g.strokeStyle = '#9aa0a6';
    for (const h of hlines) { g.beginPath(); g.moveTo(L, Y(h.y)); g.lineTo(W - R, Y(h.y)); g.stroke(); g.fillText(h.label, W - R + 4, Y(h.y) + 4); }
    g.restore();
    for (const s of series) {
        g.strokeStyle = s.color; g.lineWidth = s.width ?? 2; g.beginPath();
        let pen = false, prev = null;
        s.x.forEach((x, k) => {
            const y = s.y[k];
            if (!Number.isFinite(y)) { pen = false; return; }
            if (!pen) g.moveTo(X(x), Y(y)); else if (step) { g.lineTo(X(x), Y(prev)); g.lineTo(X(x), Y(y)); } else g.lineTo(X(x), Y(y));
            pen = true; prev = y;
        });
        g.stroke();
    }
    g.fillStyle = '#202124'; g.fillText(ylabel, L + 4, Tp + 12);
}

// ---------------------------------------------------------------- อัปโหลด + ข้อจำกัดไฟล์
const LIMITS = { ext: ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi'], maxMB: 1024, maxFrames: 9000 };
// ponytail: maxFrames = 5 นาทีที่ 30 fps — ประมวลผลทีละเฟรมบนเครื่องผู้ใช้ คลิปยาวกว่านี้ใช้เวลานานมาก

// เปิดไฟล์ใน <video> ได้จริงหรือไม่ (โหลด metadata + ถอดรหัสเฟรมได้)
function canDecode(v, src) {
    return new Promise(ok => {
        const done = r => { clearTimeout(timer); v.onloadeddata = v.onerror = null; ok(r); };
        const timer = setTimeout(() => done(false), 10000);
        v.onerror = () => done(false);
        v.onloadeddata = () => done(v.videoWidth > 0);
        v.src = src;
    });
}

// เบราว์เซอร์ถอดรหัสไม่ได้ (เช่น H.265/HEVC จากมือถือ) → แปลงเป็น H.264 ในเครื่องผู้ใช้ด้วย ffmpeg.wasm
async function toH264(f, say) {
    const { FFmpeg } = await import('./vendor/ffmpeg/index.js');
    const ff = new FFmpeg();
    ff.on('progress', ({ progress }) => say(`กำลังแปลงไฟล์เป็น H.264 ในเครื่องคุณ ... ${Math.max(0, Math.round(progress * 100))}%`));
    say('กำลังโหลดตัวแปลงวิดีโอ (ffmpeg.wasm ~32 MB ครั้งแรก) ...');
    const core = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm/';
    await ff.load({ coreURL: core + 'ffmpeg-core.js', wasmURL: core + 'ffmpeg-core.wasm' });
    await ff.writeFile('in', new Uint8Array(await f.arrayBuffer()));
    await ff.exec(['-i', 'in', '-an', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18', '-pix_fmt', 'yuv420p', 'out.mp4']);
    const out = await ff.readFile('out.mp4');
    ff.terminate();
    return new Blob([out], { type: 'video/mp4' });
}

function checkLimits() {
    const v = $('video'), fps = +$('fps').value, frames = Math.floor(v.duration * fps);
    const err = [];
    if (frames > LIMITS.maxFrames) err.push(`มี ${frames} เฟรม เกินสูงสุด ${LIMITS.maxFrames} เฟรม — ตัดคลิปให้สั้นลง`);
    $('limits').innerHTML = `จะประมวลผล <b>${frames}</b> เฟรม` + err.map(e => `<div class="warn">✕ ${e}</div>`).join('');
    $('start').disabled = err.length > 0;
}

async function onFile(f) {
    file = f;
    $('start').disabled = true;
    $('limits').innerHTML = '';
    const info = $('fileinfo'), say = s => { info.innerHTML = `<b>${f.name}</b><div class="muted">${s}</div>`; };
    const ext = f.name.split('.').pop().toLowerCase();
    if (!LIMITS.ext.includes(ext)) return say(`<span class="warn">✕ ไม่รองรับสกุล .${ext} — ใช้ ${LIMITS.ext.join(', ')}</span>`);
    if (f.size > LIMITS.maxMB * 1e6) return say(`<span class="warn">✕ ไฟล์ใหญ่เกิน ${LIMITS.maxMB} MB</span>`);

    const v = $('video');
    say('กำลังเปิดไฟล์ ...');
    let note = '';
    if (!await canDecode(v, URL.createObjectURL(f))) {
        try {
            const converted = await toH264(f, say);
            if (!await canDecode(v, URL.createObjectURL(converted))) throw new Error('decode');
            note = ' · แปลง codec เป็น H.264 แล้ว';
        } catch (e) {
            console.error(e);
            return say('<span class="warn">✕ เบราว์เซอร์นี้เปิดไฟล์ไม่ได้และแปลงไม่สำเร็จ — ลองแปลงเป็น MP4 (H.264) ก่อนอัปโหลด</span>');
        }
    }
    info.innerHTML = `<b>${f.name}</b> · ${v.videoWidth}×${v.videoHeight} · ${v.duration.toFixed(1)} s · ${(f.size / 1e6).toFixed(1)} MB${note}`;
    checkLimits();
}

async function start() {
    stop = false; snaps = {}; result = null;
    show('processing');
    const height = +$('height').value, fps = +$('fps').value;
    const status = s => { $('status').textContent = s; };
    if (!detector) { vision = await loadLibraries(status); detector = await create_pose_detector(vision); }
    status(`ประมวลผลบนเครื่องคุณ (${detector.delegate}) ...`);
    const live = $('liveMatrix'); buildMatrix(live);
    const t0 = performance.now();
    const nCalib = Math.round(CALIB_SECONDS * fps);
    let bestH = -Infinity, bestLimit = Infinity;

    result = await run_pipeline(detector, $('video'), $('out'), height, fps, {
        shouldStop: () => stop,
        onFrame(row, m, i, n) {
            $('bar').style.width = `${(100 * (i + 1) / n).toFixed(1)}%`;
            $('count').textContent = `${i + 1} / ${n} เฟรม · ${((i + 1) / ((performance.now() - t0) / 1000)).toFixed(1)} fps`;
            $('lTwist').textContent = fmt(row.twist_deg, 0) + '°';
            $('lTwist').classList.toggle('bad', row.twist_deg > TWIST_WARN_DEG);
            $('lOrient').textContent = fmt(row.orientation_deg, 0) + '°';
            $('lH').textContent = m ? fmt(m.H, 0) + ' cm' : '–';
            $('lV').textContent = m ? fmt(m.V, 0) + ' cm' : '–';
            $('lLimit').textContent = m ? m.limit_kg + ' kg' : '–';
            highlight(live, m?.row, m?.col);
            // ภาพนิ่ง 3 จังหวะ (cell 35): ระหว่าง calibrate · มือยื่นไกลสุด · น้ำหนักต่ำสุด
            const snap = () => $('out').toDataURL('image/jpeg', 0.7);
            if (row.frame_number === Math.floor(nCalib / 2)) snaps.calib = { f: row.frame_number, src: snap() };
            if (m && m.H > bestH) { bestH = m.H; snaps.maxH = { f: row.frame_number, src: snap() }; }
            if (m && m.limit_kg < bestLimit) { bestLimit = m.limit_kg; snaps.minLimit = { f: row.frame_number, src: snap() }; }
        },
    });
    status(`เสร็จ ${result.records.length} เฟรม ใน ${((performance.now() - t0) / 1000).toFixed(1)} วินาที`);
    renderDashboard();
}

// ---------------------------------------------------------------- Dashboard (cells 37–41)
function renderDashboard() {
    const { records, calib, info } = result;
    show('dashboard');
    if (!calib) { $('summary').innerHTML = '<div class="warn">คลิปสั้นกว่าช่วง calibrate</div>'; return; }
    const valid = records.filter(r => r.limit_kg !== undefined);
    const col = k => records.map(r => r[k] ?? NaN), t = col('time_s');

    // 10.2 เวลาที่มืออยู่ในแต่ละช่อง (วินาที)
    const secs = ROW_NAMES.map(() => COL_NAMES.map(() => 0));
    valid.forEach(r => { secs[ROW_NAMES.indexOf(r.zone)][COL_NAMES.indexOf(r.reach_class)] += 1 / info.fps; });
    buildMatrix($('heatMatrix'), secs);
    const worst = valid.reduce((a, r) => (a === null || r.limit_kg < a.limit_kg ? r : a), null);
    const maxH = valid.reduce((a, r) => (a === null || r.H_cm > a.H_cm ? r : a), null);
    const twists = col('twist_deg').filter(Number.isFinite);
    const maxTwist = twists.length ? Math.max(...twists) : NaN;
    if (worst) highlight($('heatMatrix'), ROW_NAMES.indexOf(worst.zone), COL_NAMES.indexOf(worst.reach_class));

    const kpi = [['น้ำหนักที่ยอมรับได้ต่ำสุด', worst ? `${worst.limit_kg} kg` : '–', worst ? `frame ${worst.frame_number} · ${worst.zone} | ${worst.reach_class}` : ''],
                 ['มุมบิดตัวสูงสุด', `${fmt(maxTwist, 0)}°`, maxTwist > TWIST_WARN_DEG ? 'เกิน 45° (T1)' : 'ไม่เกิน 45°'],
                 ['H สูงสุด', maxH ? `${fmt(maxH.H_cm)} cm` : '–', maxH ? `frame ${maxH.frame_number}` : ''],
                 ['มุมหันเทียบกล้อง (median)', `${fmt(nanmedian(col('orientation_deg')), 0)}°`, '90° = ถ่ายด้านข้าง'],
                 ['สเกล', `${calib.cm_per_px.toFixed(3)} cm/px`, `ระยะกล้อง ≈ ${calib.camera_dist_cm.toFixed(0)} cm`],
                 ['ระดับ เข่า / เอว / ไหล่', `${calib.knee_cm.toFixed(0)} / ${calib.waist_cm.toFixed(0)} / ${calib.shoulder_cm.toFixed(0)}`, 'cm จากพื้น']];
    $('kpis').innerHTML = kpi.map(([a, b, c]) => `<div class="kpi"><span>${a}</span><b>${b}</b><small>${c}</small></div>`).join('');
    $('kpis').querySelectorAll('.kpi')[1].classList.toggle('bad', maxTwist > TWIST_WARN_DEG);

    // 10.1 เส้นเวลา 4 กราฟ
    plot($('cV'), { series: [{ x: t, y: col('V_cm'), color: '#1a73e8' }], ylabel: 'V (cm)',
                    hlines: ['knee', 'waist', 'shoulder'].map(k => ({ y: calib[k + '_cm'], label: k })) });
    plot($('cH'), { series: [{ x: t, y: col('H_cm'), color: '#1a73e8' }], ylabel: 'H (cm)',
                    hlines: [{ y: REACH_LIMITS_CM[0], label: '7"' }, { y: REACH_LIMITS_CM[1], label: '12"' }] });
    plot($('cA'), { series: [{ x: t, y: col('twist_deg'), color: '#1a73e8' }, { x: t, y: col('orientation_deg'), color: '#e8710a', width: 1.5 }],
                    ylabel: 'angle (deg) — twist ฟ้า · orientation ส้ม', hlines: [{ y: TWIST_WARN_DEG, label: '45°' }], ymin: 0 });
    plot($('cL'), { series: [{ x: t, y: col('limit_kg'), color: '#1a73e8' }], ylabel: 'max weight (kg)', ymin: 0, ymax: 46, step: true });

    // เวลารวมในแต่ละแถว (โซนความสูงมือ)
    const zoneSec = {};
    valid.forEach(r => { zoneSec[r.zone] = (zoneSec[r.zone] || 0) + 1 / info.fps; });
    $('zones').innerHTML = 'เวลารวมในแต่ละโซน (วินาที): ' + Object.entries(zoneSec).map(([z, s]) => `${z} ${s.toFixed(2)}`).join(' · ');

    $('snaps').innerHTML = [['calib', 'ระหว่าง calibrate'], ['maxH', 'มือยื่นไกลที่สุด'], ['minLimit', 'น้ำหนักที่ยอมรับได้ต่ำสุด']]
        .filter(([k]) => snaps[k]).map(([k, l]) => `<figure><img src="${snaps[k].src}"><figcaption>${l} · frame ${snaps[k].f}</figcaption></figure>`).join('');

    $('rTwist').value = maxTwist >= 45 ? '0.85' : '1.0';
    $('rFreq').innerHTML = FREQ.map((f, i) => `<option value="${i}">${f[0]}</option>`).join('');
    $('meta').textContent = `${file.name} · ส่วนสูง ${calib.height_cm} cm · ${info.width}×${info.height} @ ${info.fps} fps · ${new Date().toLocaleString('th-TH')}`;
    rwl();
}

// แบบประเมินความเสี่ยงงานยก (หน้า 254): RWL = ขั้น2 × ขั้น3 × ขั้น4 · LH Index = น้ำหนัก / RWL × 100
function rwl() {
    if (!result?.calib) return;
    const valid = result.records.filter(r => r.limit_kg !== undefined);
    const step2 = valid.length ? Math.min(...valid.map(r => r.limit_kg)) : NaN;
    const step3 = FREQ[+$('rFreq').value][1 + +$('rHours').value];
    const step4 = +$('rTwist').value;
    const RWL = step2 * step3 * step4, LI = +$('rWeight').value / RWL * 100;
    const lv = !Number.isFinite(LI) ? [4, 'งานนั้นมีปัญหาควรแก้ไขปรับปรุงโดยทันที']
             : LI < 50 ? [1, 'ภาวะที่ยอมรับได้'] : LI <= 75 ? [2, 'งานนั้นควรมีการตรวจสอบและติดตาม']
             : LI <= 100 ? [3, 'งานนั้นเริ่มมีปัญหาควรตรวจสอบเพื่อปรับปรุง'] : [4, 'งานนั้นมีปัญหาควรแก้ไขปรับปรุงโดยทันที'];
    $('rOut').innerHTML = `<div>ขั้น 2 = <b>${step2} kg</b> × ขั้น 3 = <b>${step3}</b> × ขั้น 4 = <b>${step4}</b></div>
        <div>RWL = <b>${fmt(RWL, 2)} kg</b> · LH Index = <b>${fmt(LI, 0)}%</b></div>
        <div class="lv lv${lv[0]}">ระดับ ${lv[0]} — ${lv[1]}</div>`;
}

// ---------------------------------------------------------------- Export
function downloadCSV() {
    const lines = [CSV_COLS.join(',')].concat(result.records.map(r => CSV_COLS.map(k => r[k] ?? '').join(',')));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    a.download = file.name.replace(/\.[^.]+$/, '') + '_weightlimit.csv';
    a.click();
}

function show(id) { ['upload', 'processing', 'dashboard'].forEach(s => $(s).hidden = s !== id && !(id === 'dashboard' && s === 'processing')); }

$('file').onchange = e => e.target.files[0] && onFile(e.target.files[0]);
const drop = $('drop');
drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
drop.ondragleave = () => drop.classList.remove('over');
drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); e.dataTransfer.files[0] && onFile(e.dataTransfer.files[0]); };
$('start').onclick = () => start().catch(e => { $('status').textContent = 'ผิดพลาด: ' + (e.message || e); console.error(e); });
$('stop').onclick = () => { stop = true; };
$('csv').onclick = downloadCSV;
$('pdf').onclick = () => window.print();
$('again').onclick = () => location.reload();
['rWeight', 'rFreq', 'rHours', 'rTwist'].forEach(id => $(id).oninput = rwl);
$('fps').oninput = () => { if ($('video').duration) checkLimits(); };
buildMatrix($('previewMatrix'));
