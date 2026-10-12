<?php

namespace App;

use DeployDoubles\Checks\CommitResolver;

/**
 * Deliberate failures (spec/failure-modes.md): DOUBLE_FAIL=<mode>@<commit>
 * fires <mode> only on the release built from <commit>. Anything else — no
 * value, no "@", another commit, a commit that cannot be resolved — leaves
 * the double behaving normally.
 */
final class DoubleFailure
{
    public static function is(string $mode): bool
    {
        $value = config('double.fail');
        if (! is_string($value) || substr_count($value, '@') !== 1) {
            return false;
        }

        [$named, $commit] = explode('@', $value, 2);
        if ($named !== $mode || $commit === '') {
            return false;
        }

        $own = (new CommitResolver(base_path()))->resolve();

        return $own !== null && $commit === $own;
    }
}
