# Lifting Weight Limit — Web App

A browser-only port of `Workshop_LiftingWeightLimit_Realtime_Colab.ipynb` (CP413705 AI Workshop III).
The user uploads a lifting video, the **user's own CPU/GPU** runs MediaPipe Pose + OpenCV.js frame by frame,
and the page shows the 3×4 max-weight matrix, a dashboard, and CSV / PDF downloads. No video leaves the browser.

Stack: Laravel 13 (routing + Blade only) · HTML · CSS · vanilla JS. No build step, no database.

| Path | Purpose |
|---|---|
| `public/js/pipeline.js` | Steps ①–⑨ of the notebook, same function names and constants |
| `public/js/app.js` | Upload, live view, dashboard (notebook step 10), RWL sheet, CSV / PDF export |
| `public/css/app.css` | UI and `@media print` layout used for the PDF |
| `resources/views/analyzer.blade.php` | Upload → Processing → Dashboard |
| `resources/views/design.blade.php` | User flow, wireframes, architecture, Colab → JS mapping |
| `routes/console.php` | `php artisan export:static` renders the views to `../docs/` for GitHub Pages |

## Run locally with Herd

1. Put the folder in your Herd path (or run `herd link lifting-web` inside it).
2. Open `http://lifting-web.test`.
3. Without Herd: `php artisan serve`, then open `http://127.0.0.1:8000`.

## Deploy to GitHub Pages

GitHub Pages cannot run PHP, so render the Blade views to static HTML in the parent repo's `docs/` folder:

```bash
php artisan export:static
```

Commit and push `docs/`. On GitHub, open **Settings → Pages → Source**, select **Deploy from a branch**,
then `main` and `/docs`. Run the export again after every change to the views, CSS, or JS.
All processing runs in the browser, so the static site works the same as the Laravel site.

## Notes

- Accepted files: MP4, MOV, M4V, WEBM, MKV, AVI. Limits: 1 GB and at most 9,000 frames.
- If the browser cannot decode the file (for example H.265/HEVC from a phone), the app converts it to H.264 in the browser with ffmpeg.wasm (`public/js/vendor/ffmpeg`, core loaded from jsdelivr, about 32 MB on first use).
- You must enter the video FPS yourself (default 30). Browsers do not report FPS.
- MediaPipe JS does not report `presence` separately, so the confidence value is `visibility`.
- The app shows the annotated frames on a canvas. It does not write an output MP4.
- On the 10.6 s sample clip, the browser results match the Colab output closely. Examples:
  cm/px is 0.179 in the browser and 0.178 in Colab. The minimum limit is 14 kg in both.
  Max twist is 23° in the browser and 21° in Colab. Zone times differ by less than 0.15 s.
