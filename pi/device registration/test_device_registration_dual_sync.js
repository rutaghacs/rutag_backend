#!/usr/bin/env node
/**
 * Device Registration Test - API Registration Flow
 * Registers a device through the Alert API behind Nginx.
 *
 * Usage: node test_device_registration_dual_sync.js
 */

const fs = require('fs');
const os = require('os');

require('dotenv').config();

const registrationUrl = process.env.DEVICE_REGISTRATION_URL || 'http://13.205.201.82/alert-api/api/devices/register';
const registrationSecret = process.env.DEVICE_REGISTRATION_SECRET || '';
const deviceIdFile = process.env.DEVICE_ID_FILE || './device_id.txt';

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

async function runTest() {
  try {
    if (!registrationSecret) {
      throw new Error('DEVICE_REGISTRATION_SECRET is not set in .env');
    }

    const existingDeviceId = readStoredDeviceId();
    const hostname = os.hostname() || 'Raspberry Pi';
    const platform = os.platform();
    const version = typeof os.version === 'function' ? os.version() : os.release();

    const payload = {
      deviceId: existingDeviceId || undefined,
      label: hostname,
      name: hostname,
      platform,
      version,
      location: hostname
    };

    console.log('\n[1] Preparing registration payload...');
    console.log(`    API URL: ${registrationUrl}`);
    console.log(`    Existing Device ID: ${existingDeviceId || 'none - server will generate one'}`);
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
    console.log(`  Device Name: ${result.device?.device_name || hostname}`);
    console.log('  Registration Path: Raspberry Pi -> Nginx -> Alert API -> Firestore + PostgreSQL');
    console.log('  Status: Ready for use');
    console.log('\n💡 Next steps:');
    console.log('  1. Open admin portal: http://13.205.201.82/');
    console.log('  2. Login with admin/admin123');
    console.log('  3. Check Devices tab - your device should appear');
    console.log('  4. You can now restrict/allow this device');
    console.log('\n' + '='.repeat(70) + '\n');

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Registration failed:', error.message);
    console.error('\n🔧 Required .env values on Raspberry Pi:');
    console.error('   DEVICE_REGISTRATION_URL=http://13.205.201.82/alert-api/api/devices/register');
    console.error('   DEVICE_REGISTRATION_SECRET=<same secret configured on EC2 alert API>');
    console.error('   DEVICE_ID_FILE=./device_id.txt');
    console.error(error);
    process.exit(1);
  }
}

runTest();
