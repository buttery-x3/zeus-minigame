# Deployment

The VPS Caddy config currently sends `buttery.wtf` and `www.buttery.wtf` to port `4000`:

```caddyfile
buttery.wtf, www.buttery.wtf {
	encode gzip zstd
	reverse_proxy localhost:4000
}
```

The app serves the Vite production build from `dist/` with a small Node static server managed by PM2.

## First Setup

```bash
git clone https://github.com/eudaimyst/zeus-minigame.git
cd zeus-minigame
npm ci
npm run build
npm run pm2:start
pm2 save
```

## Update Deploy

```bash
cd zeus-minigame
git pull
npm ci
npm run build
npm run pm2:reload
pm2 save
```

## Runtime

- PM2 app name: `zeus-minigame`
- Port: `4000`
- Hosts: `127.0.0.1` and `::1`, matching Caddy's `localhost:4000` upstream.
- Static root: `dist/`

Useful checks:

```bash
pm2 status zeus-minigame
pm2 logs zeus-minigame
curl -I http://localhost:4000/
```
