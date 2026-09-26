# EC2 Setup Guide

This guide describes how to deploy the RUTAG backend on a single AWS EC2 instance
(Amazon Linux 2023). The backend is made up of three Node.js services sitting
behind an Nginx reverse proxy, all backed by a local PostgreSQL database.

## Architecture Overview

```
                         Internet (port 80)
                                |
                             [ Nginx ]
        --------------------------------------------------
        |                    |                            |
   location /          location /sensor-api/     location /alert-api/
        |                    |                     + /socket.io/
        v                    v                            v
  admin-portal          sensor-control              alert-api
  (127.0.0.1:3001)      (127.0.0.1:3002)         (127.0.0.1:3003)
        |                    |                            |
        --------------------------------------------------
                                |
                          PostgreSQL (localhost:5432, DB: sensor_db)
```

| Service         | Folder in this repo      | Local port | Nginx path                 | Entry file                        |
|-----------------|--------------------------|------------|----------------------------|-----------------------------------|
| admin-portal    | `EC2/admin-portal`       | 3001       | `/`                        | `server.js`                       |
| sensor-control  | `EC2/sensor-control`     | 3002       | `/sensor-api/`             | `sensor-control-ec2-server.js`    |
| alert-api       | `EC2/alert-api`          | 3003       | `/alert-api/`, `/socket.io/` | `server.ec2.alert-api.js`       |

All three services share the same PostgreSQL database (`sensor_db`).

---

## Prerequisites

- An EC2 instance running Amazon Linux 2023 (t2.micro / t3.micro is enough for testing).
- SSH access (a `.pem` key pair) or AWS Session Manager.
- A Firebase service account (for FCM push notifications and Firebase sync).
- The security group configured as below.

### Security group inbound rules

| Type       | Protocol | Port | Source     | Purpose                         |
|------------|----------|------|------------|---------------------------------|
| SSH        | TCP      | 22   | Your IP    | Administration                  |
| HTTP       | TCP      | 80   | 0.0.0.0/0  | Public access via Nginx         |
| HTTPS      | TCP      | 443  | 0.0.0.0/0  | Optional, if you add TLS        |

Ports 3001, 3002 and 3003 are **not** exposed publicly. They are only reached
through Nginx on the loopback interface.

---

## 1. Base system setup

```bash
sudo yum update -y

# Node.js (via nvm)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.5/install.sh | bash
source ~/.bashrc
nvm install --lts
node --version

# PM2 process manager
npm install -g pm2

# Nginx
sudo yum install nginx -y
sudo systemctl enable nginx
```

---

## 2. PostgreSQL setup

```bash
sudo yum install postgresql15-server postgresql15 -y
sudo postgresql-setup --initdb
sudo systemctl start postgresql
sudo systemctl enable postgresql
```

Enable password auth by editing `/var/lib/pgsql/data/pg_hba.conf`:

```
local   all             all                                     peer
host    all             all             127.0.0.1/32            md5
host    all             all             ::1/128                 md5
```

Then restart and create the database:

```bash
sudo systemctl restart postgresql
sudo -u postgres psql
```

```sql
CREATE DATABASE sensor_db;
CREATE USER sensor_admin WITH PASSWORD 'CHANGE_ME';
GRANT ALL PRIVILEGES ON DATABASE sensor_db TO sensor_admin;
\q
```

Load the schema (shipped with the admin-portal service):

```bash
sudo -u postgres psql -d sensor_db -f ~/rutag-app-admin/database-schema.sql
```

---

## 3. Deploy the three services

Copy each folder from this repo to the matching directory on the instance.
The service names below match the running PM2 process names.

```bash
# from your machine, or git clone this repo on the instance and copy the folders
#   EC2/admin-portal    -> ~/rutag-app-admin
#   EC2/sensor-control  -> ~/rutag-sensor-control
#   EC2/alert-api       -> ~/rutag-alert-api
```

Install dependencies in each:

```bash
cd ~/rutag-app-admin       && npm install
cd ~/rutag-sensor-control  && npm install
cd ~/rutag-alert-api       && npm install
```

---

## 4. Environment files

Create a `.env` in each service directory. **Never commit these files.**
The Firebase values come from your Firebase service account JSON.

### `~/rutag-app-admin/.env`

```
PORT=3001
DB_HOST=localhost
DB_PORT=5432
DB_NAME=sensor_db
DB_USER=sensor_admin
DB_PASSWORD=CHANGE_ME

# Admin portal login
ADMIN_USERNAME=admin
ADMIN_PASSWORD=CHANGE_ME
SESSION_SECRET=CHANGE_ME

# Shared API key used by the app and the other services
API_KEY=CHANGE_ME

# App session / installation policy
MAX_INSTALLATIONS_PER_USER=3
SESSION_EXPIRY_DAYS=7

# Firebase (from your service account)
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_PRIVATE_KEY_ID=...
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=...
FIREBASE_CLIENT_ID=...
FIREBASE_CLIENT_CERT_URL=...
FIREBASE_DATABASE_URL=https://your-project-id.firebaseio.com

# Firebase -> EC2 sync
FIREBASE_SYNC_ENABLED=true
FIREBASE_SYNC_INTERVAL_MS=30000
```

### `~/rutag-sensor-control/.env`

```
SENSOR_CONTROL_PORT=3002
DB_HOST=localhost
DB_PORT=5432
DB_NAME=sensor_db
DB_USER=sensor_admin
DB_PASSWORD=CHANGE_ME
API_KEY=CHANGE_ME
DEVICE_REGISTRATION_SECRET=CHANGE_ME
```

### `~/rutag-alert-api/.env`

```
PORT=3003
NODE_ENV=production
DATABASE_URL=postgres://sensor_admin:CHANGE_ME@localhost:5432/sensor_db
DB_SSL=false

# Device pairing
DEVICE_REGISTRATION_SECRET=CHANGE_ME
PAIRING_TOKEN_TTL_MS=0            # 0 = QR/passkey never expire
MAX_DEVICES_PER_USER=0           # 0 = no per-user device cap

# Alert image storage (served back through Nginx)
ALERT_IMAGE_UPLOAD_DIR=./alert-images
ALERT_IMAGE_PUBLIC_PATH=/alert-api/images
ALERT_IMAGE_PUBLIC_BASE_URL=http://YOUR_EC2_PUBLIC_IP

# WebSocket CORS
WEBSOCKET_CORS_ORIGIN=*

# Firebase (same values as the admin-portal .env)
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_PRIVATE_KEY_ID=...
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=...
FIREBASE_CLIENT_ID=...
FIREBASE_CLIENT_CERT_URL=...
FIREBASE_DATABASE_URL=https://your-project-id.firebaseio.com
```

> `DEVICE_REGISTRATION_SECRET` and `API_KEY` must be **identical** across the
> services that use them (and match what the Raspberry Pi and the app send).

---

## 5. Nginx reverse proxy

Create `/etc/nginx/conf.d/rutag.conf`:

```nginx
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    # Admin portal (default)
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Sensor control API
    location /sensor-api/ {
        proxy_pass http://127.0.0.1:3002;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    # Alert API
    location /alert-api/ {
        proxy_pass http://127.0.0.1:3003;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    # Alert API WebSocket (Socket.IO)
    location /socket.io/ {
        proxy_pass http://127.0.0.1:3003;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

Test and reload:

```bash
sudo nginx -t
sudo systemctl restart nginx
```

---

## 6. Start the services with PM2

```bash
cd ~/rutag-app-admin      && pm2 start server.js --name admin-portal
cd ~/rutag-sensor-control && pm2 start sensor-control-ec2-server.js --name sensor-control
cd ~/rutag-alert-api      && pm2 start server.ec2.alert-api.js --name alert-api

pm2 save
pm2 startup
# run the command PM2 prints so services restart on reboot
```

Check status:

```bash
pm2 status
pm2 logs alert-api --lines 50
```

---

## 7. Verify

```bash
# Admin portal (should return HTML)
curl -s http://localhost/ | head

# Alert API health (through Nginx)
curl -s http://localhost/alert-api/health

# Sensor control (through Nginx)
curl -s http://localhost/sensor-api/health
```

From a browser, open `http://YOUR_EC2_PUBLIC_IP/` for the admin portal.
The mobile app and Raspberry Pi devices point at:

- Alert / registration API: `http://YOUR_EC2_PUBLIC_IP/alert-api/...`
- Sensor control API:       `http://YOUR_EC2_PUBLIC_IP/sensor-api/...`

---

## Updating a service

```bash
cd ~/rutag-alert-api        # or the relevant service dir
git pull                    # or copy the new files in
npm install
pm2 restart alert-api
```

---

## Notes on secrets

The following files are intentionally **not** included in this repo and must be
created directly on the instance:

- `.env` for each service
- `serviceAccountKey.json` (alert-api Firebase service account), if you use the
  file-based credential instead of the `FIREBASE_*` env vars

Keep these out of version control.