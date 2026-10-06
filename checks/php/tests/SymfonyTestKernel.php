<?php

declare(strict_types=1);

namespace DeployDoubles\Checks\Tests;

use DeployDoubles\Checks\Symfony\DeployReportBundle;
use Doctrine\DBAL\Connection;
use Doctrine\DBAL\DriverManager;
use Symfony\Bundle\FrameworkBundle\FrameworkBundle;
use Symfony\Bundle\FrameworkBundle\Kernel\MicroKernelTrait;
use Symfony\Component\DependencyInjection\Loader\Configurator\ContainerConfigurator;
use Symfony\Component\HttpKernel\Kernel;

/**
 * A minimal Symfony app for the bundle tests: FrameworkBundle, Messenger with
 * one configurable transport, an optional DBAL connection, and the bundle.
 */
final class SymfonyTestKernel extends Kernel
{
    use MicroKernelTrait;

    /**
     * @param array<string, mixed> $deployReport the deploy_report configuration
     * @param array<string, mixed>|null $connection DBAL params, or null for no database
     */
    public function __construct(
        private readonly string $dir,
        private readonly array $deployReport,
        private readonly string $transportDsn = 'in-memory://',
        private readonly ?array $connection = null,
    ) {
        parent::__construct('test', false);
    }

    public function registerBundles(): iterable
    {
        yield new FrameworkBundle();
        yield new DeployReportBundle();
    }

    public function getProjectDir(): string
    {
        return $this->dir;
    }

    public function getCacheDir(): string
    {
        return $this->dir.'/var/cache/'.md5(serialize([$this->deployReport, $this->transportDsn, $this->connection]));
    }

    public function getLogDir(): string
    {
        return $this->dir.'/var/log';
    }

    protected function configureContainer(ContainerConfigurator $container): void
    {
        $container->extension('framework', [
            'secret' => 'test-secret',
            'test' => true,
            'http_method_override' => false,
            'messenger' => [
                'transports' => ['async' => $this->transportDsn],
            ],
        ]);
        $container->extension('deploy_report', $this->deployReport);

        if ($this->connection !== null) {
            $container->services()
                ->set('doctrine.dbal.default_connection', Connection::class)
                ->factory([DriverManager::class, 'getConnection'])
                ->args([$this->connection])
                ->public();
        }
    }
}
