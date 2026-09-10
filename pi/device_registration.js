<<<<<<< HEAD
#!/usr/bin/env node
/**
 * Device Registration — QR + Passkey Two-Factor Pairing
 *
 * PAIRING FLOW:
 *   1. Run this script. Three files are created/updated:
 *        device_id.txt         — server-assigned unique device ID
 *        passkey.txt           — 8-char uppercase alphanumeric secret
 *        device_pairing_qr.png — QR code encoding { deviceId } ONLY
 *   2. The passkey is printed clearly on the console.
 *   3. In the app: tap "Scan to Add", scan the QR, then TYPE the passkey
 *      shown on screen / in passkey.txt to complete pairing.
 *
 * QR and passkey are PERMANENT (no expiry). Re-run to rotate both.
 *
 * Usage: node device_registration.js
 */

'use strict';

const crypto = require('crypto');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const readline = require('readline/promises');
const { spawn, spawnSync } = require('child_process');
const QRCode = require('qrcode');

require('dotenv').config();

// ── Environment configuration ─────────────────────────────────────────────

const registrationUrl  = process.env.DEVICE_REGISTRATION_URL
  || 'http://16.192.60.95/alert-api/api/devices/register';

const passkeyUrl = process.env.DEVICE_PASSKEY_URL
  || registrationUrl.replace(/\/devices\/register\/?$/, '/devices/passkey');

const registrationSecret = process.env.DEVICE_REGISTRATION_SECRET || '';
const deviceIdFile   = process.env.DEVICE_ID_FILE       || './device_id.txt';
const deviceNameFile = process.env.DEVICE_NAME_FILE     || './device_name.txt';
const qrImageFile    = process.env.DEVICE_QR_IMAGE_FILE || './device_pairing_qr.png';
const passkeyFile    = process.env.DEVICE_PASSKEY_FILE  || './passkey.txt';

// ── Passkey generation ────────────────────────────────────────────────────

function generatePasskey() {
  const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = crypto.randomBytes(8);
  return Array.from(bytes).map(b => ALPHA[b % ALPHA.length]).join('');
}

// ── File I/O ──────────────────────────────────────────────────────────────

function readFile(filePath) {
  try {
    return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8').trim() || null : null;
  } catch { return null; }
}

function writeFile(filePath, content, label) {
  try {
    fs.writeFileSync(filePath, content + '\n', 'utf8');
    console.log('    OK ' + label + ' -> ' + filePath);
  } catch (e) {
    console.warn('    WARN Could not save ' + filePath + ': ' + e.message);
  }
}

// ── Device name prompt ────────────────────────────────────────────────────

async function promptDeviceName(fallback) {
  const saved = readFile(deviceNameFile);
  const def   = saved || fallback;

  if (process.env.DEVICE_NAME) return process.env.DEVICE_NAME.trim() || def;

  if (!process.stdin.isTTY) {
    console.log('    Non-interactive — using: ' + def);
    return def;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const ans = await rl.question('    Enter a name for this device [' + def + ']: ');
    return ans.trim() || def;
  } finally { rl.close(); }
}

// ── Passkey upload ────────────────────────────────────────────────────────

async function uploadPasskey(deviceId, passkey) {
  const res = await fetch(passkeyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-device-secret': registrationSecret },
    body: JSON.stringify({ deviceId, passkey }),
  });

  const text = await res.text();
  let body = {};
  try { body = JSON.parse(text); } catch { /* ok */ }

  if (!res.ok) {
    throw new Error(res.status + ' ' + (body.error || body.message || 'Passkey upload failed'));
  }
}

// ── QR display ────────────────────────────────────────────────────────────

function displayQr(imagePath) {
  const abs = path.resolve(imagePath);
  const viewers = [
    ['feh',             ['--fullscreen', '--auto-zoom', abs]],
    ['fbi',             ['-T', '1', '-noverbose', '-a', abs]],
    ['eog',             [abs]],
    ['xdg-open',        [abs]],
    ['chromium-browser', ['file://' + abs, '--kiosk']],
    ['display',         [abs]],
  ];
  for (const [cmd, args] of viewers) {
    if (spawnSync('which', [cmd]).status !== 0) continue;
    try {
      spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
      console.log('    Display: using "' + cmd + '"');
      return true;
    } catch { /* try next */ }
  }
  return false;
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log('='.repeat(70));
  console.log('  DEVICE REGISTRATION — QR + PASSKEY PAIRING');
  console.log('='.repeat(70));

  if (!registrationSecret) {
    console.error('ERROR: DEVICE_REGISTRATION_SECRET is not set in .env');
    process.exit(1);
  }

  const existingId = readFile(deviceIdFile);
  const hostname   = os.hostname() || 'Raspberry Pi';

  // Step 1 — device name
  console.log('\n[1] Device name');
  const deviceName = await promptDeviceName(hostname);
  writeFile(deviceNameFile, deviceName, 'device name');

  // Step 2 — register with backend
  console.log('\n[2] Registering with backend');
  console.log('    URL: ' + registrationUrl);

  const regRes = await fetch(registrationUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-device-secret': registrationSecret },
    body: JSON.stringify({
      deviceId: existingId || undefined,
      label: deviceName,
      name: deviceName,
      platform: os.platform(),
      version: typeof os.version === 'function' ? os.version() : os.release(),
      location: hostname,
    }),
  }).catch(e => { throw new Error('Network error: ' + e.message); });

  const regText = await regRes.text();
  let reg = {};
  try { reg = JSON.parse(regText); } catch { throw new Error('Non-JSON response: ' + regText); }
  if (!regRes.ok) throw new Error(regRes.status + ' ' + (reg.error || reg.message || 'Registration failed'));

  const deviceId = reg.deviceId;
  if (!deviceId) throw new Error('Backend did not return a deviceId');

  writeFile(deviceIdFile, deviceId, 'device ID');
  console.log('    Device ID: ' + deviceId);

  // Step 3 — generate passkey
  console.log('\n[3] Generating passkey');
  const passkey = generatePasskey();
  writeFile(passkeyFile, passkey, 'passkey');

  // Step 4 — upload passkey hash to backend
  console.log('\n[4] Uploading passkey to backend');
  await uploadPasskey(deviceId, passkey);
  console.log('    OK passkey hash stored on backend');

  // Step 5 — generate QR (deviceId ONLY — passkey is NOT in the QR)
  console.log('\n[5] Generating QR code');
  await QRCode.toFile(qrImageFile, JSON.stringify({ deviceId }), {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 512,
  });
  console.log('    OK QR saved to ' + qrImageFile);

  // Step 6 — display QR
  const shown = displayQr(qrImageFile);
  if (!shown) {
    console.log('    WARN No image viewer found.');
    console.log('    Open manually: ' + path.resolve(qrImageFile));
  }

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('  REGISTRATION COMPLETE');
  console.log('='.repeat(70));
  console.log('  Device ID   : ' + deviceId);
  console.log('  Device Name : ' + (reg.device?.device_name || deviceName));
  console.log('  QR image    : ' + path.resolve(qrImageFile));
  console.log('  Passkey file: ' + path.resolve(passkeyFile));
  console.log('\n  *** PASSKEY: ' + passkey + ' ***');
  console.log('\n  PAIRING INSTRUCTIONS:');
  console.log('    1. Open the RUTAG app -> Devices tab -> "Scan to Add"');
  console.log('    2. Point the camera at the QR code on this screen');
  console.log('    3. When prompted, TYPE the passkey shown above');
  console.log('\n  NOTE: The passkey is NOT encoded in the QR.');
  console.log('        The QR and passkey never expire. Re-run to rotate.');
  console.log('='.repeat(70) + '\n');

  process.exit(0);
}

main().catch(err => {
  console.error('\nERROR: ' + err.message);
  console.error('\nRequired .env values:');
  console.error('  DEVICE_REGISTRATION_URL=http://16.192.60.95/alert-api/api/devices/register');
  console.error('  DEVICE_REGISTRATION_SECRET=<secret configured on EC2>');
  process.exit(1);
});
=======
#!/usr/bin/env node
/**
 * Device Registration - API Registration + QR Pairing Flow
 * Registers a device through the Alert API behind Nginx, then requests a
 * one-time pairing token and displays it as a QR code so the mobile app can
 * add this exact device by scanning it (Devices tab -> "Scan to Add").
 *
 * The QR code is the ONLY valid way to pair this device to an app account —
 * the app no longer allows adding a device by browsing/tapping a list.
 *
 * Usage: node device_registration.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline/promises');
const { spawn, spawnSync } = require('child_process');
const QRCode = require('qrcode');

require('dotenv').config();

const registrationUrl = process.env.DEVICE_REGISTRATION_URL || 'http://13.205.201.82/alert-api/api/devices/register';
// Pairing-token endpoint defaults to the same host as the registration URL,
// just swapping the final path segment, so a single DEVICE_REGISTRATION_URL
// override still works without extra configuration.
const pairingTokenUrl = process.env.DEVICE_PAIRING_TOKEN_URL
  || registrationUrl.replace(/\/devices\/register\/?$/, '/devices/pairing-token');
const registrationSecret = process.env.DEVICE_REGISTRATION_SECRET || '';
const deviceIdFile = process.env.DEVICE_ID_FILE || './device_id.txt';
const deviceNameFile = process.env.DEVICE_NAME_FILE || './device_name.txt';
const qrImageFile = process.env.DEVICE_QR_IMAGE_FILE || './device_pairing_qr.png';

console.log('='.repeat(70));
console.log('🔥 DEVICE REGISTRATION THROUGH ALERT API (Nginx)');
console.log('='.repeat(70));

function readStoredDeviceId() {
  try {
    if (!fs.existsSync(deviceIdFile)) {
      return null;
    }

    const storedValue = fs.readFileSync(deviceIdFile, 'utf8').trim();
    return storedValue || null;
  } catch (error) {
    console.warn(`⚠️  Could not read ${deviceIdFile}:`, error.message);
    return null;
  }
}

function saveDeviceId(deviceId) {
  try {
    fs.writeFileSync(deviceIdFile, `${deviceId}\n`, 'utf8');
    console.log(`    ✅ Saved device ID to ${deviceIdFile}`);
  } catch (error) {
    console.warn(`    ⚠️  Could not save ${deviceIdFile}:`, error.message);
  }
}

function readStoredDeviceName() {
  try {
    if (!fs.existsSync(deviceNameFile)) {
      return null;
    }

    const storedValue = fs.readFileSync(deviceNameFile, 'utf8').trim();
    return storedValue || null;
  } catch (error) {
    console.warn(`⚠️  Could not read ${deviceNameFile}:`, error.message);
    return null;
  }
}

function saveDeviceName(deviceName) {
  try {
    fs.writeFileSync(deviceNameFile, `${deviceName}\n`, 'utf8');
    console.log(`    ✅ Saved device name to ${deviceNameFile}`);
  } catch (error) {
    console.warn(`    ⚠️  Could not save ${deviceNameFile}:`, error.message);
  }
}

/**
 * Ask the person setting up this Pi for a friendly device name. This is a
 * pure display label — it is NOT the deviceId and never affects how the
 * device is identified/paired. It's only sent as device_name/label so the
 * name shows up in the app and admin portal instead of the raw hostname.
 *
 * Non-interactive runs (no TTY, e.g. a boot script/cron/systemd service)
 * skip the prompt and fall back to any previously saved name, or the
 * hostname if this is the very first run.
 */
async function promptForDeviceName(fallbackName) {
  const previousName = readStoredDeviceName();
  const defaultName = previousName || fallbackName;

  if (process.env.DEVICE_NAME) {
    console.log(`    Using DEVICE_NAME from environment: ${process.env.DEVICE_NAME}`);
    return process.env.DEVICE_NAME.trim() || defaultName;
  }

  if (!process.stdin.isTTY) {
    console.log(`    Non-interactive session — using saved/default name: ${defaultName}`);
    return defaultName;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`    Enter a name for this device [${defaultName}]: `);
    const trimmed = answer.trim();
    return trimmed || defaultName;
  } finally {
    rl.close();
  }
}

/**
 * Request a fresh, time-limited pairing token for this device from the
 * backend. The raw token is only ever returned once here and is never
 * written to disk except embedded (hashed server-side) inside the QR image.
 * Re-running this script rotates the token, which invalidates any
 * previously printed/displayed QR code.
 */
async function requestPairingToken(deviceId) {
  const response = await fetch(pairingTokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-device-secret': registrationSecret
    },
    body: JSON.stringify({ deviceId })
  });

  const responseText = await response.text();
  let result;
  try {
    result = JSON.parse(responseText);
  } catch (error) {
    throw new Error(`Unexpected non-JSON pairing-token response (${response.status}): ${responseText}`);
  }

  if (!response.ok) {
    throw new Error(`${response.status} ${result.error || result.message || 'Pairing token request failed'}`);
  }

  if (!result.token) {
    throw new Error('Pairing token API succeeded but did not return a token');
  }

  return result; // { success, deviceId, token, expiresAt }
}

/**
 * Try a handful of common Linux image viewers so the QR code shows up on
 * whatever display the Pi is connected to (HDMI monitor, official 7" touch
 * screen, etc.). Falls back to printing manual instructions if none exist,
 * since headless Pis with no attached display can't show anything anyway.
 */
function displayQrImage(imagePath) {
  const absolutePath = path.resolve(imagePath);
  const candidateViewers = [
    ['feh', ['--fullscreen', '--auto-zoom', absolutePath]],
    ['fbi', ['-T', '1', '-noverbose', '-a', absolutePath]],
    ['eog', [absolutePath]],
    ['xdg-open', [absolutePath]],
    ['chromium-browser', [`file://${absolutePath}`, '--kiosk']],
    ['display', [absolutePath]], // ImageMagick
  ];

  for (const [command, args] of candidateViewers) {
    const check = spawnSync('which', [command]);
    if (check.status !== 0) continue;

    try {
      const child = spawn(command, args, { stdio: 'ignore', detached: true });
      child.unref();
      console.log(`    🖼️  Displaying QR code with "${command}"`);
      return true;
    } catch (error) {
      console.warn(`    ⚠️  Failed to launch ${command}:`, error.message);
    }
  }

  return false;
}

async function runTest() {
  try {
    if (!registrationSecret) {
      throw new Error('DEVICE_REGISTRATION_SECRET is not set in .env');
    }

    const existingDeviceId = readStoredDeviceId();
    const hostname = os.hostname() || 'Raspberry Pi';
    const platform = os.platform();
    const version = typeof os.version === 'function' ? os.version() : os.release();

    console.log('\n[1] Preparing registration payload...');
    const deviceName = await promptForDeviceName(hostname);
    saveDeviceName(deviceName);

    // deviceName is a display label only — it has no bearing on deviceId,
    // pairing, or how the device is uniquely identified by the backend.
    const payload = {
      deviceId: existingDeviceId || undefined,
      label: deviceName,
      name: deviceName,
      platform,
      version,
      location: hostname
    };

    console.log(`    API URL: ${registrationUrl}`);
    console.log(`    Existing Device ID: ${existingDeviceId || 'none - server will generate one'}`);
    console.log(`    Device Name: ${deviceName}`);
    console.log(`    Hostname: ${hostname}`);
    console.log(`    Platform: ${platform}`);

    console.log('\n[2] Sending registration request through Nginx...');
    const response = await fetch(registrationUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-device-secret': registrationSecret
      },
      body: JSON.stringify(payload)
    });

    const responseText = await response.text();
    let result;

    try {
      result = JSON.parse(responseText);
    } catch (error) {
      throw new Error(`Unexpected non-JSON response (${response.status}): ${responseText}`);
    }

    if (!response.ok) {
      throw new Error(`${response.status} ${result.error || result.message || 'Registration failed'}`);
    }

    const finalDeviceId = result.deviceId;
    if (!finalDeviceId) {
      throw new Error('Registration API succeeded but did not return a deviceId');
    }

    saveDeviceId(finalDeviceId);

    console.log('\n' + '='.repeat(70));
    console.log('✅ REGISTRATION COMPLETE');
    console.log('='.repeat(70));
    console.log('\n📋 Device Summary:');
    console.log(`  Device ID: ${finalDeviceId}`);
    console.log(`  Device Name: ${result.device?.device_name || deviceName}`);
    console.log('  Registration Path: Raspberry Pi -> Nginx -> Alert API -> Firestore + PostgreSQL');
    console.log('  Status: Ready for use');

    console.log('\n[3] Requesting pairing QR code...');
    if (!registrationSecret) {
      throw new Error('DEVICE_REGISTRATION_SECRET is not set in .env');
    }

    const pairingResult = await requestPairingToken(finalDeviceId);
    console.log(`    ✅ Pairing token issued, expires: ${pairingResult.expiresAt}`);

    const qrPayload = JSON.stringify({
      deviceId: finalDeviceId,
      token: pairingResult.token,
    });

    await QRCode.toFile(qrImageFile, qrPayload, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 512,
    });
    console.log(`    ✅ QR code saved to ${qrImageFile}`);

    const displayed = displayQrImage(qrImageFile);

    console.log('\n' + '='.repeat(70));
    if (displayed) {
      console.log('📱 SCAN THIS QR CODE FROM THE RUTAG APP');
      console.log('   Devices tab -> "Scan to Add" -> point the camera at the screen');
    } else {
      console.log('⚠️  No image viewer found on this Pi to auto-display the QR code.');
      console.log(`   Open ${path.resolve(qrImageFile)} manually (copy it to another`);
      console.log('   machine, or install "feh"/"fbi" for automatic display next time)');
    }
    console.log('='.repeat(70));
    console.log(`\n⏳ This QR code expires at ${pairingResult.expiresAt}.`);
    console.log('   Re-run this script at any time to generate a fresh one.');
    console.log('\n' + '='.repeat(70) + '\n');

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Registration failed:', error.message);
    console.error('\n🔧 Required .env values on Raspberry Pi:');
    console.error('   DEVICE_REGISTRATION_URL=http://13.205.201.82/alert-api/api/devices/register');
    console.error('   DEVICE_REGISTRATION_SECRET=<same secret configured on EC2 alert API>');
    console.error('   DEVICE_ID_FILE=./device_id.txt');
    console.error('   DEVICE_QR_IMAGE_FILE=./device_pairing_qr.png   (optional, defaults shown)');
    console.error(error);
    process.exit(1);
  }
}

runTest();
>>>>>>> 744b0d1e170b60032e48961c124a33058690a497
