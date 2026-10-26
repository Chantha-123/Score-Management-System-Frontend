# Docker development and deployment

The shared stack is maintained in the sibling API repository: [API Docker instructions](../../Score-Management-API/docker/README.md).

From `Score-Management-API` in PowerShell:

```powershell
./docker/stack.ps1 -Mode dev -Action up
# Open http://localhost:9090
```

The frontend Dockerfile has `development` (Grunt watch), `dev-proxy` (Nginx), and `production` (compiled assets + Nginx) targets. The default image target is `production`. `API_UPSTREAM` configures its reverse proxy; the shared stack sets `http://api:8080`. The browser uses its current origin to access `/fineract-provider/`.

The existing root `docker-compose.yml` still builds just the frontend. To proxy to an API outside the shared stack, provide `API_UPSTREAM` in that service's `environment`, for example `http://host.docker.internal:8080` when that API uses HTTP on Docker Desktop. The deployment stack expects HTTP internally; if you point this proxy at a self-signed HTTPS backend, configure CA trust in Nginx separately.
