<?php

declare(strict_types=1);

namespace DeployDoubles\Checks\Laravel;

use DeployDoubles\Checks\Config;
use DeployDoubles\Checks\Report;
use DeployDoubles\Checks\ReportReader;
use DeployDoubles\Checks\RunIdMatcher;
use DeployDoubles\Checks\TierFilter;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Serves the stored report. It only reads the store and filters by tier:
 * no checks, no jobs, no database or cache access.
 */
final class DeployReportController
{
    public function __invoke(Request $request, ReportReader $reader, TierFilter $filter, Config $config): JsonResponse
    {
        $report = $reader->read();
        $tier = $filter->decide($request->headers->get('Authorization'));
        $body = $filter->apply(
            $report->toArray(),
            $tier,
            RunIdMatcher::match($config->runId, $request->headers->get(RunIdMatcher::HEADER)),
        );

        return new JsonResponse($body, $report->httpStatus(), Report::headers(), JSON_UNESCAPED_SLASHES);
    }
}
