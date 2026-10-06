<?php

declare(strict_types=1);

namespace DeployDoubles\Checks\Laravel;

use DeployDoubles\Checks\CommitResolver;
use DeployDoubles\Checks\Config;
use DeployDoubles\Checks\FileStore;
use DeployDoubles\Checks\Runner;
use Illuminate\Console\Command;
use Illuminate\Contracts\Foundation\Application;
use Psr\Log\LoggerInterface;

/**
 * Runs the deploy report checks and stores the results. Scheduled every
 * minute by the service provider.
 */
final class RunCommand extends Command
{
    public const NAME = 'deploy-report:run';

    protected $signature = 'deploy-report:run';

    protected $description = 'Run the deploy report checks and store their results';

    public function handle(Application $app, Config $config, FileStore $store, CommitResolver $resolver, LoggerInterface $log): int
    {
        $commit = $resolver->resolve();
        $checks = new LaravelChecks($app, $config, $commit);

        $runner = new Runner(
            $store,
            $config,
            $commit,
            $checks->all(),
            static function (string $probe) use ($app): void {
                $job = new ProbeJob($probe);
                $queue = $app['config']->get('deploy-report.probe_queue');
                if (is_string($queue) && $queue !== '') {
                    $job->onQueue($queue);
                }
                dispatch($job);
            },
            warn: static fn (string $message) => $log->warning($message),
        );

        $results = $runner->run();

        foreach ($results as $name => $result) {
            $this->line(sprintf('%-18s %s', $name, $result->status->value));
        }

        return self::SUCCESS;
    }
}
