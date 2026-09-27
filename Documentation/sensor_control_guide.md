# Sensor Control Setup Guide (Raspberry Pi)

This guide explains how to set up `sensor_control.js` on a Raspberry Pi so the
Pi can register a controllable sensor with the RUTAG backend, respond to
on/off commands from the admin portal / app, and (optionally) run automatically
on boot as a systemd service.

Reference implementation: `sensor_control.js`.

---

## 1. What sensor_control.js does

`sensor_control.js` is a **control agent**, not a data logger. It:

- Registers a controllable sensor row on the backend (EC2 PostgreSQL) through
  the Sensor Control API.
- Polls the backend every few seconds for the desired on/off state.
- Drives a Raspberry Pi GPIO pin HIGH (ON) or LOW (OFF) to match that state.
- Exposes a small local HTTP server for status/debug and manual control.

It does **not** push sensor readings (temperature/humidity) to the backend.
Its only job is enabling/disabling the sensor via GPIO based on backend state.

The default sensor type is **DHT11**, but the type/name are configurable, so the
same agent works as a generic on/off GPIO controller for other connected
sensors.

---

## 2. Prerequisites

- Raspberry Pi running Raspberry Pi OS (or compatible Linux).
- Node.js 18+ installed on the Pi.
- The device already registered with `device_registration.js`, so a
  `device_id.txt` file exists in the working directory (the sensor agent reads
  the device ID from it).
- Network access to the backend at `http://16.192.60.95` (current EC2 host).

Install Node.js on the Pi if needed:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.5/install.sh | bash
source ~/.bashrc
nvm install --lts
node --version
```

---

## 3. Install the agent and dependencies

Place `sensor_control.js` and its `package.json` in a folder on the Pi, for
example `~/rutag-pi`:

```bash
mkdir -p ~/rutag-pi
cd ~/rutag-pi
# copy sensor_control.js, package.json, device_id.txt into this folder

npm install
```

Required Node packages:

- `express` - the local control/debug HTTP server.
- `dotenv` - loads the `.env` configuration.
- `onoff` - GPIO access. This is optional: if it is not installed or the Pi has
  no GPIO, the agent still runs and tracks state in software, it just cannot
  physically switch a pin. Install it for real hardware control:

```bash
npm install onoff
```

---

## 4. Wiring the sensor to a GPIO pin

The agent controls one GPIO pin using **BCM numbering**. Valid pins are BCM
0 through 27.

- Connect the control line of your sensor (or a relay/transistor driving it) to
  the chosen BCM pin.
- Connect ground to a Pi GND pin.
- Set that pin number in `DHT_GPIO_PIN` (see configuration below), or let the
  backend assign it during registration.

When enabled, the agent drives the pin HIGH; when disabled, it drives it LOW.

---

## 5. Configuration (.env)

Create a `.env` file in the same folder as `sensor_control.js`:

```
# Backend Sensor Control API (current EC2 host, routed via Nginx /sensor-api)
SENSOR_CONTROL_API_URL=http://16.192.60.95/sensor-api

# Device identity - usually read automatically from device_id.txt
DEVICE_ID_FILE=./device_id.txt
# DEVICE_ID=<optional explicit override>

# Sensor metadata
SENSOR_NAME=DHT11 Sensor
SENSOR_TYPE=dht11

# Auth - must match the values configured on the backend
API_KEY=<same API key configured on EC2>
DEVICE_REGISTRATION_SECRET=<same device secret configured on EC2>

# GPIO pin (BCM numbering, 0-27). Leave unset to let the backend assign it.
DHT_GPIO_PIN=17

# Timing and local server
SENSOR_STATUS_CHECK_INTERVAL_MS=5000
SENSOR_LOCAL_PORT=5000
```

Configuration reference:

| Variable | Default | Purpose |
|---|---|---|
| `SENSOR_CONTROL_API_URL` | `http://13.205.201.82/sensor-api` (old) - set to `http://16.192.60.95/sensor-api` | Base URL of the Sensor Control API |
| `DEVICE_ID_FILE` | `./device_id.txt` | File the device ID is read from |
| `DEVICE_ID` | (from file) | Explicit device ID override |
| `SENSOR_NAME` | `DHT11 Sensor` | Display name registered on backend |
| `SENSOR_TYPE` | `dht11` | Sensor type registered on backend |
| `API_KEY` / `ADMIN_API_KEY` | (required) | API key sent as `x-api-key` |
| `DEVICE_REGISTRATION_SECRET` | (required for register) | Sent as `x-device-secret` |
| `DHT_GPIO_PIN` | (unset) | BCM pin the agent controls |
| `SENSOR_STATUS_CHECK_INTERVAL_MS` | `5000` | Backend state poll interval |
| `SENSOR_LOCAL_PORT` | `5000` | Port for the local control server |

Note: `DEVICE_ID` and `API_KEY` are mandatory. The agent exits immediately if
either is missing.

---

## 6. Run it manually (first test)

```bash
cd ~/rutag-pi
node sensor_control.js
```

Expected output includes lines like:

```
Initializing DHT11 Sensor Control Agent...
EC2 Sensor Control API: http://16.192.60.95/sensor-api
Sensor registered on EC2 (sensor_id=..., pin=17)
Local control server started on port 5000
Starting status monitor (device=..., interval=5000ms, pin=17)
```

Toggling the sensor from the admin portal/app should now flip the GPIO pin
within one poll interval (about 5 seconds).

### Local endpoints (for debugging)

While running, the agent serves these on the Pi:

- `GET http://localhost:5000/sensor/status` - current enabled state, pin, IDs.
- `GET http://localhost:5000/sensor/control?action=on` - force ON locally.
- `GET http://localhost:5000/sensor/control?action=off` - force OFF locally.
- `GET http://localhost:5000/health` - health check.

---

## 7. Run on Pi startup with a systemd service

To make the agent start automatically on boot and restart if it crashes,
create a systemd service.

### 7.1 Create the service file

```bash
sudo nano /etc/systemd/system/sensor-control.service
```

Paste the following. Adjust `User`, `WorkingDirectory`, and the path to `node`
to match your Pi (run `which node` to find the node path; with nvm it is under
`/home/pi/.nvm/versions/node/<version>/bin/node`).

```ini
[Unit]
Description=RUTAG Sensor Control Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/rutag-pi
ExecStart=/usr/bin/node /home/pi/rutag-pi/sensor_control.js
Restart=always
RestartSec=5
# Load environment from the .env-style file (KEY=VALUE per line)
EnvironmentFile=/home/pi/rutag-pi/.env
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

Notes:
- `WorkingDirectory` must be the folder that contains `device_id.txt` so the
  device ID is found.
- `EnvironmentFile` lets systemd load the same `.env` values. Keep it to plain
  `KEY=VALUE` lines (no `export`, no quotes needed for simple values).
- If you use nvm, either point `ExecStart` at the full nvm node path, or install
  a system-wide node so `/usr/bin/node` exists.

### 7.2 Enable and start the service

```bash
sudo systemctl daemon-reload
sudo systemctl enable sensor-control.service
sudo systemctl start sensor-control.service
```

### 7.3 Check status and logs

```bash
# Service status
sudo systemctl status sensor-control.service

# Live logs
journalctl -u sensor-control.service -f

# Last 100 log lines
journalctl -u sensor-control.service -n 100
```

### 7.4 Manage the service

```bash
sudo systemctl restart sensor-control.service   # restart
sudo systemctl stop sensor-control.service       # stop
sudo systemctl disable sensor-control.service    # do not start on boot
```

---

## 8. Multiple sensors on one Pi

`sensor_control.js` manages a single sensor/pin per process. To control several
sensors from the same Pi, run one instance per sensor, each with:

- Its own working directory (or its own `.env`).
- A distinct `SENSOR_NAME`, `SENSOR_TYPE`, and `DHT_GPIO_PIN`.
- A distinct `SENSOR_LOCAL_PORT` (for example 5000, 5001, 5002) so the local
  servers do not clash.
- A separate systemd unit (for example `sensor-control-1.service`,
  `sensor-control-2.service`).

All instances share the same `DEVICE_ID` (the Pi), but register as separate
sensors on the backend.

---

## 9. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Exits with "DEVICE_ID is required" | No `device_id.txt` in the working dir and `DEVICE_ID` not set. Run `device_registration.js` first. |
| Exits with "API_KEY is required" | Set `API_KEY` (or `ADMIN_API_KEY`) in `.env`. |
| Registers but pin never switches | `onoff` not installed, invalid `DHT_GPIO_PIN`, or running without GPIO access. Install `onoff` and use a valid BCM pin (0-27). |
| Registration/poll errors | Check `SENSOR_CONTROL_API_URL` points to `http://16.192.60.95/sensor-api`, and that `API_KEY` / `DEVICE_REGISTRATION_SECRET` match the backend. |
| State lags | Controlled by `SENSOR_STATUS_CHECK_INTERVAL_MS` (default 5s). Lower it for faster response. |
| Port already in use | Another process (or another sensor instance) uses `SENSOR_LOCAL_PORT`. Change it. |

To confirm GPIO access without hardware, hit the local endpoint:

```bash
curl "http://localhost:5000/sensor/status"
curl "http://localhost:5000/sensor/control?action=on"
curl "http://localhost:5000/sensor/control?action=off"
```