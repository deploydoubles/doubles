<?php

declare(strict_types=1);

namespace DeployDoubles\Checks;

/**
 * A full-tier report as read from the store. Pass it through TierFilter
 * before it leaves the app.
 */
final class Report
{
    public const CONTENT_TYPE = 'application/health+json';
    public const PATH = '/.well-known/deploy-report';
    public const SPEC_VERSION = '0.1';

    /** @param array<string, mixed> $data */
    public function __construct(private readonly array $data)
    {
    }

    public function status(): string
    {
        return $this->data['status'];
    }

    public function httpStatus(): int
    {
        return $this->status() === Status::Fail->value ? 503 : 200;
    }

    /** @return array<string, mixed> */
    public function toArray(): array
    {
        return $this->data;
    }

    /** @return array<string, string> */
    public static function headers(): array
    {
        return [
            'Content-Type' => self::CONTENT_TYPE,
            'Cache-Control' => 'no-store',
        ];
    }

    /**
     * @param array<string, CheckResult> $checks
     */
    public static function overallStatus(array $checks): Status
    {
        $status = Status::Pass;
        foreach ($checks as $check) {
            if ($check->status === Status::Fail) {
                return Status::Fail;
            }
            if ($check->status === Status::Warn || $check->status === Status::Pending) {
                $status = Status::Warn;
            }
        }

        return $status;
    }
}
