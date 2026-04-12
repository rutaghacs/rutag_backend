#!/usr/bin/env node
/**
 * DHT11 Sensor Control Agent (Raspberry Pi)
 *
 * Control-only behavior:
 * - Registers a controllable sensor row in EC2 PostgreSQL via Sensor Control API.
 * - Polls desired on/off state from EC2 API.
 * - Does NOT send sensor readings/data to backend.
 */

const express = require('express');
const os = require('os');
const fs = require('fs');

require('dotenv').config();

let Gpio = null;
try {
  ({ Gpio } = require('onoff'));
} catch {
  Gpio = null;
}

// ============================================
// Configuration
// ============================================
const SENSOR_CONTROL_API_URL = (process.env.SENSOR_CONTROL_API_URL || 'http://13.205.201.82/sensor-api').replace(/\/$/, '');
const DEVICE_ID_FILE = process.env.DEVICE_ID_FILE || './device_id.txt';
const DEVICE_ID = (process.env.DEVICE_ID || (fs.existsSync(DEVICE_ID_FILE) ? fs.readFileSync(DEVICE_ID_FILE, 'utf8').trim() : '')).trim();
const SENSOR_NAME = process.env.SENSOR_NAME || 'DHT11 Sensor';
const SENSOR_TYPE = process.env.SENSOR_TYPE || 'dht11';
const API_KEY = process.env.API_KEY || process.env.ADMIN_API_KEY || '';
const DEVICE_SECRET = process.env.DEVICE_REGISTRATION_SECRET || '';
const STATUS_CHECK_INTERVAL = Number(process.env.SENSOR_STATUS_CHECK_INTERVAL_MS || 5000);
const HTTP_PORT = Number(process.env.SENSOR_LOCAL_PORT || 5000);
const VALID_BCM_GPIO_PINS = new Set([
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13,
  14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25,
  26, 27,
]);

const DEFAULT_GPIO_PIN = (() => {
  const raw = process.env.DHT_GPIO_PIN;
  if (raw === undefined || raw === null || raw === '') {
    return null;
  }

  const pin = Number(raw);
  if (!Number.isInteger(pin) || !VALID_BCM_GPIO_PINS.has(pin)) {
    return null;
  }

  return pin;
})();

// ============================================
// Global State
// ============================================
let sensorEnabled = true;
let sensorId = null;
let activeGpioPin = DEFAULT_GPIO_PIN;
let gpioController = null;
let gpioWarningPrinted = false;

if (!DEVICE_ID) {
  console.error('❌ DEVICE_ID is required (set DEVICE_ID or DEVICE_ID_FILE)');
  process.exit(1);
}

if (!API_KEY) {
  console.error('❌ API_KEY (or ADMIN_API_KEY) is required for sensor-control API calls');
  process.exit(1);
}

// ============================================
// Utility Functions
// ============================================

async function requestJson(path, { method = 'GET', body, extraHeaders = {} } = {}) {
  const response = await fetch(`${SENSOR_CONTROL_API_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      ...extraHeaders,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${json.error || json.message || text || 'Request failed'}`);
  }

  return json;
}

function parseOptionalPinNumber(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const pin = Number(value);
  if (!Number.isInteger(pin)) {
    return null;
  }

  return pin;
}

function isValidBcmGpioPin(pin) {
  return Number.isInteger(pin) && VALID_BCM_GPIO_PINS.has(pin);
}

function setActiveGpioPin(pin, source) {
  if (pin === null || pin === undefined || pin === '') {
    return false;
  }

  if (!isValidBcmGpioPin(pin)) {
    return false;
  }

  if (activeGpioPin !== pin) {
    activeGpioPin = pin;
    console.log(`📌 Active GPIO pin set to BCM ${activeGpioPin} (${source})`);
    return true;
  }

  return false;
}

function releaseGpioController() {
  if (!gpioController) {
    return;
  }

  try {
    gpioController.writeSync(0);
  } catch (error) {
    // Silent cleanup
  }

  try {
    gpioController.unexport();
  } catch (error) {
    // Silent cleanup
  }

  gpioController = null;
}

function ensureGpioController() {
  if (activeGpioPin === null) {
    return false;
  }

  if (!isValidBcmGpioPin(activeGpioPin)) {
    return false;
  }

  if (!Gpio) {
    return false;
  }

  if (gpioController && Number(gpioController.gpio) === activeGpioPin) {
    return true;
  }

  releaseGpioController();

  try {
    gpioController = new Gpio(activeGpioPin, 'out');
    console.log(`✅ GPIO BCM ${activeGpioPin} initialized for output`);
    return true;
  } catch (error) {
    gpioController = null;
    return false;
  }
}

function applyHardwareState(enabled, source) {
  if (!ensureGpioController() || !gpioController) {
    return false;
  }

  const targetValue = enabled ? 1 : 0;

  try {
    gpioController.writeSync(targetValue);
    console.log(`⚡ GPIO BCM ${activeGpioPin} -> ${enabled ? 'HIGH (ON)' : 'LOW (OFF)'} (${source})`);
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Get local IP for diagnostics
 */
function getLocalIP() {
  try {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        // Skip internal and non-IPv4 addresses
        if (iface.family === 'IPv4' && !iface.internal) {
          return iface.address;
        }
      }
    }
    return null;
  } catch (error) {
    return null;
  }
}

/**
 * Register or upsert this Pi's DHT sensor on EC2
 */
async function registerSensor() {
  try {
    const pinNumberForRegistration = isValidBcmGpioPin(activeGpioPin) ? activeGpioPin : null;
    const response = await requestJson('/api/sensors/register', {
      method: 'POST',
      body: {
        deviceId: DEVICE_ID,
        sensorName: SENSOR_NAME,
        sensorType: SENSOR_TYPE,
        pinNumber: pinNumberForRegistration,
      },
      extraHeaders: {
        'x-device-secret': DEVICE_SECRET,
      },
    });

    sensorId = response?.sensor?.sensor_id || null;
    const registeredPin = parseOptionalPinNumber(response?.sensor?.pin_number);
    if (isValidBcmGpioPin(registeredPin)) {
      setActiveGpioPin(registeredPin, 'backend registration');
    }

    if (sensorId) {
      console.log(`✅ Sensor registered on EC2 (sensor_id=${sensorId}, pin=${activeGpioPin ?? 'none'})`);
      console.log(`🟢 Sensor enabled by default during registration`);
    }
  } catch (error) {
    throw error;
  }
}

/**
 * Poll desired sensor state from EC2 backend
 */
async function checkSensorStatus() {
  try {
    const sensors = await requestJson(`/api/sensors?deviceId=${encodeURIComponent(DEVICE_ID)}`);
    const target = Array.isArray(sensors)
      ? sensors.find((s) => (sensorId ? s.sensor_id === sensorId : String(s.sensor_name || '').toLowerCase() === SENSOR_NAME.toLowerCase())) || sensors[0]
      : null;

    if (!target) {
      return sensorEnabled;
    }

    if (!sensorId && target.sensor_id) {
      sensorId = target.sensor_id;
    }

    const backendPin = parseOptionalPinNumber(target.pin_number);
    const pinChanged = isValidBcmGpioPin(backendPin)
      ? setActiveGpioPin(backendPin, 'backend status')
      : false;

    const backendEnabled = target.enabled !== false;
    let stateChanged = false;
    if (backendEnabled !== sensorEnabled) {
      sensorEnabled = backendEnabled;
      stateChanged = true;
      console.log(`🔄 Sensor state changed from EC2 backend: ${sensorEnabled ? 'ON' : 'OFF'}`);
    }

    if (stateChanged || pinChanged) {
      applyHardwareState(sensorEnabled, 'backend state sync');
    }

    return sensorEnabled;
  } catch (error) {
    return sensorEnabled;
  }
}

/**
 * Status monitoring loop - polls desired state from EC2
 */
async function statusMonitorLoop() {
  console.log(`🔍 Starting status monitor (device=${DEVICE_ID}, interval=${STATUS_CHECK_INTERVAL}ms, pin=${activeGpioPin ?? 'unset'})`);

  while (true) {
    try {
      await checkSensorStatus();
      await new Promise((resolve) => setTimeout(resolve, STATUS_CHECK_INTERVAL));
    } catch (error) {
      await new Promise((resolve) => setTimeout(resolve, STATUS_CHECK_INTERVAL));
    }
  }
}

// ============================================
// Local Express Server (Optional local control/debug)
// ============================================

const app = express();
app.use(express.json());

app.get('/sensor/status', (req, res) => {
  res.json({
    status: 'ok',
    enabled: sensorEnabled,
    pin_number: activeGpioPin,
    device_id: DEVICE_ID,
    sensor_id: sensorId,
    timestamp: Date.now() / 1000,
  });
});

app.get('/sensor/control', (req, res) => {
  const action = String(req.query.action || '').toLowerCase();

  if (action === 'on') {
    sensorEnabled = true;
    applyHardwareState(sensorEnabled, 'local endpoint');
    console.log('✅ Sensor turned ON (local endpoint)');
    return res.json({ status: 'Sensor turned ON', enabled: true });
  }

  if (action === 'off') {
    sensorEnabled = false;
    applyHardwareState(sensorEnabled, 'local endpoint');
    console.log('⏸️  Sensor turned OFF (local endpoint)');
    return res.json({ status: 'Sensor turned OFF', enabled: false });
  }

  return res.status(400).json({ error: 'Invalid action. Use ?action=on or ?action=off' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', sensor_enabled: sensorEnabled, sensor_id: sensorId, pin_number: activeGpioPin });
});

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ============================================
// Main Entry Point
// ============================================

async function main() {
  try {
    console.log('🚀 Initializing DHT11 Sensor Control Agent...');
    console.log(`🌍 EC2 Sensor Control API: ${SENSOR_CONTROL_API_URL}`);
    console.log(`📍 Local IP: ${getLocalIP() || 'unknown'}`);
    console.log(`ℹ️  Mode: Sensor control agent (pin=${activeGpioPin ?? 'auto'})`);

    await registerSensor();
    applyHardwareState(sensorEnabled, 'startup sync');

    const server = app.listen(HTTP_PORT, '0.0.0.0', () => {
      console.log(`🌐 Local control server started on port ${HTTP_PORT}`);
      console.log('Endpoints: /sensor/status, /sensor/control?action=on|off, /health');
    });

    process.on('SIGINT', () => {
      console.log('\n🛑 Shutting down gracefully...');
      releaseGpioController();
      server.close(() => {
        console.log('✅ Goodbye!');
        process.exit(0);
      });
    });

    statusMonitorLoop().catch((error) => {
      process.exit(1);
    });
  } catch (error) {
    process.exit(1);
  }
}

main();
