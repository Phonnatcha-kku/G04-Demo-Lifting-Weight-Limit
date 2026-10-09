<?php

use Illuminate\Support\Facades\Route;

// All video processing happens in the browser (public/js); Laravel only serves the pages.
Route::view('/', 'analyzer');
Route::view('/design', 'design');
