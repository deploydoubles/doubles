<?php

declare(strict_types=1);

namespace DeployDoubles\Checks;

/**
 * Decides which tier a request gets, and strips a full report down to it.
 *
 * Full tier when the request carries a valid bearer token (at least 32
 * characters, compared in constant time, Authorization header only), or when
 * the app's committed configuration sets `tier: full`. Anything else gets the
 * public tier — never an error.
 */
final class TierFilter
{
    public const MIN_TOKEN_LENGTH = 32;

    public function __construct(private readonly Config $config)
    {
    }

    public function decide(?string $authorizationHeader): Tier
    {
        if ($this->config->servesFullTierWithoutToken()) {
            return Tier::Full;
        }

        $configured = $this->config->token;
        if ($configured === null || strlen($configured) < self::MIN_TOKEN_LENGTH) {
            return Tier::Public;
        }

        $presented = self::bearer($authorizationHeader);
        if ($presented === null) {
            return Tier::Public;
        }

        return hash_equals($configured, $presented) ? Tier::Full : Tier::Public;
    }

    /**
     * A warning to log when the configured token is unusable, or null.
     * The token itself is never part of the message.
     */
    public function configurationWarning(): ?string
    {
        $token = $this->config->token;
        if ($token !== null && $token !== '' && strlen($token) < self::MIN_TOKEN_LENGTH) {
            return 'DEPLOY_REPORT_TOKEN is shorter than '.self::MIN_TOKEN_LENGTH.' characters and is ignored; the deploy report serves the public tier only.';
        }

        return null;
    }

    /**
     * @param array<string, mixed> $fullReport the full report from ReportReader
     * @return array<string, mixed>
     */
    public function apply(array $fullReport, Tier $tier, ?bool $runIdMatch): array
    {
        $deploy = $fullReport['deploy'];

        if ($tier === Tier::Full) {
            $deploy['tier'] = Tier::Full->value;
            $deploy['release']['run_id_match'] = $runIdMatch;

            return ['status' => $fullReport['status'], 'deploy' => $deploy];
        }

        $checks = [];
        foreach ($deploy['checks'] as $name => $check) {
            $checks[$name] = ['status' => $check['status']];
        }

        return [
            'status' => $fullReport['status'],
            'deploy' => [
                'spec_version' => $deploy['spec_version'],
                'tier' => Tier::Public->value,
                'settled' => $deploy['settled'],
                'checks' => $checks === [] ? new \stdClass() : $checks,
            ],
        ];
    }

    private static function bearer(?string $header): ?string
    {
        if ($header === null || ! preg_match('/^\s*Bearer\s+(\S+)\s*$/i', $header, $m)) {
            return null;
        }

        return $m[1];
    }
}
