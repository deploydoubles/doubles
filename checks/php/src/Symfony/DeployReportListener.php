<?php

declare(strict_types=1);

namespace DeployDoubles\Checks\Symfony;

use DeployDoubles\Checks\Config;
use DeployDoubles\Checks\Report;
use DeployDoubles\Checks\ReportReader;
use DeployDoubles\Checks\RunIdMatcher;
use DeployDoubles\Checks\TierFilter;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpKernel\Event\RequestEvent;

/**
 * Serves the stored report. It only reads the store and filters by tier:
 * no checks, no messages, no database access. It runs ahead of the router
 * and the firewall, so the app needs no route import and no access rule.
 */
final class DeployReportListener
{
    /** Above the router (32) and the firewall (8). */
    public const PRIORITY = 64;

    public function __construct(
        private readonly ReportReader $reader,
        private readonly TierFilter $filter,
        private readonly Config $config,
    ) {}

    public function onKernelRequest(RequestEvent $event): void
    {
        if (! $event->isMainRequest()) {
            return;
        }
        $request = $event->getRequest();
        if ($request->getPathInfo() !== Report::PATH || ! in_array($request->getMethod(), ['GET', 'HEAD'], true)) {
            return;
        }

        $report = $this->reader->read();
        $tier = $this->filter->decide($request->headers->get('Authorization'));
        $body = $this->filter->apply(
            $report->toArray(),
            $tier,
            RunIdMatcher::match($this->config->runId, $request->headers->get(RunIdMatcher::HEADER)),
        );

        $response = new JsonResponse($body, $report->httpStatus(), Report::headers());
        $response->setEncodingOptions(JSON_UNESCAPED_SLASHES);
        $event->setResponse($response);
    }
}
