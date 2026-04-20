#!/usr/bin/env node

/**
 * Single alert sender for Raspberry Pi.
 * Sends exactly one alert with test.jpg (same directory) attached in screenshot[].
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

require('dotenv').config();

const EC2_HOST = process.env.EC2_HOST || '13.205.201.82';

const ALERT_API_URL =
  process.env.ALERT_API_URL ||
  `http://${EC2_HOST}/alert-api/api/alerts`;
const ALERT_IMAGE_UPLOAD_URL =
  process.env.ALERT_IMAGE_UPLOAD_URL ||
  ALERT_API_URL.replace(/\/api\/alerts$/, '/api/uploads/alert-image');

const ADMIN_PORTAL_URL = process.env.ADMIN_PORTAL_URL || `http://${EC2_HOST}`;
const API_KEY = process.env.API_KEY || process.env.ADMIN_API_KEY || '';
const CHECK_ACCESS_BEFORE_SEND = (process.env.CHECK_ACCESS_BEFORE_SEND || 'false').toLowerCase() === 'true';

const configuredDeviceIdFile = process.env.DEVICE_ID_FILE || './device_id.txt';
const DEVICE_ID_FILE = path.isAbsolute(configuredDeviceIdFile)
  ? configuredDeviceIdFile
  : path.resolve(process.cwd(), configuredDeviceIdFile);

const DEVICE_NAME = process.env.DEVICE_NAME || 'raspberrypi';
const TEST_USER_ID = process.env.TEST_USER_ID || '';
const IMAGE_FILE = path.resolve(__dirname, 'test.jpg');

function readDeviceId() {
  try {
    if (!fs.existsSync(DEVICE_ID_FILE)) {
      console.error(`Error: device ID file not found at ${DEVICE_ID_FILE}`);
      process.exit(1);
    }

    const deviceId = fs.readFileSync(DEVICE_ID_FILE, 'utf8').trim();
    if (!deviceId) {
      console.error('Error: device ID file is empty');
      process.exit(1);
    }

    return deviceId;
  } catch (error) {
    console.error('Error reading device ID file:', error.message);
    process.exit(1);
  }
}

function ensureImageExists() {
  if (!fs.existsSync(IMAGE_FILE)) {
    console.error(`Error: test image not found at ${IMAGE_FILE}`);
    process.exit(1);
  }

  const fileBuffer = fs.readFileSync(IMAGE_FILE);
  const fileKb = (fileBuffer.length / 1024).toFixed(1);

  console.log(`Using image: ${IMAGE_FILE}`);
  console.log(`Image size: ${fileKb} KB`);
}

async function uploadImageToStorage(deviceId) {
  const fileName = `test_${Date.now()}.jpg`;
  const imageBase64 = fs.readFileSync(IMAGE_FILE).toString('base64');
  const response = await sendRequest(
    ALERT_IMAGE_UPLOAD_URL,
    {
      deviceId,
      fileName,
      contentType: 'image/jpeg',
      imageBase64,
    },
    'POST'
  );

  if (!response || response.status < 200 || response.status >= 300 || !response.data?.imageUrl) {
    throw new Error(`EC2 image upload failed: ${JSON.stringify(response?.data || response)}`);
  }

  console.log(`Uploaded image to EC2 storage: ${response.data.imageUrl}`);
  return response.data.imageUrl;
}

function sendRequest(url, data, method = 'POST', extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const isHttps = urlObj.protocol === 'https:';
    const client = isHttps ? https : http;

    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method,
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    };

    options.headers = { ...options.headers, ...extraHeaders };

    if (method === 'POST' && data) {
      const body = JSON.stringify(data);
      options.headers['Content-Length'] = Buffer.byteLength(body);
    }

    const req = client.request(options, (res) => {
      let responseData = '';

      res.on('data', (chunk) => {
        responseData += chunk;
      });

      res.on('end', () => {
        try {
          const parsed = JSON.parse(responseData);
          resolve({ status: res.statusCode, data: parsed });
        } catch {
          resolve({ status: res.statusCode, data: responseData });
        }
      });
    });

    req.on('error', (error) => reject(error));
    req.on('timeout', () => req.destroy(new Error('Request timeout')));

    if (method === 'POST' && data) {
      req.write(JSON.stringify(data));
    }

    req.end();
  });
}

async function checkDeviceStatus(deviceId) {
  const url = `${ADMIN_PORTAL_URL}/api/check-device/${encodeURIComponent(deviceId)}`;

  try {
    const response = await sendRequest(url, null, 'GET', {
      'X-API-Key': API_KEY,
    });

    if (response.status !== 200 || typeof response.data !== 'object') {
      return {
        reachable: false,
        hasAccess: true,
        reason: `Unexpected admin portal response: HTTP ${response.status}`,
      };
    }

    return {
      reachable: true,
      hasAccess: response.data.hasAccess !== false,
      registered: response.data.registered !== false,
      reason: response.data.reason || null,
    };
  } catch (error) {
    return {
      reachable: false,
      hasAccess: true,
      reason: `Admin portal device check failed: ${error.message}`,
    };
  }
}

async function testHealth() {
  const healthUrl = ALERT_API_URL.replace('/api/alerts', '/health');

  try {
    const response = await sendRequest(healthUrl, null, 'GET');
    return response.status === 200;
  } catch {
    return false;
  }
}

async function sendSingleAlert(deviceId, imageUrl) {
  // Default to High so backends that only push for high-risk alerts still notify.
  const riskLevel = process.env.TEST_ALERT_RISK || 'High';
  const message = process.env.TEST_ALERT_MESSAGE || 'Single test alert with image from Raspberry Pi';

  const alertPayload = {
    deviceId,
    ...(TEST_USER_ID ? { userId: TEST_USER_ID } : {}),
    alert: {
      notification_type: 'Alert',
      detected_objects: ['person'],
      risk_label: riskLevel,
      predicted_risk: riskLevel,
      description: [message, `Sent from ${DEVICE_NAME}`],
      screenshot: [imageUrl],
      device_identifier: DEVICE_NAME,
      timestamp: Date.now(),
      model_version: 'v1.0',
      confidence_score: 0.92,
      additional_data: {
        test: true,
        source: 'raspberry_pi',
        sent_at: new Date().toISOString(),
        image_name: 'test.jpg',
      },
    },
  };

  const response = await sendRequest(ALERT_API_URL, alertPayload, 'POST');

  if (response.status === 200) {
    console.log('Success: sent one alert with image.');
    console.log(`Response: ${JSON.stringify(response.data)}`);
    return true;
  }

  console.error(`Alert API error (${response.status}): ${JSON.stringify(response.data)}`);
  return false;
}

async function main() {
  const deviceId = readDeviceId();
  const shouldRunAccessPrecheck = CHECK_ACCESS_BEFORE_SEND && !!API_KEY;

  console.log('------------------------------------------------------------');
  console.log('Single Alert Sender (with test.jpg)');
  console.log('------------------------------------------------------------');
  console.log(`Device ID: ${deviceId}`);
  console.log(`Device ID File: ${DEVICE_ID_FILE}`);
  console.log(`Alert API URL: ${ALERT_API_URL}`);
  console.log(`Alert image upload URL: ${ALERT_IMAGE_UPLOAD_URL}`);
  console.log(`Admin Portal URL: ${ADMIN_PORTAL_URL}`);
  console.log(`Fallback userId: ${TEST_USER_ID || 'not set'}`);
  console.log(`Device precheck: ${shouldRunAccessPrecheck ? 'enabled' : 'disabled'}`);

  if (CHECK_ACCESS_BEFORE_SEND && !API_KEY) {
    console.warn('Warning: CHECK_ACCESS_BEFORE_SEND is true but API_KEY is missing; skipping precheck.');
  }

  if (shouldRunAccessPrecheck) {
    const access = await checkDeviceStatus(deviceId);

    if (!access.reachable) {
      console.warn(`Warning: ${access.reason}`);
      console.warn('Continuing; alert API will enforce final restrictions.');
    } else if (!access.hasAccess) {
      console.error(`Device is not allowed to send alerts: ${access.reason || 'No access'}`);
      process.exit(1);
    } else {
      console.log('Device access check passed.');
    }
  }

  const healthy = await testHealth();
  if (!healthy) {
    console.error('Alert API health check failed. Check ALERT_API_URL/network.');
    process.exit(1);
  }

  ensureImageExists();
  const imageUrl = await uploadImageToStorage(deviceId);
  const ok = await sendSingleAlert(deviceId, imageUrl);
  process.exit(ok ? 0 : 1);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
