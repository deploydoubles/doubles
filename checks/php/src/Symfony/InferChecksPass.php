<?php

declare(strict_types=1);

namespace DeployDoubles\Checks\Symfony;

use Symfony\Component\DependencyInjection\Compiler\CompilerPassInterface;
use Symfony\Component\DependencyInjection\ContainerBuilder;

/**
 * When the app declares no checks, infers them from what the container has:
 * a Doctrine connection means `database`, a probe transport means `queue`
 * and `queue.release`. A committed declaration is still better: inference
 * cannot see a silent fallback. Also aliases the configured DBAL connection.
 */
final class InferChecksPass implements CompilerPassInterface
{
    public function process(ContainerBuilder $container): void
    {
        if (! $container->hasParameter('deploy_report.checks')) {
            return;
        }

        $connectionId = 'doctrine.dbal.'.$container->getParameter('deploy_report.connection').'_connection';
        $hasDatabase = $container->has($connectionId);
        if ($hasDatabase) {
            $container->setAlias('deploy_report.connection', $connectionId);
        }

        if ($container->getParameter('deploy_report.checks') !== null) {
            return;
        }

        $checks = [];
        if ($hasDatabase) {
            $checks['database'] = [];
        }
        if ($container->has('messenger.transport.'.$container->getParameter('deploy_report.probe_transport'))) {
            $checks['queue'] = [];
            $checks['queue.release'] = [];
        }
        $checks['scheduler'] = [];
        $checks['scheduler.release'] = [];
        $checks['storage'] = [];
        $checks['env'] = ['required' => ['APP_SECRET']];

        $container->setParameter('deploy_report.checks', $checks);
    }
}
