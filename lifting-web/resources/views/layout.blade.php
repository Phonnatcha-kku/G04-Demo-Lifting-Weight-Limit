<!DOCTYPE html>
<html lang="th">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>@yield('title') · Lifting Weight Limit</title>
    {{-- relative paths so the same HTML works on Herd (/) and on GitHub Pages (/repo/) --}}
    <link rel="stylesheet" href="css/app.css">
</head>
<body>
<header class="top">
    <a class="brand" href="{{ isset($static) ? 'index.html' : url('/') }}">📐 Lifting Weight Limit</a>
    <nav>
        <a href="{{ isset($static) ? 'index.html' : url('/') }}" @class(['on' => ($page ?? '') === 'app'])>วิเคราะห์วิดีโอ</a>
        <a href="{{ isset($static) ? 'design.html' : url('/design') }}" @class(['on' => ($page ?? '') === 'design'])>Wireframe · User Flow · โครงสร้าง</a>
    </nav>
</header>
<main>
    @yield('content')
</main>
<footer class="foot">CP413705 AI Workshop III · ประมวลผลบนเบราว์เซอร์ของคุณทั้งหมด — วิดีโอไม่ถูกอัปโหลดขึ้นเซิร์ฟเวอร์</footer>
@stack('scripts')
</body>
</html>
