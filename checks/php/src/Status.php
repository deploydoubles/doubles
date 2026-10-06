<?php

declare(strict_types=1);

namespace DeployDoubles\Checks;

enum Status: string
{
    case Pass = 'pass';
    case Warn = 'warn';
    case Fail = 'fail';
    case Pending = 'pending';
    case Skip = 'skip';
}
