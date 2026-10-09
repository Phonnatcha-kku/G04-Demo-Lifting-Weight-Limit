#!/usr/bin/env python3
"""
CP413705 AI Workshop III — QC gate ชุดข้อมูลวิดีโอการยก (ฉบับถ่ายด้วยมือถือ)

    python Workshop07_qc_check.py --group G07 --videos ./videos --manifest ./manifest_G07.csv

[FAIL] ต้องแก้ก่อนส่ง   [WARN] ควรแก้   ต้องไม่มี FAIL เหลือจึงอัปโหลดได้
"""
import argparse, csv, hashlib, json, os, re, subprocess, sys
from collections import Counter, defaultdict

ZONES = ["BK", "KW", "WS", "AS"]
NEG   = ["NEG-WALK", "NEG-BEND", "NEG-HOLD", "NEG-TWIST", "NEG-CARRY"]

FNAME_RE = re.compile(
    r"^G(?P<g>\d{2})_S(?P<s>\d{2})_(?P<transfer>(?:[A-Z]{2}-[A-Z]{2}|NEG-[A-Z]+))"
    r"_(?P<reach>R[NMF])_(?P<twist>T[01])_(?P<pace>P[SNF])_(?P<take>\d{2})\.mp4$"
)

REQUIRED_COLS = [
    "clip_id", "group", "subject_id", "subject_height_cm", "object_weight_kg",
    "transfer", "start_zone", "end_zone", "reach", "twist", "pace", "take",
    "start_surface_ref", "end_surface_ref", "orientation", "facing",
    "fps", "duration_s", "camera_operator", "capture_date", "consent", "status", "note",
]

MIN_DUR, MAX_DUR = 5.0, 20.0
MIN_SHORT_SIDE   = 720          # 720p ขึ้นไป จะแนวตั้งหรือแนวนอนก็ได้
TARGET_FPS       = 30.0
KEY_LANDMARKS    = [11, 12, 15, 16, 23, 24, 25, 26, 27, 28]
MIN_VIS          = 0.60         # ผ่อนเกณฑ์ให้รองรับการถือมือถือ
MIN_VIS_RATIO    = 0.85
ANCHOR           = ("BK-WS", "RM", "T0")


def probe(path):
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height,r_frame_rate:format=duration",
         "-of", "json", path], capture_output=True, text=True)
    if r.returncode:
        return None
    d = json.loads(r.stdout)
    st = d["stream" + "s"][0]
    n, dd = st["r_frame_rate"].split("/")
    return dict(w=int(st["width"]), h=int(st["height"]),
                fps=float(n) / float(dd), dur=float(d["format"]["duration"]))


def sha1(path):
    h = hashlib.sha1()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def pose_ratio(path, every=5):
    try:
        import cv2, mediapipe as mp
    except ImportError:
        return None, "ข้าม pose check (ยังไม่ได้ติดตั้ง mediapipe/opencv-python)"
    cap = cv2.VideoCapture(path)
    pose = mp.solutions.pose.Pose(model_complexity=1)
    tot = good = i = 0
    while True:
        ok, fr = cap.read()
        if not ok:
            break
        if i % every == 0:
            res = pose.process(cv2.cvtColor(fr, cv2.COLOR_BGR2RGB))
            tot += 1
            if res.pose_landmarks:
                lm = res.pose_landmarks.landmark
                if all(lm[k].visibility >= MIN_VIS for k in KEY_LANDMARKS):
                    good += 1
        i += 1
    cap.release(); pose.close()
    return (good / tot if tot else 0.0), (None if tot else "อ่านเฟรมไม่ได้")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--group", required=True)
    ap.add_argument("--videos", required=True)
    ap.add_argument("--manifest", required=True)
    ap.add_argument("--assignments", default="Workshop07_GroupAssignments.csv")
    ap.add_argument("--skip-pose", action="store_true")
    a = ap.parse_args()

    fails, warns = [], []
    F, W = fails.append, warns.append

    with open(a.manifest, encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))
    if not rows:
        F("manifest ว่างเปล่า"); return report(fails, warns)
    for c in REQUIRED_COLS:
        if c not in rows[0]:
            F(f"manifest ขาดคอลัมน์ '{c}'")
    by_id = {r["clip_id"]: r for r in rows}
    if len(by_id) != len(rows):
        F("มี clip_id ซ้ำใน manifest: " +
          str([k for k, v in Counter(r["clip_id"] for r in rows).items() if v > 1]))

    files = sorted(x for x in os.listdir(a.videos) if x.lower().endswith(".mp4"))
    for cid in by_id:
        if cid not in set(files):
            F(f"manifest อ้างไฟล์ที่ไม่มีอยู่: {cid}")
    for fn in files:
        if fn not in by_id:
            F(f"มีไฟล์แต่ไม่มีแถวใน manifest: {fn}")

    assigned = set()
    if os.path.exists(a.assignments):
        with open(a.assignments, encoding="utf-8-sig") as f:
            for r in csv.DictReader(f):
                if r["group"] == a.group:
                    assigned.add((r["transfer"], r["reach"], r["twist"]))
        if len(assigned) != 3:
            W(f"พบ config ของ {a.group} จำนวน {len(assigned)} รายการ (ควรเป็น 3)")
    else:
        W("ไม่พบไฟล์ assignments — ข้ามการตรวจ config ที่ได้รับมอบหมาย")

    seen, per_subj = {}, defaultdict(Counter)
    subjects, neg_types = set(), Counter()

    for fn in files:
        m = FNAME_RE.match(fn)
        if not m:
            F(f"ชื่อไฟล์ผิดรูปแบบ: {fn}"); continue
        if f"G{m['g']}" != a.group:
            F(f"{fn}: รหัสกลุ่มในชื่อไฟล์ไม่ตรงกับ --group {a.group}")
        key = (m["transfer"], m["reach"], m["twist"])
        s = m["s"]; subjects.add(s)
        is_neg = m["transfer"].startswith("NEG-")

        if is_neg:
            if m["transfer"] not in NEG:
                F(f"{fn}: รหัส negative ไม่อยู่ในรายการที่กำหนด")
            neg_types[m["transfer"]] += 1
            per_subj[s]["negative"] += 1
        else:
            st, en = m["transfer"].split("-")
            if st not in ZONES or en not in ZONES:
                F(f"{fn}: รหัสโซนไม่ถูกต้อง ({m['transfer']})")
            elif st == en:
                F(f"{fn}: โซนเริ่มและโซนวางเหมือนกัน")
            if key == ANCHOR:
                per_subj[s]["anchor"] += 1
            else:
                per_subj[s]["assigned"] += 1
                per_subj[s][key] += 1
                if assigned and key not in assigned:
                    F(f"{fn}: config {key} ไม่ใช่ 1 ใน 3 config ที่กลุ่ม {a.group} รับผิดชอบ")

        p = os.path.join(a.videos, fn)
        info = probe(p)
        if info is None:
            F(f"{fn}: ffprobe อ่านไม่ได้ (ไฟล์เสีย?)"); continue
        if min(info["w"], info["h"]) < MIN_SHORT_SIDE:
            F(f"{fn}: ความละเอียดต่ำเกินไป ({info['w']}x{info['h']}) ต้องด้านสั้น >= {MIN_SHORT_SIDE}px")
        if abs(info["fps"] - TARGET_FPS) > 0.5:
            F(f"{fn}: fps = {info['fps']:.2f} — normalize เป็น 30 ก่อนส่ง "
              f"(ffmpeg -i IN.mp4 -r 30 -vsync cfr -c:v libx264 -crf 22 -an OUT.mp4)")
        if not (MIN_DUR <= info["dur"] <= MAX_DUR):
            F(f"{fn}: ยาว {info['dur']:.1f} วิ นอกช่วง {MIN_DUR:.0f}-{MAX_DUR:.0f} วิ")

        h = sha1(p)
        if h in seen:
            F(f"{fn}: ไฟล์ซ้ำกับ {seen[h]} (hash เดียวกัน)")
        seen[h] = fn

        r = by_id.get(fn)
        if r:
            for col, lo, hi in [("subject_height_cm", 140, 200), ("object_weight_kg", 0, 15)]:
                try:
                    v = float(r[col])
                    if not (lo <= v <= hi):
                        F(f"{fn}: {col} = {v} นอกช่วง {lo}-{hi}")
                except (KeyError, ValueError, TypeError):
                    F(f"{fn}: {col} ว่างหรือไม่ใช่ตัวเลข")
            if str(r.get("consent", "")).strip().lower() not in ("y", "yes", "true", "1"):
                F(f"{fn}: ยังไม่ยืนยันความยินยอมของผู้ยก (consent)")
            if r.get("transfer") != m["transfer"]:
                F(f"{fn}: คอลัมน์ transfer ใน manifest ไม่ตรงกับชื่อไฟล์")
            if str(r.get("facing", "")).strip().upper() not in ("L", "R"):
                F(f"{fn}: คอลัมน์ facing ต้องเป็น L หรือ R")
            if not is_neg and not str(r.get("start_surface_ref", "")).strip():
                F(f"{fn}: start_surface_ref ว่าง — ต้องอธิบายตำแหน่งพื้นผิวที่ใช้จริง")

        if not a.skip_pose:
            ratio, err = pose_ratio(p)
            if err:
                W(f"{fn}: {err}")
            elif ratio < MIN_VIS_RATIO:
                F(f"{fn}: MediaPipe เห็น landmark ครบเพียง {ratio:.0%} ของเฟรม "
                  f"(ต้อง >= {MIN_VIS_RATIO:.0%}) — จับกล้องให้นิ่งขึ้นแล้วถ่ายใหม่")

    # ---------- โควตา: คนละ 5 คลิป = anchor 1 + assigned 3 + negative 1 ----------
    if len(subjects) < 5:
        F(f"มีผู้ยกเพียง {len(subjects)} คน — สมาชิกทุกคนในกลุ่มต้องเป็นผู้ยก")
    for s in sorted(subjects):
        c = per_subj[s]
        total = c["anchor"] + c["assigned"] + c["negative"]
        if total != 5:
            F(f"ผู้ยก S{s}: มี {total} คลิป (ต้อง 5 = anchor 1 + assigned 3 + negative 1)")
        if c["anchor"] != 1:
            F(f"ผู้ยก S{s}: anchor {c['anchor']} คลิป (ต้อง 1)")
        if c["negative"] != 1:
            F(f"ผู้ยก S{s}: negative {c['negative']} คลิป (ต้อง 1)")
        if assigned:
            miss = [k for k in assigned if c[k] != 1]
            if miss:
                F(f"ผู้ยก S{s}: ยังขาด/เกิน config {miss} (ต้องคนละ 1 คลิปครบทั้ง 3 config)")
    if len(neg_types) < 2:
        W(f"negative มีเพียง {len(neg_types)} ประเภท — ทั้งกลุ่มควรมีอย่างน้อย 2-3 ประเภท")
    paces = Counter(FNAME_RE.match(f)["pace"] for f in files if FNAME_RE.match(f))
    if len(paces) < 2:
        W("ไม่มีความหลากหลายของจังหวะการยก (pace) — ตรวจตารางกำหนด pace อีกครั้ง")
    facings = Counter(str(by_id[f].get("facing", "")).upper() for f in files if f in by_id)
    if len(set(facings) - {""}) < 2:
        W("ทุกคลิปหันทางเดียวกัน — ไม่ผิด แต่ควรมีทั้งหันซ้ายและขวาเพื่อความหลากหลาย")

    report(fails, warns)


def report(fails, warns):
    for w in warns:
        print(f"[WARN] {w}")
    for f in fails:
        print(f"[FAIL] {f}")
    print("-" * 60)
    if fails:
        print(f"[FAIL] ไม่ผ่าน QC — ต้องแก้ {len(fails)} ข้อ ({len(warns)} คำเตือน)")
        sys.exit(1)
    print(f"[OK] ผ่าน QC ทุกข้อ ({len(warns)} คำเตือน) — อัปโหลดเข้าคลังกลางได้")


if __name__ == "__main__":
    main()
