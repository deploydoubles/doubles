<?php

/*
 * The framework-less entry points, autoloaded through composer.json "files".
 *
 *   DeployDoubles\Checks\serve()  — call it from your front controller for
 *                                   GET /.well-known/deploy-report
 *   DeployDoubles\Checks\run()    — run the checks and store the results;
 *                                   cron calls it every minute through
 *                                   vendor/bin/deploy-report-run
 *
 * Both read deploy-report.php from the app root (the directory that holds
 * vendor/), and reuse the core ReportReader, TierFilter and Runner unchanged.
 */

declare(strict_types=1);

namespace DeployDoubles\Checks;

use DeployDoubles\Checks\Standalone\StandaloneChecks;
use DeployDoubles\Checks\Standalone\StandaloneConfig;

if (! function_exists(__NAMESPACE__.'\serve')) {
    /**
     * Answers the current request with the stored report. Only reads the
     * store and filters by tier: no checks, no database access.
     *
     * Whatever fails while answering — a broken deploy-report.php, an
     * unreadable store — the response is a fixed, failed public-tier report
     * with status 503, and display_errors is off for the duration: no
     * message, path or trace of the failure can reach the response.
     */
    function serve(?string $appRoot = null): void
    {
        $displayErrors = ini_get('display_errors');
        ini_set('display_errors', '0');
        try {
            $standalone = StandaloneConfig::load($appRoot ?? appRoot());
            $config = $standalone->config;
            $commit = (new CommitResolver($standalone->appRoot))->resolve();

            $report = (new ReportReader(new FileStore($config->storePath), $config, $commit))->read();
            $filter = new TierFilter($config);
            $body = json_encode($filter->apply(
                $report->toArray(),
                $filter->decide(requestHeader('Authorization')),
                RunIdMatcher::match($config->runId, requestHeader(RunIdMatcher::HEADER)),
            ), JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
            $status = $report->httpStatus();
        } catch (\Throwable $error) {
            // The class only, never the message: "check the app's logs" stays true without leaking.
            error_log('deploy-report: the report could not be served ('.$error::class.').');
            $body = '{"status":"fail","deploy":{"spec_version":"0.1","tier":"public","settled":true,"checks":{}}}';
            $status = 503;
        } finally {
            ini_set('display_errors', $displayErrors === false ? '' : $displayErrors);
        }

        http_response_code($status);
        foreach (Report::headers() as $name => $value) {
            header($name.': '.$value);
        }
        echo $body;
    }

    /**
     * Runs the declared checks once and stores the results. Returns an exit code.
     */
    function run(?string $appRoot = null, ?callable $output = null): int
    {
        $standalone = StandaloneConfig::load($appRoot ?? appRoot());
        $commit = (new CommitResolver($standalone->appRoot))->resolve();

        $runner = new Runner(
            new FileStore($standalone->config->storePath),
            $standalone->config,
            $commit,
            (new StandaloneChecks($standalone, $commit))->all(),
            warn: static fn (string $message) => error_log(str_starts_with($message, 'deploy-report:') ? $message : 'deploy-report: '.$message),
        );

        foreach ($runner->run() as $name => $result) {
            if ($output !== null) {
                $output(sprintf('%-18s %s', $name, $result->status->value));
            }
        }

        return 0;
    }

    /** The app root: the directory that holds vendor/. */
    function appRoot(): string
    {
        $loader = (new \ReflectionClass(\Composer\Autoload\ClassLoader::class))->getFileName();

        return dirname((string) $loader, 3);
    }

    /** A request header from the SAPI, without a framework. */
    function requestHeader(string $name): ?string
    {
        $key = 'HTTP_'.strtoupper(str_replace('-', '_', $name));
        $value = $_SERVER[$key] ?? null;
        if ($value === null && $name === 'Authorization') {
            $value = $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? null;
        }

        return is_string($value) ? $value : null;
    }
}
