# Stanlab Dash

A self-hosted homelab homepage built with React, TypeScript, Vite, Tailwind CSS, and Express. It has a single dashboard account, an HTTP-only cookie, and an absolute 15-minute session. Production sessions use Redis.

## Legion deployment with Docker Compose

Stanlab is deployed as a regular, user-managed Compose project. The project directory contains the source, `Dockerfile`, `compose.yaml`, and your local configuration. The CLI does not choose ports, discover networks, install host services, configure DNS, or configure Cloudflare Tunnel.

Clone the project into the Compose directory and create the nonsecret Compose settings file:

```bash
git clone <repository-url> /srv/compose/stanlab
cd /srv/compose/stanlab
cp .env.example .env
```

Edit `.env` and set a free port and the Docker network Stanlab should join. The defaults match the Legion's Nextcloud setup:

```dotenv
STANLAB_BIND_ADDRESS=127.0.0.1
STANLAB_PORT=35437
DASH_DOCKER_NETWORK=nextcloud_default
```

Create the single dashboard login. This runs a temporary Node container, asks for the password without echoing it, and writes only a scrypt hash to `config/stanlab.env` with mode `0600`:

```bash
./stanlab setup
```

Edit `config/stanlab.env` and verify `DASH_ORIGIN`, `DASH_HOSTNAME`, and `REDIS_URL`. For the Legion and Cloudflare hostname, the usual values are:

```dotenv
DASH_ORIGIN=https://stanlab.dpdns.org
DASH_HOSTNAME=Legion
SESSION_STORE=redis
REDIS_URL=redis://nextcloud-redis:6379/1
DASH_COOKIE_SECURE=true
```

The Redis container must be reachable on `DASH_DOCKER_NETWORK`. This setup uses database 1 and the `stanlab:session:` key prefix. Compose checks the configuration and starts the container:

```bash
docker compose config
docker compose up -d --build
docker compose ps
docker compose logs -f
```

The app publishes only to the address and port in `.env`. Choose a different `STANLAB_PORT` if it is occupied. The named `stanlab-data` volume keeps Store records and custom app links when the container is rebuilt or removed with `docker compose down`.

### Cloudflare Tunnel and DNS

Configure Cloudflare Tunnel and DNS yourself. If `cloudflared` runs on the Legion host, route `stanlab.dpdns.org` to `http://127.0.0.1:35437` (use your configured port). If `cloudflared` is a container on `nextcloud_default`, it can route to `http://stanlab-dash:3000`. Keep the `DASH_ORIGIN` value equal to the HTTPS origin users open in their browser. Stanlab does not modify DNS, tunnels, firewall rules, or router settings.

If another service uses the chosen port, change `STANLAB_PORT` in `.env` and run `docker compose up -d`. No fixed port is required by the app.

## Container features and host controls

The default Compose file does not mount the Docker socket or install a host-side helper. This keeps the deployment self-contained and prevents the dashboard from receiving unrestricted control over Docker. The Hello World script runs inside the Stanlab container. CPU, memory, and disk readings reflect what that container can see. GDM controls remain disabled by default. Store catalog browsing remains available, but installing or controlling host containers requires an explicitly configured host integration.

The dashboard’s script launcher only runs scripts listed in `config/scripts.json`. Script files are mounted read-only and run as the unprivileged container user, with a 30-second timeout and bounded output. Do not add commands that require host privileges to this list.

## Managing Stanlab

You can use Docker Compose directly:

```bash
docker compose ps
docker compose logs -f
docker compose restart
docker compose stop
docker compose start
docker compose down
```

`./stanlab` provides the same basic Compose operations. `./stanlab setup` resets the account; afterward run `docker compose up -d` to pass the new runtime configuration into the container. `./uninstall.sh` runs `docker compose down` and keeps `.env`, `config/stanlab.env`, and the `stanlab-data` volume. To remove the persistent volume too, use `docker compose down --volumes` after confirming you no longer need its data.

To update the app, pull the repository and rebuild it:

```bash
git pull
docker compose up -d --build
```

## Development workstation

For local development, install Node.js 20.19+, 22.12+, or 24+, then run:

```bash
npm ci
npm run dev
```

The development server uses in-memory sessions unless `SESSION_STORE=redis` is configured. Run `./stanlab setup` to create local login credentials, or set the same `DASH_USERNAME` and `DASH_PASSWORD_HASH` environment variables yourself.

## Wallpaper and app links

Use **Wallpaper** in the dashboard top bar to choose a local PNG, JPEG, WebP, or AVIF image. The image stays in the browser's IndexedDB and is not uploaded to the server. Custom app links are kept in the `stanlab-data` volume.

## Optional GDM and host-level operations

Host GDM controls, host metrics, and Store actions require a separate, explicitly configured host helper. The standard Compose deployment does not enable or install it. Do not mount `/var/run/docker.sock` into Stanlab as a shortcut: access to that socket effectively grants root control of the Docker host.

When users open Stanlab through HTTPS, the configured origin must include the exact scheme and hostname, for example `https://stanlab.dpdns.org`. The login cookie is HTTP-only, SameSite=Strict, and expires no later than 15 minutes after sign-in.
