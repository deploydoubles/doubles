<?php

declare(strict_types=1);

namespace DeployDoubles\Checks;

/**
 * One check's result. Every field is validated on the way in, so a result
 * read back from the store can never carry free text into the report.
 */
final class CheckResult
{
    private const ENGINE_PATTERN = '/^[a-z0-9-]+( [0-9]+\.[0-9]+)?$/';

    public function __construct(
        public readonly Status $status,
        public readonly ?string $expected = null,
        public readonly ?string $observed = null,
        public readonly ?string $code = null,
        public readonly ?string $detail = null,
        public readonly ?int $retryAfter = null,
        public readonly ?int $checkedAt = null,
    ) {
    }

    public static function pass(?string $detail = null, ?string $expected = null, ?string $observed = null, ?int $checkedAt = null): self
    {
        return new self(Status::Pass, $expected, $observed, null, $detail, null, $checkedAt);
    }

    public static function fail(string $code, ?string $detail = null, ?string $expected = null, ?string $observed = null, ?int $checkedAt = null): self
    {
        return new self(Status::Fail, $expected, $observed, Codes::isValid($code) ? $code : Codes::CHECK_ERROR, $detail, null, $checkedAt);
    }

    public static function pending(int $retryAfter, ?string $detail = null, ?int $checkedAt = null): self
    {
        return new self(Status::Pending, null, null, null, $detail, max(1, min(600, $retryAfter)), $checkedAt);
    }

    public function withCheckedAt(int $checkedAt): self
    {
        return new self($this->status, $this->expected, $this->observed, $this->code, $this->detail, $this->retryAfter, $checkedAt);
    }

    public function withExpectation(?string $expected, ?string $observed): self
    {
        return new self($this->status, $expected ?? $this->expected, $observed ?? $this->observed, $this->code, $this->detail, $this->retryAfter, $this->checkedAt);
    }

    /**
     * The full-tier representation.
     *
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        $out = ['status' => $this->status->value];

        if ($this->expected !== null && preg_match(self::ENGINE_PATTERN, $this->expected)) {
            $out['expected'] = $this->expected;
        }
        if ($this->observed !== null && preg_match(self::ENGINE_PATTERN, $this->observed)) {
            $out['observed'] = $this->observed;
        }
        if ($this->code !== null && Codes::isValid($this->code)) {
            $out['code'] = $this->code;
        }
        if ($this->detail !== null && $this->detail !== '') {
            $out['detail'] = mb_substr($this->detail, 0, 200);
        }
        if ($this->code !== null && Codes::isValid($this->code)) {
            $out['hint'] = Codes::hint($this->code);
        }
        if ($this->status === Status::Pending && $this->retryAfter !== null) {
            $out['retry_after'] = $this->retryAfter;
        }
        if ($this->checkedAt !== null) {
            $out['checked_at'] = gmdate('Y-m-d\TH:i:s\Z', $this->checkedAt);
        }

        return $out;
    }

    /** @return array<string, mixed> */
    public function toStore(): array
    {
        return [
            'status' => $this->status->value,
            'expected' => $this->expected,
            'observed' => $this->observed,
            'code' => $this->code,
            'detail' => $this->detail,
            'retry_after' => $this->retryAfter,
            'checked_at' => $this->checkedAt,
        ];
    }

    /** @param array<string, mixed> $data */
    public static function fromStore(array $data): self
    {
        $status = Status::tryFrom((string) ($data['status'] ?? '')) ?? Status::Fail;
        $code = isset($data['code']) && is_string($data['code']) && Codes::isValid($data['code']) ? $data['code'] : null;
        if ($status === Status::Fail && $code === null) {
            $code = Codes::CHECK_ERROR;
        }

        return new self(
            $status,
            is_string($data['expected'] ?? null) ? $data['expected'] : null,
            is_string($data['observed'] ?? null) ? $data['observed'] : null,
            $code,
            is_string($data['detail'] ?? null) ? $data['detail'] : null,
            is_int($data['retry_after'] ?? null) ? $data['retry_after'] : null,
            is_int($data['checked_at'] ?? null) ? $data['checked_at'] : null,
        );
    }
}
