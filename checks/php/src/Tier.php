<?php

declare(strict_types=1);

namespace DeployDoubles\Checks;

enum Tier: string
{
    case Public = 'public';
    case Full = 'full';
}
