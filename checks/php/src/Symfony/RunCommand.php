<?php

declare(strict_types=1);

namespace DeployDoubles\Checks\Symfony;

use DeployDoubles\Checks\CommitResolver;
use DeployDoubles\Checks\Config;
use DeployDoubles\Checks\FileStore;
use DeployDoubles\Checks\Runner;
use Doctrine\DBAL\Connection;
use Doctrine\Migrations\DependencyFactory;
use Psr\Container\ContainerInterface;
use Psr\Log\LoggerInterface;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Output\OutputInterface;
use Symfony\Component\Messenger\MessageBusInterface;
use Symfony\Component\Messenger\Stamp\TransportNamesStamp;

/**
 * Runs the deploy report checks and stores their results. Run it every
 * minute: from cron (`* * * * * php bin/console deploy-report:run`) or from
 * the app's own scheduler.
 */
final class RunCommand extends Command
{
    public const NAME = 'deploy-report:run';

    public function __construct(
        private readonly Config $config,
        private readonly FileStore $store,
        private readonly CommitResolver $resolver,
        private readonly string $probeTransport,
        private readonly string $markerPath,
        private readonly ?Connection $connection = null,
        private readonly ?DependencyFactory $migrations = null,
        private readonly ?ContainerInterface $transports = null,
        private readonly ?MessageBusInterface $bus = null,
        private readonly ?LoggerInterface $log = null,
    ) {
        parent::__construct(self::NAME);
    }

    protected function configure(): void
    {
        $this->setDescription('Run the deploy report checks and store their results');
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $commit = $this->resolver->resolve();
        $checks = new SymfonyChecks(
            $this->config,
            $commit,
            $this->markerPath,
            $this->probeTransport,
            $this->connection,
            $this->migrations,
            $this->transports,
        );

        $bus = $this->bus;
        $transport = $this->probeTransport;
        $log = $this->log;

        $runner = new Runner(
            $this->store,
            $this->config,
            $commit,
            $checks->all(),
            $bus === null ? null : static function (string $probe) use ($bus, $transport): void {
                // Always through the probe transport, even if routing is missing:
                // a probe handled in-process would hide a missing worker.
                $bus->dispatch(new ProbeMessage($probe), [new TransportNamesStamp([$transport])]);
            },
            warn: $log === null ? null : static fn (string $message) => $log->warning($message),
        );

        foreach ($runner->run() as $name => $result) {
            $output->writeln(sprintf('%-18s %s', $name, $result->status->value));
        }

        return Command::SUCCESS;
    }
}
