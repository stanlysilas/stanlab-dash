# Stanlab Dash

Stanlab is a self-hosted homelab homepage distributed as a standalone Docker image. It does not require Redis, another application container, or an external Docker network. Docker Compose creates an isolated project network automatically. Login sessions live in memory and expire after 15 minutes; restarting the container signs out active sessions.

## Pull the image

The published image is:

```text
ghcr.io/stanlysilas/stanlab-dash:latest
```

Pull it directly:

```bash
docker pull ghcr.io/stanlysilas/stanlab-dash:latest
```

GitHub Actions builds and publishes the image from this repository. For anonymous `docker pull`, the GHCR package must be public. Release tags are also published as image tags.

## Create the Compose project manually

Make a directory for your own Compose configuration, then create `docker-compose.yml` and `.env` there. The example below has no connection to other containers. Change the bind address, port, origin, and hostname to your own choices.

```yaml
services:
  stanlab:
    image: ghcr.io/stanlysilas/stanlab-dash:latest
    container_name: stanlab-dash
    restart: unless-stopped
    init: true
    environment:
      DASH_ORIGIN: ${DASH_ORIGIN:?Set DASH_ORIGIN in .env}
      DASH_COOKIE_SECURE: ${DASH_COOKIE_SECURE:?Set DASH_COOKIE_SECURE in .env}
      DASH_HOSTNAME: ${DASH_HOSTNAME:?Set DASH_HOSTNAME in .env}
      XDG_DATA_HOME: /app/data
    ports:
      - "${STANLAB_BIND_ADDRESS:?Set STANLAB_BIND_ADDRESS in .env}:${STANLAB_PORT:?Set STANLAB_PORT in .env}:3000"
    volumes:
      - stanlab-data:/app/data
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 3s
      start_period: 10s
      retries: 3

volumes:
  stanlab-data:
    name: stanlab-data
```

Create `.env` beside the Compose file. These are Compose settings only; they do not contain the login password:

```dotenv
STANLAB_BIND_ADDRESS=127.0.0.1
STANLAB_PORT=35437
DASH_ORIGIN=https://stanlab.dpdns.org
DASH_COOKIE_SECURE=true
DASH_HOSTNAME=Legion
```

Pick any unused host port. Use `DASH_COOKIE_SECURE=false` only when opening Stanlab over plain HTTP. `DASH_ORIGIN` must exactly match the address users open in their browser.

## Set the dashboard login

Create the data volume, then run the image’s interactive setup command. It prompts for one username and password, stores a scrypt password hash with owner-only permissions, and never writes the plaintext password to disk:

```bash
docker volume create stanlab-data
docker run --rm -it \
  -v stanlab-data:/app/data \
  ghcr.io/stanlysilas/stanlab-dash:latest setup
```

Start the service from your Compose directory:

```bash
docker compose config --quiet
docker compose up -d
docker compose ps
docker compose logs -f
```

The named volume keeps login credentials, custom app links, and Store records across container replacement. `docker compose down` keeps the volume; `docker compose down --volumes` removes it.

## Cloudflare Tunnel and DNS

Configure your tunnel and DNS manually. With `STANLAB_BIND_ADDRESS=127.0.0.1`, a host-installed `cloudflared` can route the hostname to `http://127.0.0.1:<STANLAB_PORT>`. If you run `cloudflared` in Docker, connect it to the Stanlab Compose network yourself and route it to `http://stanlab:3000`. Stanlab does not change DNS, tunnels, firewall rules, router settings, or Docker networks outside its own Compose project.

## Upgrade and remove

To upgrade to the latest image:

```bash
docker pull ghcr.io/stanlysilas/stanlab-dash:latest
docker compose up -d
```

To remove the container while preserving the data volume:

```bash
docker compose down
```

## What runs inside the image

The image runs as the unprivileged `node` user and includes Bash for approved scripts. The starter `Hello World` script runs inside the container. Scripts are allowlisted in `config/scripts.json`, run without root privileges, and have a 30-second timeout. CPU and memory values are container-visible; disk usage is measured from the persistent data volume.

GPU telemetry is optional. On an NVIDIA host with the NVIDIA Container Toolkit configured, add `gpus: all` at the service level and merge the NVIDIA variables into the existing `environment` mapping:

```yaml
    gpus: all
```

```yaml
      NVIDIA_VISIBLE_DEVICES: all
      NVIDIA_DRIVER_CAPABILITIES: utility
```

### Enable App Store installs (optional)

By default Stanlab stays isolated from the host Docker daemon. To enable the curated Store's Install/Start/Stop/Update/Remove actions, opt in by merging `docker-compose.app-store.yml` when starting Stanlab. This gives Stanlab access to the Docker Engine API. Docker warns that daemon access can permit host filesystem changes, so enable this only for a trusted, up-to-date Stanlab instance. The Store accepts only built-in catalog IDs and fixed Compose definitions; it does not accept arbitrary Compose files or shell commands. On SELinux-enforcing hosts, this overlay disables SELinux label confinement for the Stanlab container so it can connect to the Docker socket; this applies only when you opt in with this overlay.

First, find the numeric group ID of the host Docker socket and add it to the `.env` file in your Compose directory:

```bash
stat -c '%g' /var/run/docker.sock
```

Set `DOCKER_GID` in `.env` to that number. The overlay defaults to `/var/run/docker.sock`; set `DOCKER_SOCKET_PATH` if your Docker socket is elsewhere. Then start Stanlab with both Compose files:

```bash
docker compose -f docker-compose.yml -f docker-compose.app-store.yml config --quiet
docker compose -f docker-compose.yml -f docker-compose.app-store.yml up -d
```

Keep using both `-f` options for later `up`, `pull`, and other Compose operations. Without this overlay, Store entries remain a catalog and can be deployed manually with your own Compose files; add their URLs under **My Apps**.

The wallpaper stays in the browser's IndexedDB. The login cookie is HTTP-only, SameSite=Strict, and expires no later than 15 minutes after sign-in.

## Build and development

The repository contains the Dockerfile and GitHub Actions workflow that builds and publishes the image. For local UI development, install Node.js 20.19+, 22.12+, or 24+, then run:

```bash
npm ci
npm run dev
```

Development sessions are also in-memory. For a local login, run the setup script with `STANLAB_DATA_DIR` set to a writable directory.
