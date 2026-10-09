<?php

use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\File;

// GitHub Pages cannot run PHP: render the Blade views once into ../docs (Pages source: main branch, /docs folder).
Artisan::command('export:static', function () {
    File::deleteDirectory(base_path('../docs'));
    File::copyDirectory(public_path(), base_path('../docs'));
    File::delete([base_path('../docs/index.php'), base_path('../docs/.htaccess')]);
    File::put(base_path('../docs/index.html'), view('analyzer', ['static' => true])->render());
    File::put(base_path('../docs/design.html'), view('design', ['static' => true])->render());
    File::put(base_path('../docs/.nojekyll'), '');
    $this->info('Static site written to ../docs/');
})->purpose('Export the site as static HTML for GitHub Pages');
