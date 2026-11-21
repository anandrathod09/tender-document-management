# Going live

How to put Tender Manager on a server of your own, from an empty VPS to clients signing in at `https://<client>.yourdomain.com`. Plan for about two hours the first time. Everything here is run once, except [Updating](#updating) and [Backups](#10-backups).

Replace `yourdomain.com` with your real domain throughout.

## What you need

|                       | Suggestion                                                                                                             | Cost (approx.)       |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------- |
| A server (VPS)        | Ubuntu 24.04, 2 vCPU, 4 GB RAM, 80 GB disk. DigitalOcean (Bangalore), Hetzner, AWS Lightsail (Mumbai) or Hostinger VPS | ₹1,000–2,500 / month |
| A domain              | e.g. from GoDaddy, Namecheap or Cloudflare                                                                             | ₹800–1,500 / year    |
| DNS on Cloudflare     | Free plan. Needed for the wildcard certificate (step 8)                                                                | free                 |
| Off-site backup space | Cloudflare R2 or Backblaze B2 bucket                                                                                   | free up to 10 GB     |
| Email (SMTP)          | Your choice of provider, see the main README, "Emails"                                                                 | free to start        |

One server is enough for the first clients: the API, the database and the web app all run on it.

## 1. DNS

In Cloudflare, add your domain, then two **A records** pointing to the server's IP address:

| Type | Name | Content   | Proxy status          |
| ---- | ---- | --------- | --------------------- |
| A    | `@`  | server IP | DNS only (grey cloud) |
| A    | `*`  | server IP | DNS only (grey cloud) |

The `*` record makes every client address (`ostnasik.yourdomain.com`, `owner.yourdomain.com`, …) reach the server. Change your domain's nameservers to Cloudflare's if you bought it elsewhere.

## 2. Server basics

Log in as root once, create your own admin user, then use that from now on:

```bash
adduser deploy && usermod -aG sudo deploy
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy   # your SSH key
timedatectl set-timezone Asia/Kolkata
apt update && apt upgrade -y && apt install -y unattended-upgrades ufw
ufw allow OpenSSH && ufw allow 'Nginx Full' && ufw --force enable
```

In `/etc/ssh/sshd_config` set `PasswordAuthentication no` and `PermitRootLogin no`, then `systemctl restart ssh` (check you can still log in as `deploy` in a second window first).

## 3. Software

```bash
# Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs git nginx mysql-server certbot python3-certbot-dns-cloudflare rclone
node -v   # v22.x
```

## 4. Database

```bash
sudo mysql_secure_installation          # answer yes to everything
sudo mysql
```

```sql
CREATE DATABASE tender_manager CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'tdm'@'localhost' IDENTIFIED BY 'a-long-random-password';
GRANT ALL PRIVILEGES ON tender_manager.* TO 'tdm'@'localhost';
-- For the restore test (step 10):
GRANT ALL PRIVILEGES ON tender_manager_restore.* TO 'tdm'@'localhost';
FLUSH PRIVILEGES;
```

Make the password with `openssl rand -base64 24` and keep it in your password manager. MySQL only listens on the server itself by default, which is what we want.

## 5. App user and code

```bash
sudo useradd --system --create-home --shell /bin/bash tdm
sudo mkdir -p /opt/tender-manager /var/lib/tender-manager/storage /var/backups/tender-manager /var/log/tender-manager /etc/tender-manager
sudo chown tdm:tdm /opt/tender-manager /var/lib/tender-manager /var/lib/tender-manager/storage /var/backups/tender-manager /var/log/tender-manager
sudo chmod 750 /var/lib/tender-manager /var/backups/tender-manager
```

The repository is private, so give the server its own read-only key:

```bash
sudo -iu tdm
ssh-keygen -t ed25519 -C "tender-manager server" -f ~/.ssh/id_ed25519 -N ""
cat ~/.ssh/id_ed25519.pub
```

On GitHub: the repository → Settings → Deploy keys → Add deploy key, paste it, leave "Allow write access" off. Then:

```bash
git clone git@github.com:<your-account>/tender-document-management.git /opt/tender-manager
```

## 6. Settings

```bash
cd /opt/tender-manager/apps/api
cp .env.production.example .env
chmod 600 .env
nano .env
```

Fill in at least: `BASE_DOMAIN`, `PUBLIC_URL_TEMPLATE`, `DB_PASSWORD`, `JWT_ACCESS_SECRET` and `ENCRYPTION_KEY` (each `openssl rand -hex 32`, two different values), and `MAIL_FROM_ADDRESS`. Keep a copy of `ENCRYPTION_KEY` in your password manager: if it is lost, everyone has to set up two-step login again.

The API checks these when it starts and refuses to run with unsafe values (a localhost domain, `http://` links, insecure cookies, a missing or short key), naming each problem.

## 7. Build and first set-up

Still as `tdm`:

```bash
cd /opt/tender-manager
npm ci
npm run build
cd apps/api
node dist/db/migrate.js
node dist/db/seed.js --owner-email you@yourcompany.com --owner-name "Your Name"
```

The seed prints a one-time password for the owner panel. Sign in with it later and change it straight away (and turn on two-step login under My Security).

## 8. Wildcard HTTPS certificate

Every client has its own subdomain, so the certificate must cover `*.yourdomain.com`. Let's Encrypt gives those free, proving you own the domain through Cloudflare DNS.

1. Cloudflare → My Profile → API Tokens → Create Token → template "Edit zone DNS", zone = your domain.
2. On the server (back as your `deploy` user):

```bash
sudo tee /etc/letsencrypt/cloudflare.ini > /dev/null <<'EOF'
dns_cloudflare_api_token = PASTE_THE_TOKEN
EOF
sudo chmod 600 /etc/letsencrypt/cloudflare.ini
sudo certbot certonly --dns-cloudflare --dns-cloudflare-credentials /etc/letsencrypt/cloudflare.ini \
  -d yourdomain.com -d '*.yourdomain.com' --agree-tos -m you@yourcompany.com
```

Renewal is automatic. Reload nginx after each renewal:

```bash
echo -e '#!/bin/sh\nsystemctl reload nginx' | sudo tee /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
sudo chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
sudo certbot renew --dry-run
```

## 9. Web server and API service

```bash
cd /opt/tender-manager
sudo cp deploy/nginx/tender-manager.conf /etc/nginx/sites-available/
sudo sed -i 's/YOUR_DOMAIN/yourdomain.com/g' /etc/nginx/sites-available/tender-manager.conf
sudo ln -s /etc/nginx/sites-available/tender-manager.conf /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

sudo cp deploy/systemd/tender-manager-api.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now tender-manager-api
systemctl status tender-manager-api        # should say "active (running)"
curl -s http://127.0.0.1:4000/api/health   # {"ok":true}
```

Let the `tdm` user restart the API during updates, and nothing else:

```bash
echo 'tdm ALL=(root) NOPASSWD: /usr/bin/systemctl restart tender-manager-api' | sudo tee /etc/sudoers.d/tender-manager
sudo chmod 440 /etc/sudoers.d/tender-manager
```

## 10. Backups

The database password for backups, readable only by `tdm`:

```bash
sudo tee /etc/tender-manager/mysql-backup.cnf > /dev/null <<'EOF'
[client]
user=tdm
password=THE_DB_PASSWORD
EOF
sudo chown tdm:tdm /etc/tender-manager/mysql-backup.cnf && sudo chmod 600 /etc/tender-manager/mysql-backup.cnf
```

Run one by hand, then schedule it daily:

```bash
sudo -iu tdm
/opt/tender-manager/deploy/scripts/backup.sh
crontab -e
# add:
30 2 * * * /opt/tender-manager/deploy/scripts/backup.sh >> /var/log/tender-manager/backup.log 2>&1
```

Backups stay 14 days in `/var/backups/tender-manager`. A backup on the same server doesn't help if the server is lost, so also copy them off it:

1. Create a private bucket (Cloudflare R2 or Backblaze B2) and an access key for it.
2. As `tdm`, run `rclone config` and add the bucket as a remote, e.g. named `r2`.
3. In the crontab line, put `RCLONE_REMOTE=r2:tender-manager-backups` before the script path.

**Test a restore once a month.** It restores into a separate database, so the live data is never touched:

```bash
/opt/tender-manager/deploy/scripts/restore.sh /var/backups/tender-manager/db_<date>.sql.gz /var/backups/tender-manager/files_<date>.tar.gz
```

It prints how many clients, users, tenders and files the backup holds. Compare them with the app.

## 11. Check it works

1. Open `https://owner.yourdomain.com`, sign in with the seed password, change it, turn on two-step login.
2. Owner panel → Plans: set your real plans and prices.
3. Owner panel → Clients → New client: create a test client, open its invitation link, set a password, sign in at `https://<slug>.yourdomain.com`.
4. Upload an Excel file, open a tender, add a document, download it.
5. Use "Forgot password?" to check emails arrive (once SMTP is set).

## Moving a client from the old TMS

Practise first on the server, then do it for real on the agreed day.

1. **On the old server**, back up the old database and the uploaded files:
   ```bash
   mysqldump --single-transaction --no-tablespaces -u root -p tender_dada | gzip > tms_old.sql.gz
   tar -czf tms_uploads.tar.gz -C <old backend folder> uploads
   tar -czf tms_company_images.tar.gz -C <old frontend folder>/public/images companies
   ```
2. **Copy them to the new server** (e.g. `scp` to `/home/deploy/`), and load the old database into a database of its own:
   ```bash
   sudo mysql -e "CREATE DATABASE tms_old CHARACTER SET utf8mb4; GRANT SELECT ON tms_old.* TO 'tdm'@'localhost';"
   gunzip -c tms_old.sql.gz | sudo mysql tms_old
   mkdir -p /tmp/tms && tar -xzf tms_uploads.tar.gz -C /tmp/tms && tar -xzf tms_company_images.tar.gz -C /tmp/tms
   ```
   `tdm` only gets read access to the old data.
3. **Rehearse** (as `tdm`). It does everything, prints a summary, then undoes it all:
   ```bash
   cd /opt/tender-manager/apps/api
   node dist/db/migrate-from-tms.js --source tms_old --slug ostnasik --name "OST Nasik" \
     --uploads /tmp/tms/uploads --company-images /tmp/tms/companies --dry-run
   ```
4. **Check the summary with the client**: number of users, tenders per stage, files. If any number looks wrong, stop and investigate before the real run.
5. **On the day**: put the old TMS in read-only mode (or ask users to stop working), take fresh copies (step 1 and 2 again), run `backup.sh`, then the same command without `--dry-run`.
6. The client signs in at `https://ostnasik.yourdomain.com` with **their old passwords**. Check a few tenders, documents and the installation report together. Under Manage → Bidding companies, check the letterheads and signatures.
7. Keep the old TMS running read-only for 30 days as a fallback, then drop `tms_old`.

The tool refuses to move the same old database twice, and refuses a workspace that already has tenders.

## Updating

When new code is on `main`:

```bash
sudo -iu tdm
/opt/tender-manager/deploy/scripts/deploy.sh
```

It backs up first, then pulls, installs, builds, runs the database migrations, restarts the API and waits for it to answer. The API is down for a few seconds during the restart. If it fails, the message says where to look.

## Moving files to S3 later (optional)

Files start on the server's disk (`/var/lib/tender-manager/storage`), included in the backups. When they grow, move them to a private bucket:

1. Create a private bucket (Cloudflare R2, DigitalOcean Spaces, Amazon S3) and an access key.
2. In `apps/api/.env`, set `STORAGE_DRIVER=s3` and the `S3_*` settings (see `.env.production.example`).
3. Copy the existing files, then restart:
   ```bash
   cd /opt/tender-manager/apps/api
   node dist/db/copy-files-to-s3.js --from /var/lib/tender-manager/storage
   sudo systemctl restart tender-manager-api
   ```
4. Open a few documents in the app. Keep the local folder for a week before deleting it.

## When something goes wrong

| Problem                                           | Look at                                                                                                 |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Site doesn't open                                 | `sudo nginx -t`, `systemctl status nginx`, DNS records (step 1)                                         |
| "502 Bad Gateway"                                 | The API isn't running: `systemctl status tender-manager-api`, `journalctl -u tender-manager-api -n 100` |
| API won't start, "Unsafe settings for production" | The message lists each setting to fix in `apps/api/.env`                                                |
| "This workspace does not exist"                   | The client's address is wrong, or the client hasn't been created in the owner panel                     |
| Certificate warnings                              | `sudo certbot certificates`, `sudo certbot renew --dry-run`                                             |
| Emails not arriving                               | SMTP settings in `.env`; the API log shows each sending error                                           |
| Disk filling up                                   | `df -h`, `du -sh /var/backups/tender-manager /var/lib/tender-manager/storage`                           |
