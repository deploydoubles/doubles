<?php

namespace App\Controller;

use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;

final class HealthController
{
    /** The process is up. Says nothing about the deploy: that is /.well-known/deploy-report. */
    #[Route('/up', name: 'up', methods: ['GET', 'HEAD'])]
    public function up(): Response
    {
        return new Response('ok', 200, ['Content-Type' => 'text/plain']);
    }

    #[Route('/', name: 'home', methods: ['GET', 'HEAD'])]
    public function home(): Response
    {
        return new Response(
            "symfony-postgres-worker — a deploy double. Its deploy report is at /.well-known/deploy-report.\n",
            200,
            ['Content-Type' => 'text/plain; charset=UTF-8'],
        );
    }
}
