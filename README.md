# Stanlab Dash

A self-hosted Linux dashboard built with React, TypeScript, Vite, Tailwind CSS, and Express. Authentication is single-user with an HTTP-only cookie and an absolute 15-minute session. Production sessions use Redis; local development can use memory.

## Requirements

- Node.js 20.19+ or 22.12+ (Node 24 is supported)
- npm, used internally by the installer to fetch locked JavaScript dependencies
- Linux with systemd user services for the restricted host helper
- Docker Engine and Docker Compose on the production host
- A running Redis service on a Docker network shared with Stanlab in production

## Install after cloning

```bash
git clone <repository-url> stanlab-dash
cd stanlab-dash
./stanlab install --origin https://stanlab.dpdns.org
```

The installer fetches locked dependencies, builds the app, prompts for the single dashboard account, and stores only a scrypt password hash in `.env` with owner-only permissions (`0600`). On a host with Docker Compose and one running Redis container, it builds the Stanlab container, joins the Redis Docker network, starts a restricted host helper as a `systemd --user` service, and waits for the app health check. The installer keeps the project checkout in place and generates `/srv/compose/stanlab/docker-compose.yml` plus an owner-only Compose variable file beside it. Its helper socket bind mount uses SELinux relabeling, which is required on enforcing hosts. A separate owner-only Compose variable file keeps the password hash out of Compose interpolation. On the Acer development workstation, without Docker Compose, it uses the native user service and in-memory sessions. `.env` is ignored by git.

The CLI uses npm internally because this source project is built with React and TypeScript; routine installation and service management use `./stanlab` commands.

If installation stops after printing that credentials were saved, the credentials remain in `.env`; press Ctrl+C, update the checkout, then rerun `./stanlab install`. The installer reuses the saved credentials. The hidden-password prompt now pauses terminal input after saving, and later setup stages report progress and have time limits.

For a new install, Stanlab asks the operating system to assign an available port and saves it in `.env`. A previous saved port is reused when available. It does not assume port 3000; on the Legion that port is already used by Open WebUI. The reverse proxy connects to the selected loopback port, which the installer prints when it finishes.

Useful commands:

```bash
./stanlab status
./stanlab logs --follow
./stanlab restart
./stanlab setup
./stanlab origin https://stanlab.dpdns.org
./stanlab stop
./uninstall.sh
```

`./uninstall.sh` removes the Stanlab app container and host helper on Docker hosts, or the native user service on the development workstation. It keeps the project checkout, `.env` credentials, Store app containers and their volumes, and shared Redis. It does not remove unrelated containers or Redis.

`./stanlab setup` changes the account and restarts the service if it is running. `./stanlab origin` sets the exact browser origin permitted to make authenticated changes; it enables the secure cookie automatically for an HTTPS origin. For always-on operation after logging out or stopping GDM, an administrator can enable systemd user lingering with `sudo loginctl enable-linger <linux-user>`.

## System metrics

CPU and memory are read from Node's OS APIs. Disk usage uses `/usr/bin/df` for `/`. NVIDIA GPU usage is read through `/usr/bin/nvidia-smi`; if the NVIDIA utility or a supported GPU is unavailable, the dashboard displays `Unavailable`.

## Configure scripts

The starter includes an allowlisted `Hello World` script so you can verify the launcher immediately. To add another, place a reviewed shell script in `scripts/` and add an entry to `config/scripts.json`:

```json
{
  "scripts": [
    { "id": "gaming-mode", "label": "gaming_mode.sh", "file": "gaming_mode.sh" }
  ]
}
```

Only entries in this manifest can run. The file name must be a simple `.sh` basename, the resolved file must stay inside `scripts/`, execution uses `/bin/bash` without a shell command string, runs as the dashboard service user, has a 30 second timeout, and returns at most 12 KB of output. Scripts do not run as root. Keep this directory and its configuration writable only by the trusted host administrator.

No `gaming_mode.sh` was present on this machine. The Hello World example runs without elevated privileges and prints a short success message.

## App Store and My Apps

The Store runs on the Linux host where Stanlab is installed. It uses a curated set of built-in Compose definitions and requires Docker Compose v2 or Podman with a Compose provider on that host. In Docker deployment mode, Store actions pass through the restricted host helper; the web container does not mount the Docker socket. Stanlab does not accept arbitrary Compose files or shell commands from the browser. The current starter catalog includes Jellyfin, Uptime Kuma, and Home Assistant; each service is pulled and started only after an authenticated user selects **Install**.

Installed-app records, generated Compose files, and custom My Apps links are stored under `$XDG_DATA_HOME/stanlab-dash/store` or `~/.local/share/stanlab-dash/store`, with owner-only permissions. App data is kept in named container volumes. Removing an app stops and removes its containers but preserves those volumes so reinstalling the app can reuse its data.

Stanlab asks the operating system for an available host port for each installed app, then records and maps that port to the app's internal web port. No app requires a preselected host port. Home Assistant uses a mapped web port rather than host networking; some local device discovery integrations may need additional network configuration. Services run on the Stanlab host; the browser displays their status and opens their generated address. The Store does not install anything on a workstation unless Stanlab itself is running there. App links use the server's host name and allocated port, so they are intended for LAN access; publishing each app through HTTPS requires a separate reverse-proxy route.

Podman’s `podman compose` command requires an installed Compose provider. On a production host, verify that Docker Compose v2 or a Podman Compose provider is available before using the Store.

## Wallpaper

Use **Wallpaper** in the dashboard top bar to choose a local PNG, JPEG, WebP, or AVIF image. The image is kept in this browser's IndexedDB and is never uploaded to the server. Choose another image to replace it or clear it from the top bar. Wallpaper settings are local to each browser. Custom app links and installed-app records are stored on the Stanlab host.

## Enable GDM controls (optional)

The start/stop endpoints only run these fixed commands: `systemctl start gdm.service` and `systemctl stop gdm.service`. They are disabled unless `DASH_GDM_ENABLED=true` is set. On a Docker host, the restricted helper runs them as the dashboard Linux user. To permit them without granting general sudo access, install a sudoers drop-in for that Linux user (replace `admin` if needed):

```sudoers
admin ALL=(root) NOPASSWD: /usr/bin/systemctl start gdm.service, /usr/bin/systemctl stop gdm.service
```

Validate the drop-in with `visudo -cf /etc/sudoers.d/stanlab-dash`, then set `DASH_GDM_ENABLED=true` in `.env` and run `./stanlab restart`. Keep the helper running as an unprivileged user. Stopping GDM ends the graphical session; use the dashboard from a service that remains available on the TTY.

## Production

### Legion and `stanlab.dpdns.org`

On the Legion, install Stanlab from the cloned project and set its public browser origin during installation:

```bash
./stanlab install --origin https://stanlab.dpdns.org
```

The installer assigns a free host port, saves it in `.env`, and publishes the container only on `127.0.0.1`. It generates the Compose project at `/srv/compose/stanlab/docker-compose.yml`, matching the host's existing `/srv/compose/ai` and `/srv/compose/nextcloud` layout; the image is built from the cloned checkout. On the Legion it detects `nextcloud-redis` on `nextcloud_default` and defaults to Redis database 1 with a `stanlab:session:` key prefix. It waits for the container health check. If several Redis containers are running, set `REDIS_URL` and `DASH_DOCKER_NETWORK` in `.env` to select one explicitly. If Stanlab is already installed, `./stanlab origin https://stanlab.dpdns.org` recreates the container with the new origin.

Configure your DNS updater so `stanlab.dpdns.org` resolves to the Legion network's public IP, then forward TCP ports 80 and 443 from the router to the Legion. A reverse proxy such as Caddy can manage HTTPS certificates and forward the dashboard domain to Stanlab. Use the actual `PORT` from `.env` in this Caddyfile:

```caddyfile
stanlab.dpdns.org {
    reverse_proxy 127.0.0.1:PORT
}
```

Keep the dashboard's selected local port private; only the proxy needs to reach it. Confirm the DNS record and router forwarding before expecting the public domain to work. This repository does not change DNS, router settings, or install a reverse proxy.

The CLI sets the secure cookie flag for HTTPS. The cookie is HTTP-only, SameSite=Strict, and expires no later than 15 minutes after sign-in. POST requests are accepted only from the configured origin. Redis stores sessions across container restarts. The Docker app joins the selected Redis network; the host helper uses an owner-only Unix socket and exposes only the configured metrics, script, display-manager and Store operations.
