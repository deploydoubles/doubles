<?php

use DeployDoubles\Checks\RunIdMatcher;

it('answers true when the header matches DEPLOY_RUN_ID', function () {
    expect(RunIdMatcher::match('run-123', 'run-123'))->toBeTrue();
});

it('answers false when the header differs', function () {
    expect(RunIdMatcher::match('run-123', 'run-456'))->toBeFalse();
});

it('answers null without DEPLOY_RUN_ID or without the header', function () {
    expect(RunIdMatcher::match(null, 'run-123'))->toBeNull()
        ->and(RunIdMatcher::match('run-123', null))->toBeNull()
        ->and(RunIdMatcher::match('', ''))->toBeNull();
});
