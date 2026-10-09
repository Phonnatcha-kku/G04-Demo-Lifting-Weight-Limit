// Line-by-line port of Workshop_LiftingWeightLimit_Realtime_Colab.ipynb (Nick / pond / ton).
// Function names, constants and step numbers ①–⑨ are kept identical to the notebook.
// Runs entirely in the browser: MediaPipe Tasks (WASM + GPU/CPU) replaces mediapipe-python,
// OpenCV.js replaces cv2 (solvePnP, Rodrigues, getPerspectiveTransform, warpPerspective, drawing).
// Frames are handled in BGR exactly like cv2, so every colour tuple is copied verbatim.

import { FilesetResolver, PoseLandmarker } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';

const MP_WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const POSE_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/'
                     + 'pose_landmarker_lite/float16/latest/pose_landmarker_lite.task';
const OPENCV_URL = 'https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.10.0-release.1/dist/opencv.js';

let cv = null;
let FPS = 30;

// ---------------------------------------------------------------- ค่าคงที่ (ตรงกับ notebook)
export const MIN_CONFIDENCE = 0.5, MAX_PREDICT_FRAMES = 5, HISTORY_FRAMES = 3, WORLD_WINDOW = 5;
export const NOSE_ABOVE_FOOT = 0.905, CALIB_SECONDS = 1.5, CAMERA_FOV_DEG = 70.0, WAIST_FRACTION = 0.30;
const FEET = [29, 30, 31, 32];
const LOWER = [27, 28, 29, 30, 31, 32];
const PNP_POINTS = [0, 11, 12, 13, 14, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32];
export const TWIST_WARN_DEG = 45.0;
export const REACH_LIMITS_CM = [7 * 2.54, 12 * 2.54];
export const ROW_NAMES = ['Above Shoulder', 'Waist-Shoulder', 'Knee-Waist', 'Below Knee'];
export const COL_NAMES = ['Near', 'Mild', 'Extended'];
export const WEIGHT_LIMITS_KG = [[29, 18, 14], [32, 23, 18], [41, 25, 18], [31, 23, 16]];
const LEFT_HAND = [15, 17, 19], RIGHT_HAND = [16, 18, 20];
const TABLE_LENGTH_CM = 55.0, ABOVE_MARGIN_CM = 30.0, HEADER_CM = 10.0, PX_PER_CM = 8, CELL_ALPHA = 0.45;
const SKELETON = [[11, 12], [11, 23], [12, 24], [23, 24],
                  [11, 13], [13, 15], [15, 17], [15, 19],
                  [12, 14], [14, 16], [16, 18], [16, 20],
                  [23, 25], [25, 27], [27, 29], [27, 31], [29, 31],
                  [24, 26], [26, 28], [28, 30], [28, 32], [30, 32],
                  [0, 11], [0, 12]];

// ---------------------------------------------------------------- numpy helpers
const isnan = Number.isNaN;
const finite = v => v.every(Number.isFinite);
const add = (a, b) => a.map((v, i) => v + b[i]);
const sub = (a, b) => a.map((v, i) => v - b[i]);
const mul = (a, k) => a.map(v => v * k);
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const deg = r => r * 180 / Math.PI;
const clip = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

function nanmean1(vals) { let s = 0, n = 0; for (const v of vals) if (!isnan(v)) { s += v; n++; } return n ? s / n : NaN; }
function nanmeanRows(rows) { return rows[0].map((_, j) => nanmean1(rows.map(r => r[j]))); }        // np.nanmean(axis=0)
function meanRows(rows) { return rows.length ? rows[0].map((_, j) => rows.reduce((s, r) => s + r[j], 0) / rows.length) : [NaN, NaN, NaN]; }
function nanmax(vals) { const v = vals.filter(x => !isnan(x)); return v.length ? Math.max(...v) : NaN; }
function nanmin(vals) { const v = vals.filter(x => !isnan(x)); return v.length ? Math.min(...v) : NaN; }
export function nanmedian(vals) {
    const v = vals.filter(x => !isnan(x)).sort((a, b) => a - b);
    if (!v.length) return NaN;
    const m = v.length >> 1;
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}
function median(vals) { return vals.some(isnan) ? NaN : nanmedian(vals); }                           // np.median
function medianRows(rows) { return rows.length ? rows[0].map((_, j) => median(rows.map(r => r[j]))) : [NaN, NaN, NaN]; }
function unit(v) { const n = Math.hypot(...v); return v.map(x => x / n); }
function mean_point(points, ids) { return nanmeanRows(ids.map(i => points[i])); }

// small dense matrices for the Kalman filter (cv2.KalmanFilter equations)
const T = A => A[0].map((_, j) => A.map(r => r[j]));
const mm = (A, B) => A.map(r => B[0].map((_, j) => r.reduce((s, v, k) => s + v * B[k][j], 0)));
const madd = (A, B) => A.map((r, i) => r.map((v, j) => v + B[i][j]));
const msub = (A, B) => A.map((r, i) => r.map((v, j) => v - B[i][j]));
const inv2 = ([[a, b], [c, d]]) => { const k = a * d - b * c; return [[d / k, -b / k], [-c / k, a / k]]; };

// ---------------------------------------------------------------- โหลด OpenCV.js + MediaPipe
export async function loadLibraries(onStatus = () => {}) {
    onStatus('กำลังโหลด OpenCV.js ...');
    if (!window.cv) await new Promise((ok, fail) => {
        const s = document.createElement('script');
        s.src = OPENCV_URL; s.async = true; s.onload = ok; s.onerror = fail;
        document.head.appendChild(s);
    });
    cv = window.cv instanceof Promise ? await window.cv : window.cv;
    if (!cv.Mat) await new Promise(r => { cv.onRuntimeInitialized = r; });
    onStatus('กำลังโหลด MediaPipe Pose Landmarker ...');
    return FilesetResolver.forVisionTasks(MP_WASM);
}

// ---------------------------------------------------------------- ② Keypoints
export async function create_pose_detector(vision) {
    // GPU ของเครื่องผู้ใช้ก่อน ถ้าไม่ได้ใช้ CPU
    for (const delegate of ['GPU', 'CPU']) {
        try {
            const d = await PoseLandmarker.createFromOptions(vision, {
                baseOptions: { modelAssetPath: POSE_MODEL_URL, delegate },
                runningMode: 'VIDEO', numPoses: 1 });
            d.delegate = delegate;
            return d;
        } catch (e) { if (delegate === 'CPU') throw e; }
    }
}

function extract_keypoints(detector, frame, frame_index) {
    // ② คืน xy (33, 2) พิกเซล · world (33, 3) เมตร · conf (33,)   (เป็น NaN ถ้าไม่พบคน)
    const w = frame.width, h = frame.height;
    const timestamp_ms = Math.trunc(frame_index * 1000 / FPS);
    const result = detector.detectForVideo(frame, timestamp_ms);
    const xy = Array.from({ length: 33 }, () => [NaN, NaN]);
    const world = Array.from({ length: 33 }, () => [NaN, NaN, NaN]);
    const conf = new Array(33).fill(NaN);
    if (result.landmarks.length) {
        result.landmarks[0].forEach((lm, i) => {
            xy[i] = [lm.x * w, lm.y * h];
            // JS API ไม่มี presence แยก → ใช้ visibility (min(visibility, presence) ใน Python)
            conf[i] = Math.min(lm.visibility ?? 1, lm.presence ?? lm.visibility ?? 1);
        });
        result.worldLandmarks[0].forEach((lm, i) => { world[i] = [lm.x, lm.y, lm.z]; });
    }
    return [xy, world, conf];
}

// ---------------------------------------------------------------- ③ Tracking + smoothing
function create_kalman(x, y) {
    // Kalman filter แบบความเร็วคงที่  สถานะ = [x, y, vx, vy]  ค่าวัด = [x, y]
    const acc = [[0.5, 0], [0, 0.5], [1, 0], [0, 1]];
    return {
        A: [[1, 0, 1, 0], [0, 1, 0, 1], [0, 0, 1, 0], [0, 0, 0, 1]],
        H: [[1, 0, 0, 0], [0, 1, 0, 0]],
        Q: mm(acc, T(acc)).map(r => r.map(v => 16.0 * v)),
        R: [[25, 0], [0, 25]],
        P: [[25, 0, 0, 0], [0, 25, 0, 0], [0, 0, 400, 0], [0, 0, 0, 400]],
        x: [[x], [y], [0], [0]],
        predict() {                                   // cv2.KalmanFilter.predict
            this.x = mm(this.A, this.x);
            this.P = madd(mm(mm(this.A, this.P), T(this.A)), this.Q);
            return this.x;
        },
        correct(z) {                                  // cv2.KalmanFilter.correct
            const HP = mm(this.H, this.P);
            const K = T(mm(inv2(madd(mm(HP, T(this.H)), this.R)), HP));
            this.x = madd(this.x, mm(K, msub(z, mm(this.H, this.x))));
            this.P = msub(this.P, mm(K, HP));
        },
    };
}

class PointTracker {
    constructor(width, height) {
        this.width = width; this.height = height;
        this.gate = Math.max(25.0, 0.04 * Math.hypot(width, height));
        this.kalman = null; this.missing = 0; this.history = [];
    }

    update(x, y, conf) {
        const good = conf >= MIN_CONFIDENCE && 0 <= x && x < this.width && 0 <= y && y < this.height;
        let point = null, observed = false;
        if (this.kalman === null) {
            if (good) { this.kalman = create_kalman(x, y); point = [x, y]; observed = true; }
        } else {
            const s = this.kalman.predict(), predicted = [s[0][0], s[1][0]];      // (ก-1) predict
            const jump = good ? Math.hypot(x - predicted[0], y - predicted[1]) : 0;
            if (good && jump <= this.gate) {                                       // (ก-2) correct
                this.kalman.correct([[x], [y]]);
                point = [x, y]; observed = true; this.missing = 0;
            } else {
                this.missing += 1;
                const inside = 0 <= predicted[0] && predicted[0] < this.width && 0 <= predicted[1] && predicted[1] < this.height;
                if (this.missing <= MAX_PREDICT_FRAMES && inside) point = predicted;
                else { this.kalman = null; this.missing = 0; this.history = []; }
            }
        }
        if (point === null) return [[NaN, NaN], false];
        this.history = [...this.history, point].slice(-(HISTORY_FRAMES + 1));      // (ข) moving average
        return [meanRows(this.history), observed];
    }
}

class PoseSmoother {
    constructor(width, height) {
        this.trackers = Array.from({ length: 33 }, () => new PointTracker(width, height));
        this.world_history = [];
    }

    update(xy, world, conf) {
        const xy_s = [], observed = [];
        for (let i = 0; i < 33; i++) [xy_s[i], observed[i]] = this.trackers[i].update(xy[i][0], xy[i][1], conf[i]);
        this.world_history = [...this.world_history, world].slice(-WORLD_WINDOW);
        const world_s = world.map((_, i) => nanmeanRows(this.world_history.map(w => w[i])));   // (ค)
        return [xy_s, world_s, observed];
    }
}

// ---------------------------------------------------------------- ④ วาด keypoint (BGR)
const S = (b, g, r) => new cv.Scalar(b, g, r, 255);
const P = p => new cv.Point(Math.round(p[0]), Math.round(p[1]));    // pt()
const ui_scale = img => img.cols / 720;
const FONT = () => cv.FONT_HERSHEY_SIMPLEX;

function draw_skeleton(img, xy_s, observed) {
    const s = ui_scale(img);
    for (const [a, b] of SKELETON)
        if (finite(xy_s[a]) && finite(xy_s[b]))
            cv.line(img, P(xy_s[a]), P(xy_s[b]), S(255, 255, 255), Math.max(1, Math.trunc(2 * s)), cv.LINE_AA);
    for (const [a, b] of SKELETON)
        for (const p of [a, b])
            if (finite(xy_s[p]))
                cv.circle(img, P(xy_s[p]), Math.max(2, Math.trunc(4 * s)), observed[p] ? S(0, 200, 0) : S(0, 140, 255), -1, cv.LINE_AA);
    return img;
}

// ---------------------------------------------------------------- ⑤ สเกล + พิกัด 3 มิติ
function calc_cm_per_px(xy_frames, height_cm) {
    const distances = xy_frames.map(xy => nanmax(FEET.map(i => xy[i][1])) - xy[0][1]);
    return height_cm * NOSE_ABOVE_FOOT / nanmedian(distances);
}

function camera_matrix(width, height) {
    const f = (Math.max(width, height) / 2) / Math.tan(CAMERA_FOV_DEG * Math.PI / 180 / 2);
    return [[f, 0, width / 2], [0, f, height / 2], [0, 0, 1]];
}

function calc_world_scale(world_frames, height_cm) {
    const heights = world_frames.map(world => {
        const axis = unit(sub(mean_point(world, [23, 24]), mean_point(world, LOWER)));
        return nanmax(FEET.map(i => dot(sub(world[0], world[i]), axis))) * 100;
    });
    return height_cm * NOSE_ABOVE_FOOT / nanmedian(heights);
}

function solve_camera_pose(Pw, xy, observed, K, previous = null) {
    const ids = PNP_POINTS.filter(i => observed[i]);
    if (ids.length < 6) return null;
    const obj = cv.matFromArray(ids.length, 3, cv.CV_64F, ids.flatMap(i => Pw[i]));
    const img = cv.matFromArray(ids.length, 2, cv.CV_64F, ids.flatMap(i => xy[i]));
    const Km = cv.matFromArray(3, 3, cv.CV_64F, K.flat());
    const dist = new cv.Mat(), R = new cv.Mat();
    let rvec, tvec, ok;
    if (previous === null) {
        rvec = new cv.Mat(); tvec = new cv.Mat();
        ok = cv.solvePnP(obj, img, Km, dist, rvec, tvec);
    } else {                                                     // ใช้ผลเฟรมก่อนเป็นจุดเริ่ม
        rvec = cv.matFromArray(3, 1, cv.CV_64F, previous.rvec);
        tvec = cv.matFromArray(3, 1, cv.CV_64F, previous.tvec);
        ok = cv.solvePnP(obj, img, Km, dist, rvec, tvec, true);
    }
    let out = null;
    if (ok) {
        cv.Rodrigues(rvec, R);
        const r = R.data64F;
        out = { R: [[r[0], r[1], r[2]], [r[3], r[4], r[5]], [r[6], r[7], r[8]]],
                t: Array.from(tvec.data64F), rvec: Array.from(rvec.data64F), tvec: Array.from(tvec.data64F) };
    }
    [obj, img, Km, dist, R, rvec, tvec].forEach(m => m.delete());
    return out;
}

function to_camera_3d(xy, Pw, pose, K) {
    return Pw.map((p, i) => {
        const pc = add([dot(pose.R[0], p), dot(pose.R[1], p), dot(pose.R[2], p)], pose.t);   // P @ R.T + t
        if (isnan(xy[i][0])) return pc;                          // จุดที่ไม่เห็นในภาพ → ใช้โครงร่างแทน
        const Z = pc[2];
        return [(xy[i][0] - K[0][2]) * Z / K[0][0], (xy[i][1] - K[1][2]) * Z / K[1][1], Z];
    });
}

function project(p, K) {
    return [K[0][0] * p[0] / p[2] + K[0][2], K[1][1] * p[1] / p[2] + K[1][2]];
}

function body_frame(C, up, floor = null) {
    const ankle = mean_point(C, [27, 28]);
    let side = sub(C[24], C[23]);
    side = unit(sub(side, mul(up, dot(side, up))));
    let front = unit(cross(side, up));
    const toe = mean_point(C, [31, 32]), heel = mean_point(C, [29, 30]);
    if (dot(sub(toe, heel), front) < 0) front = mul(front, -1);
    const drop = floor === null ? nanmin(FEET.map(i => dot(sub(C[i], ankle), up))) : dot(sub(floor, ankle), up);
    const O = add(ankle, mul(up, drop));
    if (!(finite(O) && finite(front))) return null;
    return { O, up, side, front };
}

function body_coords(p, body) {
    const d = sub(p, body.O);
    return [dot(d, body.front), dot(d, body.up), dot(d, body.side)];
}

function twist_angle(world) {
    const axis = unit(sub(mean_point(world, [23, 24]), mean_point(world, LOWER)));
    let hip = sub(world[24], world[23]), shoulder = sub(world[12], world[11]);
    hip = unit(sub(hip, mul(axis, dot(hip, axis))));
    shoulder = unit(sub(shoulder, mul(axis, dot(shoulder, axis))));
    return deg(Math.atan2(dot(cross(hip, shoulder), axis), dot(hip, shoulder)));
}

function calibrate(samples, height_cm, width, height) {
    const calib = { height_cm };
    calib.cm_per_px = calc_cm_per_px(samples.map(s => s.xy), height_cm);                       // 5.1
    calib.K = camera_matrix(width, height);
    calib.camera_dist_cm = calib.K[0][0] * calib.cm_per_px;
    calib.world_scale = calc_world_scale(samples.map(s => s.world), height_cm);                // 5.2

    const C_list = [], axes = [];
    let pose = null;
    for (const s of samples) {
        const Pw = s.world.map(p => mul(p, 100 * calib.world_scale));
        pose = solve_camera_pose(Pw, s.xy, s.observed, calib.K, pose);
        if (pose === null) continue;
        const C = to_camera_3d(s.xy, Pw, pose, calib.K);
        C_list.push(C);
        axes.push(unit(sub(mean_point(C, [23, 24]), mean_point(C, LOWER))));
    }
    calib.up = unit(meanRows(axes));                                                           // 5.3
    const floors = [];
    for (const C of C_list) { const body = body_frame(C, calib.up); if (body !== null) floors.push(body.O); }
    calib.floor = medianRows(floors);

    const knee = [], hip = [], shoulder = [];
    for (const C of C_list) {
        const body = body_frame(C, calib.up, calib.floor);
        if (body === null) continue;
        knee.push(body_coords(mean_point(C, [25, 26]), body)[1]);
        hip.push(body_coords(mean_point(C, [23, 24]), body)[1]);
        shoulder.push(body_coords(mean_point(C, [11, 12]), body)[1]);
    }
    calib.knee_cm = median(knee);
    calib.shoulder_cm = median(shoulder);
    calib.waist_cm = median(hip) + WAIST_FRACTION * (calib.shoulder_cm - median(hip));
    calib.twist_baseline = nanmedian(samples.map(s => twist_angle(s.world)));
    return calib;
}

// ---------------------------------------------------------------- ⑥ ⑦ มุม
function orientation_angle(C) {
    const d = sub(C[24], C[23]);
    const yaw = Math.abs(deg(Math.atan2(d[2], d[0])));
    return Math.min(yaw, 180 - yaw);
}

function twist_from_baseline(world, calib) {
    const diff = twist_angle(world) - calib.twist_baseline;
    return Math.abs((((diff + 180) % 360) + 360) % 360 - 180);   // Python % (floor mod)
}

// ---------------------------------------------------------------- ⑧ ตาราง 3×4
function table_row(v_cm, calib) {
    if (v_cm >= calib.shoulder_cm) return 0;
    if (v_cm >= calib.waist_cm) return 1;
    if (v_cm >= calib.knee_cm) return 2;
    return 3;
}

function table_col(h_cm) {
    if (h_cm < REACH_LIMITS_CM[0]) return 0;
    if (h_cm < REACH_LIMITS_CM[1]) return 1;
    return 2;
}

function measure_hands(C, xy, calib) {
    const body = body_frame(C, calib.up, calib.floor);
    if (body === null) return null;
    const hands_3d = nanmeanRows([mean_point(C, LEFT_HAND), mean_point(C, RIGHT_HAND)]);
    let hands_px = nanmeanRows([mean_point(xy, LEFT_HAND), mean_point(xy, RIGHT_HAND)]);
    if (hands_3d.some(isnan)) return null;
    if (hands_px.some(isnan)) hands_px = project(hands_3d, calib.K);
    const [front, v_cm, side] = body_coords(hands_3d, body);
    const h_cm = Math.hypot(front, side);
    const row = table_row(v_cm, calib), col = table_col(h_cm);
    return { H: h_cm, V: v_cm, front, side, row, col, limit_kg: WEIGHT_LIMITS_KG[row][col],
             hands_px, body, direction: front < -REACH_LIMITS_CM[0] ? -1 : 1 };
}

export function cell_color(kg) {
    // BGR: น้ำหนักมาก = ครีมอ่อน · น้อย = แดงเข้ม
    const t = (41 - kg) / (41 - 14);
    const light = [160, 225, 255], dark = [20, 20, 170];
    return light.map((c, i) => Math.trunc(c + (dark[i] - c) * t));
}

function make_table_image(calib, highlight, axis_on_left) {
    const top_cm = calib.shoulder_cm + ABOVE_MARGIN_CM + HEADER_CM;
    const w = Math.trunc(TABLE_LENGTH_CM * PX_PER_CM), h = Math.trunc(top_cm * PX_PER_CM);
    const color = cv.Mat.zeros(h, w, cv.CV_8UC3);
    const alpha_uint8 = cv.Mat.zeros(h, w, cv.CV_8UC1);
    const col_edges = [0, REACH_LIMITS_CM[0], REACH_LIMITS_CM[1], TABLE_LENGTH_CM];
    const row_edges = [calib.shoulder_cm + ABOVE_MARGIN_CM, calib.shoulder_cm, calib.waist_cm, calib.knee_cm, 0];
    const to_x = cm => { const x = Math.trunc(cm * PX_PER_CM); return axis_on_left ? x : w - x; };
    const to_y = cm => Math.trunc((top_cm - cm) * PX_PER_CM);
    const write = (text, pos, size, thick, rgb = [255, 255, 255]) => {
        cv.putText(color, text, new cv.Point(...pos), FONT(), size, S(...rgb), thick, cv.LINE_AA);
        cv.putText(alpha_uint8, text, new cv.Point(...pos), FONT(), size, new cv.Scalar(255), thick, cv.LINE_AA);
    };

    for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 3; c++) {
            const [x0, x1] = [to_x(col_edges[c]), to_x(col_edges[c + 1])].sort((a, b) => a - b);
            const y0 = to_y(row_edges[r]), y1 = to_y(row_edges[r + 1]);
            const kg = WEIGHT_LIMITS_KG[r][c];
            const is_hand_cell = r === highlight[0] && c === highlight[1];
            cv.rectangle(color, new cv.Point(x0, y0), new cv.Point(x1, y1), is_hand_cell ? S(0, 230, 255) : S(...cell_color(kg)), -1);
            if (x1 > x0 && y1 > y0) {
                const roi = alpha_uint8.roi(new cv.Rect(x0, y0, x1 - x0, Math.min(y1, h) - y0));
                roi.setTo(new cv.Scalar(Math.trunc(255 * (is_hand_cell ? 0.85 : CELL_ALPHA))));
                roi.delete();
            }
            cv.rectangle(color, new cv.Point(x0, y0), new cv.Point(x1, y1), S(255, 255, 255), 2);
            cv.rectangle(alpha_uint8, new cv.Point(x0, y0), new cv.Point(x1, y1), new cv.Scalar(255), 2);
            write(String(kg), [Math.floor((x0 + x1) / 2) - 22, Math.floor((y0 + y1) / 2) + 15], 1.6, 4,
                  is_hand_cell ? [0, 0, 0] : [255, 255, 255]);
        }
        write(ROW_NAMES[r], [!axis_on_left ? 8 : w - 190, to_y(row_edges[r]) + 26], 0.7, 2);
    }
    for (let c = 0; c < 3; c++) {
        const x0 = Math.min(to_x(col_edges[c]), to_x(col_edges[c + 1]));
        write(COL_NAMES[c], [x0 + 8, to_y(row_edges[0]) - 14], 0.7, 2);
    }
    write('MAX WEIGHT (kg)', [Math.floor(w / 2) - 120, 30], 0.8, 2);

    const alpha = new cv.Mat();
    alpha_uint8.convertTo(alpha, cv.CV_32F, 1 / 255);
    alpha_uint8.delete();
    return [color, alpha];
}

function draw_weight_table(img, calib, m) {
    const K = calib.K, { O, up } = m.body, front = mul(m.body.front, m.direction);
    const top_cm = calib.shoulder_cm + ABOVE_MARGIN_CM + HEADER_CM;
    const corners_3d = [O, add(O, mul(front, TABLE_LENGTH_CM)),
                        add(add(O, mul(front, TABLE_LENGTH_CM)), mul(up, top_cm)), add(O, mul(up, top_cm))];
    if (corners_3d.some(p => p[2] < 10)) return img;                         // อยู่หลังกล้อง → ไม่วาด
    const corners_px = corners_3d.map(p => project(p, K).map(Math.fround));
    const dst = cv.matFromArray(4, 1, cv.CV_32FC2, corners_px.flat());
    if (Math.abs(cv.contourArea(dst)) < 0.002 * img.rows * img.cols) { dst.delete(); return img; }

    const axis_on_left = corners_px[1][0] >= corners_px[0][0];
    const [table, alpha] = make_table_image(calib, [m.row, m.col], axis_on_left);
    const th = alpha.rows, tw = alpha.cols;
    const [x_body, x_end] = axis_on_left ? [0, tw] : [tw, 0];
    const src = cv.matFromArray(4, 1, cv.CV_32FC2, [x_body, th, x_end, th, x_end, 0, x_body, 0]);
    const M = cv.getPerspectiveTransform(src, dst);
    const size = new cv.Size(img.cols, img.rows);
    const warped = new cv.Mat(), warped_alpha = new cv.Mat();
    cv.warpPerspective(table, warped, M, size);
    cv.warpPerspective(alpha, warped_alpha, M, size);
    const I = img.data, W = warped.data, A = warped_alpha.data32F;
    for (let p = 0; p < A.length; p++) {
        const a = A[p];
        if (a === 0) continue;
        for (let ch = 0; ch < 3; ch++) I[p * 3 + ch] = Math.trunc(I[p * 3 + ch] * (1 - a) + W[p * 3 + ch] * a);
    }
    [dst, src, M, table, alpha, warped, warped_alpha].forEach(x => x.delete());
    return img;
}

function draw_hand_label(img, calib, m) {
    const K = calib.K, s = ui_scale(img), { O, up } = m.body, front = mul(m.body.front, m.direction);
    const on_table = project(add(add(O, mul(front, m.H)), mul(up, m.V)), K);
    const hands = m.hands_px;
    cv.line(img, P(hands), P(on_table), S(255, 255, 255), Math.max(1, Math.trunc(2 * s)), cv.LINE_AA);
    cv.circle(img, P(on_table), Math.trunc(7 * s), S(255, 255, 255), -1, cv.LINE_AA);
    cv.circle(img, P(hands), Math.trunc(16 * s), S(0, 230, 255), Math.max(2, Math.trunc(3 * s)), cv.LINE_AA);

    const anchor = project(add(add(O, mul(front, TABLE_LENGTH_CM + 3)), mul(up, m.V)), K);
    const box_w = Math.trunc(230 * s), box_h = Math.trunc(80 * s);
    let x0 = anchor[0] >= project(O, K)[0] ? anchor[0] : anchor[0] - box_w;
    x0 = Math.trunc(clip(x0, 5, img.cols - box_w - 5));
    const y0 = Math.trunc(clip(anchor[1] - box_h / 2, 5, img.rows - box_h - 5));
    const pt = (x, y) => new cv.Point(x, y);
    cv.line(img, P(on_table), pt(x0 + Math.floor(box_w / 2), y0 + Math.floor(box_h / 2)), S(0, 230, 255), Math.max(2, Math.trunc(3 * s)));
    cv.rectangle(img, pt(x0, y0), pt(x0 + box_w, y0 + box_h), S(0, 230, 255), -1);
    cv.rectangle(img, pt(x0, y0), pt(x0 + box_w, y0 + box_h), S(0, 0, 0), 2);
    const thin = Math.max(1, Math.trunc(1.5 * s));
    cv.putText(img, `MAX ${m.limit_kg} kg`, pt(x0 + Math.trunc(10 * s), y0 + Math.trunc(35 * s)), FONT(), 1.0 * s, S(0, 0, 0), Math.max(2, Math.trunc(3 * s)), cv.LINE_AA);
    cv.putText(img, `${ROW_NAMES[m.row]} | ${COL_NAMES[m.col]}`, pt(x0 + Math.trunc(10 * s), y0 + Math.trunc(55 * s)), FONT(), 0.45 * s, S(0, 0, 0), thin, cv.LINE_AA);
    cv.putText(img, `H ${f0(m.H)} cm   V ${f0(m.V)} cm`, pt(x0 + Math.trunc(10 * s), y0 + Math.trunc(72 * s)), FONT(), 0.45 * s, S(0, 0, 0), thin, cv.LINE_AA);
    return img;
}

// ---------------------------------------------------------------- ⑨ รวมทุกขั้น
const f0 = v => isnan(v) || v === undefined ? 'nan' : v.toFixed(0);

function draw_info_panel(img, lines) {
    const s = ui_scale(img), line_h = Math.trunc(26 * s);
    const overlay = img.clone();
    cv.rectangle(overlay, new cv.Point(0, 0), new cv.Point(Math.trunc(360 * s), Math.trunc(15 * s) + line_h * lines.length), S(0, 0, 0), -1);
    cv.addWeighted(overlay, 0.55, img, 0.45, 0, img);
    overlay.delete();
    lines.forEach(([text, color], i) => cv.putText(img, text, new cv.Point(Math.trunc(10 * s), Math.trunc(28 * s) + i * line_h),
        FONT(), 0.55 * s, S(...color), Math.max(1, Math.trunc(1.5 * s)), cv.LINE_AA));
    return img;
}

function seek(video, t) {
    return new Promise(r => { video.addEventListener('seeked', r, { once: true }); video.currentTime = t; });
}

/**
 * run_pipeline() of the notebook. `video` replaces cv2.VideoCapture (one seek per frame so no frame is
 * skipped), `outCanvas` replaces cv2.VideoWriter (live preview). Returns { records, calib, info }.
 * hooks.onFrame(row, m, i, n) fires per frame; hooks.shouldStop() lets the user cancel.
 */
export async function run_pipeline(detector, video, outCanvas, height_cm, fps, hooks = {}) {
    FPS = fps;
    const info = { fps, width: video.videoWidth, height: video.videoHeight, frames: Math.floor(video.duration * fps) };
    const src = document.createElement('canvas');
    src.width = outCanvas.width = info.width;
    src.height = outCanvas.height = info.height;
    const ctx = src.getContext('2d', { willReadFrequently: true });
    const smoother = new PoseSmoother(info.width, info.height);
    const n_calib = Math.round(CALIB_SECONDS * info.fps);
    let calib = null, pose = null;
    const samples = [], records = [];
    const WHITE = [255, 255, 255], YELLOW = [0, 230, 255], RED = [80, 80, 255];

    for (let i = 0; i < info.frames; i++) {
        if (hooks.shouldStop?.()) break;
        await seek(video, (i + 0.5) / info.fps);                                 // ① อ่านเฟรม
        ctx.drawImage(video, 0, 0);
        const [xy, world, conf] = extract_keypoints(detector, src, i);          // ② keypoint
        const [xy_s, world_s, observed] = smoother.update(xy, world, conf);     // ③ ลดการสั่น
        const rgba = cv.imread(src), img = new cv.Mat();
        cv.cvtColor(rgba, img, cv.COLOR_RGBA2BGR);
        rgba.delete();
        const row = { frame_number: i + 1, time_s: (i + 1) / info.fps };
        let m = null;

        if (calib === null) {                                                   // ⑤ ช่วงยืนนิ่ง
            samples.push({ xy: xy_s, world: world_s, observed });
            if (samples.length === n_calib) calib = calibrate(samples, height_cm, info.width, info.height);
            draw_skeleton(img, xy_s, observed);                                 // ④
            draw_info_panel(img, [[`CALIBRATING... stand still ${samples.length}/${n_calib}`, YELLOW]]);
        } else {
            const Pw = world_s.map(p => mul(p, 100 * calib.world_scale));        // ⑤ พิกัด 3 มิติ
            pose = solve_camera_pose(Pw, xy_s, observed, calib.K, pose);
            if (pose !== null) {
                const C = to_camera_3d(xy_s, Pw, pose, calib.K);
                row.orientation_deg = orientation_angle(C);                     // ⑥
                m = measure_hands(C, xy_s, calib);                              // ⑧ H, V
            }
            row.twist_deg = twist_from_baseline(world_s, calib);                // ⑦

            if (m !== null) draw_weight_table(img, calib, m);                   // ⑧ ตาราง
            draw_skeleton(img, xy_s, observed);                                 // ④
            const lines = [[`scale   ${calib.cm_per_px.toFixed(3)} cm/px`, WHITE],
                           [`orient  ${f0(row.orientation_deg ?? NaN)} deg to camera`, WHITE],
                           [`twist   ${f0(row.twist_deg)} deg`, row.twist_deg > TWIST_WARN_DEG ? RED : WHITE]];
            if (m !== null) {
                draw_hand_label(img, calib, m);                                 // ⑧ ป้ายน้ำหนัก
                lines.push([`hands   H ${f0(m.H)} cm | V ${f0(m.V)} cm`, WHITE],
                           [`zone    ${ROW_NAMES[m.row]} | ${COL_NAMES[m.col]}`, WHITE],
                           [`LIMIT   ${m.limit_kg} kg`, YELLOW]);
                Object.assign(row, { H_cm: m.H, V_cm: m.V, zone: ROW_NAMES[m.row],
                                     reach_class: COL_NAMES[m.col], limit_kg: m.limit_kg });
            }
            draw_info_panel(img, lines);
        }

        const out = new cv.Mat();                                               // ⑨ แสดงผลแทน VideoWriter
        cv.cvtColor(img, out, cv.COLOR_BGR2RGBA);
        cv.imshow(outCanvas, out);
        img.delete(); out.delete();
        records.push(row);
        hooks.onFrame?.(row, m, i, info.frames, calib);
    }
    return { records, calib, info };
}
