<?php

/*
| Deliberate failures (spec/failure-modes.md).
|
| DOUBLE_FAIL=<mode>@<commit> makes this double fail on purpose, and only on
| the release built from <commit>. It is read here and nowhere else: with the
| configuration cached, env() outside a config file returns null, so every
| read in the app goes through config('double.fail'). See App\DoubleFailure.
*/

return [

    'fail' => env('DOUBLE_FAIL'),

];
