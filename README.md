# Stanlab Dash

A self-hosted Linux dashboard built with React, TypeScript, Vite, Tailwind CSS, and Express. Authentication is single-user with an HTTP-only cookie and an in-memory session that expires 15 minutes after sign-in. No database is used.

## Requirements

- Node.js 20.19+ or 22.12+ (Node 24 is supported)
- npm, used internally by the installer to fetch locked JavaScript dependencies
- Linux with systemd (the installer creates a per-user service; metrics and optional GDM/script actions are Linux-specific)

## Install after cloning

```bash
git clone <repository-url> stanlab-dash
cd stanlab-dash
./stanlab install
```

The installer fetches locked dependencies, builds the production app, prompts for the single dashboard account, writes `.env` with owner-only permissions (`0600`), installs a `systemd --user` service, and starts it. Password entry is hidden; it is not a command-line argument or shell-history entry. Only a scrypt hash is saved. `.env` is ignored by git.

The CLI uses npm internally because this source project is built with React and TypeScript; routine installation and service management use `./stanlab` commands.

The installer starts with port 3000 when it is free, then checks subsequent ports until it finds an available one. It saves the chosen port in `.env`; the service listens on `127.0.0.1` by default. The installer prints the selected local address when it finishes. The app runs under your Linux user, not as root.

Useful commands:

```bash
./stanlab status
./stanlab logs --follow
./stanlab restart
./stanlab setup
./stanlab origin http://acer-alg.local:PORT
./stanlab stop
```

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

The Store runs on the Linux host where Stanlab is installed. It uses a curated set of built-in Compose definitions and requires Docker Compose v2 or Podman with a Compose provider on that host. Stanlab does not accept arbitrary Compose files or shell commands from the browser. The current starter catalog includes Jellyfin, Uptime Kuma, and Home Assistant; each service is pulled and started only after an authenticated user selects **Install**.

Installed-app records, generated Compose files, and custom My Apps links are stored under `$XDG_DATA_HOME/stanlab-dash/store` or `~/.local/share/stanlab-dash/store`, with owner-only permissions. App data is kept in named container volumes. Removing an app stops and removes its containers but preserves those volumes so reinstalling the app can reuse its data.

Stanlab asks the operating system for an available host port for each installed app, then records and maps that port to the app's internal web port. No app requires a preselected host port. Home Assistant uses a mapped web port rather than host networking; some local device discovery integrations may need additional network configuration. Services run on the Stanlab host; the browser displays their status and opens their generated address. The Store does not install anything on a workstation unless Stanlab itself is running there. App links use the server's host name and allocated port, so they are intended for LAN access; publishing each app through HTTPS requires a separate reverse-proxy route.

Podman’s `podman compose` command requires an installed Compose provider. On a production host, verify that Docker Compose v2 or a Podman Compose provider is available before using the Store.

## Wallpaper

Use **Wallpaper** in the dashboard top bar to choose a local PNG, JPEG, WebP, or AVIF image. The image is kept in this browser's IndexedDB and is never uploaded to the server. Choose another image to replace it or clear it from the top bar. Wallpaper settings are local to each browser. Custom app links and installed-app records are stored on the Stanlab host.

## Enable GDM controls (optional)

The start/stop endpoints only run these fixed commands: `systemctl start gdm.service` and `systemctl stop gdm.service`. They are disabled unless `DASH_GDM_ENABLED=true` is set. To permit them without granting general sudo access, install a sudoers drop-in for the dedicated dashboard service account (replace `stanly` if you run the backend as another account):

```sudoers
stanly ALL=(root) NOPASSWD: /usr/bin/systemctl start gdm.service, /usr/bin/systemctl stop gdm.service
```

Validate the drop-in with `visudo -cf /etc/sudoers.d/stanlab-dash`, then set `DASH_GDM_ENABLED=true` in `.env` and restart the backend. Keep the backend running as an unprivileged user. Stopping GDM ends the graphical session; use the dashboard from a service that remains available on the TTY (for example a user service or system service).

## Production

### Legion and `stanlab.dpdns.org`

On the Legion, install Stanlab from the cloned project and set its public browser origin during installation:

```bash
./stanlab install --origin https://stanlab.dpdns.org
```

The installer selects a free local port (starting its search at 3000), saves it in `.env`, and binds the service to `127.0.0.1`. It prints the local upstream address for your reverse proxy. If Stanlab is already installed, `./stanlab origin https://stanlab.dpdns.org` updates the public origin and restarts it.

Configure your DNS updater so `stanlab.dpdns.org` resolves to the Legion network's public IP, then forward TCP ports 80 and 443 from the router to the Legion. A reverse proxy such as Caddy can manage HTTPS certificates and forward the dashboard domain to Stanlab. Use the actual `PORT` from `.env` in this Caddyfile:

```caddyfile
stanlab.dpdns.org {
    reverse_proxy 127.0.0.1:PORT
}
```

Keep the dashboard's selected local port private; only the proxy needs to reach it. Confirm the DNS record and router forwarding before expecting the public domain to work. This repository does not change DNS, router settings, or install a reverse proxy.

The CLI sets the secure cookie flag for HTTPS. The cookie is HTTP-only, SameSite=Strict, and has a 15 minute maximum age. POST requests are accepted only from the configured origin. Sessions are held in memory and are cleared on service restart.
