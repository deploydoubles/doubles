<?php

use App\DoubleFailure;
use Illuminate\Support\Facades\Route;

Route::get('/', function () {
    // Deliberate failure (spec/failure-modes.md): "/" only, so the deploy
    // report and /up keep answering and can say what is wrong.
    abort_if(DoubleFailure::is('500'), 500, 'Deliberate failure: DOUBLE_FAIL=500.');

    return view('welcome');
});
