<?php

use DeployDoubles\Checks\Config;
use DeployDoubles\Checks\Tier;
use DeployDoubles\Checks\TierFilter;

const VALID_TOKEN = 'kq3V9pZt2LxR7mN4bW8yC1dF6gH0jS5aE2uT9iO3';

function fullReportFixture(): array
{
    return [
        'status' => 'pass',
        'deploy' => [
            'spec_version' => '0.1',
            'tier' => 'full',
            'settled' => true,
            'checks' => [
                'database' => ['status' => 'pass', 'expected' => 'mysql', 'observed' => 'mysql 8.4', 'detail' => 'connected; 0 migrations pending; write then read ok'],
            ],
            'app' => ['runtime' => 'php 8.4'],
            'release' => ['commit' => str_repeat('a', 40), 'booted_at' => null, 'run_id_match' => null],
        ],
    ];
}

function tierConfig(?string $token = VALID_TOKEN, string $tier = 'public'): Config
{
    return new Config('/tmp/unused', ['database' => []], tier: $tier, token: $token);
}

it('serves the public tier without a token', function () {
    $filter = new TierFilter(tierConfig());

    $tier = $filter->decide(null);
    $body = $filter->apply(fullReportFixture(), $tier, true);

    expect($tier)->toBe(Tier::Public)
        ->and($body['deploy'])->not->toHaveKeys(['release', 'app'])
        ->and($body['deploy']['tier'])->toBe('public')
        ->and($body['deploy']['checks']['database'])->toBe(['status' => 'pass']);
});

it('serves the public tier for a wrong token of valid length', function () {
    $filter = new TierFilter(tierConfig());
    $wrong = str_repeat('x', strlen(VALID_TOKEN));

    expect($filter->decide('Bearer '.$wrong))->toBe(Tier::Public);
});

it('serves the full tier for a valid bearer token', function () {
    $filter = new TierFilter(tierConfig());

    $tier = $filter->decide('Bearer '.VALID_TOKEN);
    $body = $filter->apply(fullReportFixture(), $tier, true);

    expect($tier)->toBe(Tier::Full)
        ->and($body['deploy']['release']['commit'])->toBe(str_repeat('a', 40))
        ->and($body['deploy']['release']['run_id_match'])->toBeTrue()
        ->and($body['deploy']['checks']['database']['observed'])->toBe('mysql 8.4');
});

it('accepts the bearer scheme case-insensitively and nothing else', function () {
    $filter = new TierFilter(tierConfig());

    expect($filter->decide('bearer '.VALID_TOKEN))->toBe(Tier::Full)
        ->and($filter->decide('Basic '.VALID_TOKEN))->toBe(Tier::Public)
        ->and($filter->decide(VALID_TOKEN))->toBe(Tier::Public);
});

it('serves the full tier without a token when the committed config sets tier full', function () {
    $filter = new TierFilter(tierConfig(token: null, tier: 'full'));

    expect($filter->decide(null))->toBe(Tier::Full);
});

it('ignores a token shorter than 32 characters and warns without naming it', function () {
    $short = 'short-token-123';
    $filter = new TierFilter(tierConfig(token: $short));

    expect($filter->decide('Bearer '.$short))->toBe(Tier::Public)
        ->and($filter->configurationWarning())->toBeString()->not->toContain($short);
});

it('serves the public tier when no token is configured', function () {
    $filter = new TierFilter(tierConfig(token: null));

    expect($filter->decide('Bearer '.VALID_TOKEN))->toBe(Tier::Public)
        ->and($filter->configurationWarning())->toBeNull();
});
