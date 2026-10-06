<?php

declare(strict_types=1);

namespace DeployDoubles\Checks\Symfony;

use DeployDoubles\Checks\CommitResolver;
use DeployDoubles\Checks\Config;
use DeployDoubles\Checks\FileStore;
use DeployDoubles\Checks\ReportReader;
use DeployDoubles\Checks\TierFilter;
use Symfony\Component\Config\Definition\Configurator\DefinitionConfigurator;
use Symfony\Component\DependencyInjection\ContainerBuilder;
use Symfony\Component\DependencyInjection\Loader\Configurator\ContainerConfigurator;
use Symfony\Component\HttpKernel\Bundle\AbstractBundle;
use Symfony\Component\HttpKernel\KernelEvents;

use function Symfony\Component\DependencyInjection\Loader\Configurator\param;
use function Symfony\Component\DependencyInjection\Loader\Configurator\service;

/**
 * The Symfony adapter. Register it in config/bundles.php and configure it in
 * config/packages/deploy_report.yaml. It:
 *
 *  - answers GET /.well-known/deploy-report from the stored results (a
 *    kernel.request listener ahead of routing and security: no route import,
 *    no session, no checks);
 *  - adds the console command `deploy-report:run`, which the app runs every
 *    minute (cron, or its own scheduler) to run the checks and store results;
 *  - handles the Messenger probe message, so a worker consuming the probe
 *    transport answers the queue check with its own commit.
 *
 * It reuses the core store, tier filter, error mapper and report reader
 * unchanged; nothing here decides a tier or maps an error itself.
 */
final class DeployReportBundle extends AbstractBundle
{
    protected string $extensionAlias = 'deploy_report';

    public function configure(DefinitionConfigurator $definition): void
    {
        $definition->rootNode()
            ->children()
                // A literal in the committed config. An env placeholder here is
                // rejected at compile time (see SymfonyConfig::tier()).
            ->scalarNode('tier')->defaultValue('public')->end()
            ->scalarNode('token')->defaultNull()->end()
            ->scalarNode('run_id')->defaultNull()->end()
            ->scalarNode('name')->defaultNull()->end()
            ->scalarNode('double')->defaultNull()->end()
            ->variableNode('checks')->defaultNull()->end()
            ->scalarNode('store_path')->defaultValue('%kernel.project_dir%/var/deploy-report')->end()
            ->scalarNode('storage_marker_path')->defaultValue('%kernel.project_dir%/var/storage/deploy-report')->end()
            ->scalarNode('probe_transport')->defaultValue('async')->end()
            ->scalarNode('connection')->defaultValue('default')->end()
            ->end();
    }

    /** @param array<string, mixed> $config */
    public function loadExtension(array $config, ContainerConfigurator $container, ContainerBuilder $builder): void
    {
        $tier = SymfonyConfig::tier($config['tier'], $builder);

        $builder->setParameter('deploy_report.checks', $config['checks']);
        $builder->setParameter('deploy_report.probe_transport', (string) $config['probe_transport']);
        $builder->setParameter('deploy_report.connection', (string) $config['connection']);

        $services = $container->services();

        $services->set(Config::class)
            ->factory([SymfonyConfig::class, 'make'])
            ->args([
                [
                    'tier' => $tier,
                    'token' => $config['token'] ?? '%env(default::DEPLOY_REPORT_TOKEN)%',
                    'run_id' => $config['run_id'] ?? '%env(default::DEPLOY_RUN_ID)%',
                    'name' => $config['name'],
                    'double' => $config['double'],
                    'store_path' => $config['store_path'],
                ],
                param('deploy_report.checks'),
            ]);

        $services->set(FileStore::class)
            ->factory([SymfonyConfig::class, 'store'])
            ->args([service(Config::class)]);

        $services->set(CommitResolver::class)
            ->args([param('kernel.project_dir')]);

        $services->set(ReportReader::class)
            ->factory([SymfonyConfig::class, 'reader'])
            ->args([service(FileStore::class), service(Config::class), service(CommitResolver::class)]);

        $services->set(TierFilter::class)
            ->args([service(Config::class)]);

        $services->set(DeployReportListener::class)
            ->args([service(ReportReader::class), service(TierFilter::class), service(Config::class)])
            ->tag('kernel.event_listener', ['event' => KernelEvents::REQUEST, 'method' => 'onKernelRequest', 'priority' => DeployReportListener::PRIORITY]);

        $services->set(RunCommand::class)
            ->args([
                service(Config::class),
                service(FileStore::class),
                service(CommitResolver::class),
                param('deploy_report.probe_transport'),
                (string) $config['storage_marker_path'],
                service('deploy_report.connection')->nullOnInvalid(),
                service('doctrine.migrations.dependency_factory')->nullOnInvalid(),
                service('messenger.receiver_locator')->nullOnInvalid(),
                service('messenger.default_bus')->nullOnInvalid(),
                service('logger')->nullOnInvalid(),
            ])
            ->tag('console.command', ['command' => RunCommand::NAME]);

        $services->set(ProbeHandler::class)
            ->args([service(FileStore::class), param('kernel.project_dir')])
            ->tag('messenger.message_handler', ['handles' => ProbeMessage::class]);
    }

    public function build(ContainerBuilder $container): void
    {
        $container->addCompilerPass(new InferChecksPass);
    }
}
