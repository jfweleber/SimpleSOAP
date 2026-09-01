# Deploying SimpleSOAP to soap.weleber.net

## 1. DNS

Add records pointing the subdomain at the Linode. In the Linode DNS manager
(or wherever weleber.net is hosted):

| Type | Host   | Value                  |
|------|--------|------------------------|
| A    | `soap` | your Linode IPv4       |
| AAAA | `soap` | your Linode IPv6 (opt) |

Confirm before going further, since certbot will fail without it:

```sh
dig +short soap.weleber.net
```

## 2. Server directory

```sh
sudo mkdir -p /var/www/soap
sudo chown -R "$USER":www-data /var/www/soap
sudo chmod 755 /var/www/soap
```

## 3. nginx

```sh
sudo cp deploy/nginx-soap.weleber.net.conf /etc/nginx/sites-available/soap.weleber.net
sudo ln -s /etc/nginx/sites-available/soap.weleber.net /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

## 4. TLS — not optional

```sh
sudo certbot --nginx -d soap.weleber.net
```

Certbot rewrites the site config to add the certificate and an http→https
redirect, and installs a renewal timer.

**Without HTTPS the app loses Bluetooth and offline support entirely.** Both
Web Bluetooth and service workers refuse to run outside a secure context.
There is no way around this and no reason to try.

## 5. Deploy

The target is not committed — this repo is public, and an ssh user on a named
host is half a credential pair. Set yours once:

```sh
cp deploy/target.env.example deploy/target.env
$EDITOR deploy/target.env        # SOAP_HOST=you@example.com
```

Then, from this repo on your machine:

```sh
./deploy/deploy.sh
# or override for a one-off:
SOAP_HOST=you@1.2.3.4 ./deploy/deploy.sh
```

Needs key-based ssh to the server; the upload is tar over ssh, not rsync.

## 6. Check it

- `https://soap.weleber.net` loads, padlock shown
- Chrome DevTools → Application → Service Workers: one activated worker
- Application → Manifest: name, icons, no errors
- Turn off wifi and reload — it still loads
- On Android Chrome: menu → **Add to Home screen**, launches without browser chrome
- On the Monitors screen: **Choose a monitor** opens the browser's device picker

## Updating

Run `./deploy/deploy.sh` again. Installed copies pick up the new version on
next launch — the service worker is set to update automatically, and nginx is
configured never to cache `sw.js` or `index.html`, which is what makes that
work.

## If an installed copy seems stuck on an old version

Almost always a caching header. Confirm with:

```sh
curl -sI https://soap.weleber.net/sw.js | grep -i cache-control
```

It must say `no-cache`. If it does not, the site config was not picked up —
certbot occasionally reorders `location` blocks when it edits the file.
