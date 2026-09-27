#!/usr/bin/env node
/**
 * Device Registration - QR + Passkey Two-Factor Pairing
 *
 * PAIRING FLOW:
 *   1. Run this script. Three files are created/updated:
 *        device_id.txt         - server-assigned unique device ID
 *        passkey.txt           - 8-char uppercase alphanumeric secret
 *        device_pairing_qr.png - QR code encoding { deviceId } ONLY
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

// -- Environment configuration ---------------------------------------------

const registrationUrl  = process.env.DEVICE_REGISTRATION_URL
  || 'http://16.192.60.95/alert-api/api/devices/register';

const passkeyUrl = process.env.DEVICE_PASSKEY_URL
  || registrationUrl.replace(/\/devices\/register\/?$/, '/devices/passkey');

const registrationSecret = process.env.DEVICE_REGISTRATION_SECRET || '';
const deviceIdFile   = process.env.DEVICE_ID_FILE       || './device_id.txt';
const deviceNameFile = process.env.DEVICE_NAME_FILE     || './device_name.txt';
const qrImageFile    = process.env.DEVICE_QR_IMAGE_FILE || './device_pairing_qr.png';
const passkeyFile    = process.env.DEVICE_PASSKEY_FILE  || './passkey.txt';

// -- Passkey generation -----------------------------------------------------

function generatePasskey() {
  const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = crypto.randomBytes(8);
  return Array.from(bytes).map(b => ALPHA[b % ALPHA.length]).join('');
}

// -- File I/O ---------------------------------------------------------------

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

// -- Device name prompt -----------------------------------------------------

async function promptDeviceName(fallback) {
  const saved = readFile(deviceNameFile);
  const def   = saved || fallback;

  if (process.env.DEVICE_NAME) return process.env.DEVICE_NAME.trim() || def;

  if (!process.stdin.isTTY) {
    console.log('    Non-interactive - using: ' + def);
    return def;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const ans = await rl.question('    Enter a name for this device [' + def + ']: ');
    return ans.trim() || def;
  } finally { rl.close(); }
}

// -- Passkey upload ---------------------------------------------------------

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

// -- QR display -------------------------------------------------------------

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

// -- Main -------------------------------------------------------------------

async function main() {
  console.log('='.repeat(70));
  console.log('  DEVICE REGISTRATION - QR + PASSKEY PAIRING');
  console.log('='.repeat(70));

  if (!registrationSecret) {
    console.error('ERROR: DEVICE_REGISTRATION_SECRET is not set in .env');
    process.exit(1);
  }

  const existingId = readFile(deviceIdFile);
  const hostname   = os.hostname() || 'Raspberry Pi';

  // Step 1 - device name
  console.log('\n[1] Device name');
  const deviceName = await promptDeviceName(hostname);
  writeFile(deviceNameFile, deviceName, 'device name');

  // Step 2 - register with backend
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

  // Step 3 - generate passkey
  console.log('\n[3] Generating passkey');
  const passkey = generatePasskey();
  writeFile(passkeyFile, passkey, 'passkey');

  // Step 4 - upload passkey hash to backend
  console.log('\n[4] Uploading passkey to backend');
  await uploadPasskey(deviceId, passkey);
  console.log('    OK passkey hash stored on backend');

  // Step 5 - generate QR (deviceId ONLY - passkey is NOT in the QR)
  console.log('\n[5] Generating QR code');
  await QRCode.toFile(qrImageFile, JSON.stringify({ deviceId }), {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 512,
  });
  console.log('    OK QR saved to ' + qrImageFile);

  // Step 6 - display QR
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