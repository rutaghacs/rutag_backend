#!/usr/bin/env node

/**
 * 🚨 Alert Sender for Raspberry Pi (Node.js Version)
 * Sends alerts to Alert API and checks access via Admin Portal
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

require('dotenv').config();

// Configuration
const EC2_HOST = process.env.EC2_HOST || '13.205.201.82';

const ALERT_API_URL =
  process.env.ALERT_API_URL ||
  `http://${EC2_HOST}/alert-api/api/alerts`;
const ALERT_IMAGE_UPLOAD_URL =
  process.env.ALERT_IMAGE_UPLOAD_URL ||
  ALERT_API_URL.replace(/\/api\/alerts$/, '/api/uploads/alert-image');
const TEST_IMAGE_PATH = path.resolve(process.env.TEST_IMAGE_PATH || path.join(__dirname, 'test.jpg'));

const ADMIN_PORTAL_URL = process.env.ADMIN_PORTAL_URL || `http://${EC2_HOST}`;
const API_KEY = process.env.API_KEY || process.env.ADMIN_API_KEY || '';
const CHECK_ACCESS_BEFORE_SEND = (process.env.CHECK_ACCESS_BEFORE_SEND || 'false').toLowerCase() === 'true';
const configuredDeviceIdFile = process.env.DEVICE_ID_FILE || './device_id.txt';
const DEVICE_ID_FILE = path.isAbsolute(configuredDeviceIdFile)
  ? configuredDeviceIdFile
  : path.resolve(process.cwd(), configuredDeviceIdFile);
const DEVICE_NAME = "raspberrypi";

/**
 * Read device ID from file
 */
function readDeviceId() {
  try {
    if (!fs.existsSync(DEVICE_ID_FILE)) {
      console.error(`❌ Error: device ID file not found at ${DEVICE_ID_FILE}`);
      process.exit(1);
    }
    
    const deviceId = fs.readFileSync(DEVICE_ID_FILE, 'utf8').trim();
    
    if (!deviceId) {
      console.error('❌ Error: device ID file is empty');
      process.exit(1);
    }
    
    return deviceId;
  } catch (error) {
    console.error('❌ Error reading device ID file:', error.message);
    process.exit(1);
  }
}

/**
 * Send HTTP request (GET or POST)
 */
function sendRequest(url, data, method = 'POST', extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const isHttps = urlObj.protocol === 'https:';
    const client = isHttps ? https : http;
    
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 5000,
    };

    options.headers = { ...options.headers, ...extraHeaders };

    if (method === 'POST' && data) {
      options.headers['Content-Length'] = Buffer.byteLength(JSON.stringify(data));
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
        } catch (e) {
          resolve({ status: res.statusCode, data: responseData });
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.on('timeout', () => {
      req.destroy(new Error('Request timeout'));
    });

    if (method === 'POST' && data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

async function uploadImageToStorage(deviceId) {
  if (!fs.existsSync(TEST_IMAGE_PATH)) {
    console.warn(`⚠️  Test image not found at ${TEST_IMAGE_PATH}; sending alerts without screenshot.`);
    return null;
  }

  const fileName = `test_${Date.now()}.jpg`;
  const imageBase64 = fs.readFileSync(TEST_IMAGE_PATH).toString('base64');
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
    console.warn(`⚠️  Image upload failed, continuing without screenshot: ${JSON.stringify(response?.data || response)}`);
    return null;
  }

  console.log(`🖼️  Uploaded test image: ${response.data.imageUrl}`);
  return response.data.imageUrl;
}

/**
 * Check whether the device is allowed to send alerts via Admin Portal.
 */
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
      device: response.data.device || null,
    };
  } catch (error) {
    return {
      reachable: false,
      hasAccess: true,
      reason: `Admin portal device check failed: ${error.message}`,
    };
  }
}

/**
 * Send an alert to the Alert API
 */
async function sendAlert(deviceId, riskLevel = "Medium", description = "Test alert from Raspberry Pi", imageUrl = null) {
  const alertPayload = {
    deviceId: deviceId,
    alert: {
      notification_type: "Alert",
      detected_objects: ["test", "detection"],
      risk_label: riskLevel,
      predicted_risk: riskLevel,
      description: [description, `Sent from ${DEVICE_NAME}`],
      screenshot: imageUrl ? [imageUrl] : [],
      device_identifier: DEVICE_NAME,
      timestamp: Date.now(),
      model_version: "v1.0",
      confidence_score: 0.85,
      additional_data: {
        test: true,
        source: "raspberry_pi",
        sent_at: new Date().toISOString(),
        ...(imageUrl ? { image_url: imageUrl } : {})
      }
    }
  };

  try {
    console.log(`🚨 Sending ${riskLevel} alert...`);
    console.log(`📡 API URL: ${ALERT_API_URL}`);

    const response = await sendRequest(ALERT_API_URL, alertPayload);

    console.log(`✅ Response Status: ${response.status}`);

    if (response.status === 200) {
      console.log(`✅ Alert sent successfully!`);
      console.log(`📋 Alert IDs: ${JSON.stringify(response.data.alertIds)}`);
      console.log(`👥 Users notified: ${response.data.usersNotified}`);
      return true;
    } else {
      console.log(`❌ Error: ${JSON.stringify(response.data)}`);
      return false;
    }
  } catch (error) {
    console.error(`❌ Error sending alert: ${error.message}`);
    return false;
  }
}

/**
 * Test if the API is healthy
 */
async function testHealth() {
  const healthUrl = ALERT_API_URL.replace("/api/alerts", "/health");
  
  try {
    console.log(`🏥 Testing health endpoint...`);
    const response = await sendRequest(healthUrl, null, 'GET');

    if (response.status === 200) {
      console.log(`✅ API is healthy`);
      console.log(`   Firebase: ${response.data.firebase ? '✅ Connected' : '⚠️  Disabled'}`);
      return true;
    } else {
      console.log(`❌ Health check failed: ${response.status}`);
      return false;
    }
  } catch (error) {
    console.error(`❌ Health check failed: ${error.message}`);
    return false;
  }
}

/**
 * Main function
 */
async function main() {
  const deviceId = readDeviceId();
  const shouldRunAccessPrecheck = CHECK_ACCESS_BEFORE_SEND && !!API_KEY;

  console.log("=".repeat(60));
  console.log("🚨 Raspberry Pi Alert Sender (Node.js)");
  console.log("=".repeat(60));
  console.log(`Device: ${DEVICE_NAME}`);
  console.log(`Device ID: ${deviceId}`);
  console.log(`Device ID File: ${DEVICE_ID_FILE}`);
  console.log(`Alert API URL: ${ALERT_API_URL}`);
  console.log(`Admin Portal URL: ${ADMIN_PORTAL_URL}`);
  console.log(`Device precheck: ${shouldRunAccessPrecheck ? 'enabled' : 'disabled'}`);
  console.log("=".repeat(60));
  console.log();

  if (CHECK_ACCESS_BEFORE_SEND && !API_KEY) {
    console.warn('⚠️  CHECK_ACCESS_BEFORE_SEND is enabled, but API_KEY/ADMIN_API_KEY is not set.');
    console.warn('⚠️  Skipping device precheck; alert API will enforce final device restrictions.');
    console.log();
  }

  if (shouldRunAccessPrecheck) {
    console.log('🔐 Checking device status via admin portal...');
    const access = await checkDeviceStatus(deviceId);

    if (!access.reachable) {
      console.warn(`⚠️  ${access.reason}`);
      console.warn('⚠️  Continuing in fail-open mode; alert API will do final device checks.');
    } else if (!access.hasAccess) {
      console.error('🚫 Device is not allowed to send alerts.');
      console.error(`   Reason: ${access.reason || 'No access'}`);
      process.exit(1);
    } else {
      console.log('✅ Device is allowed to send alerts');
    }

    console.log();
  }

  // Test health first
  if (!(await testHealth())) {
    console.log("\n❌ Alert API is not responding. Check ALERT_API_URL and internet connection.");
    process.exit(1);
  }

  const uploadedImageUrl = await uploadImageToStorage(deviceId);

  console.log("\n📤 Sending test alerts...");
  console.log("-".repeat(60));

  // Send different risk level alerts
  const alerts = [
    ["Low", "Low risk detection test"],
    ["Medium", "Medium risk detection test"],
    ["High", "High risk detection test"],
    ["Critical", "Critical risk detection test"]
  ];

  for (const [riskLevel, description] of alerts) {
    await sendAlert(deviceId, riskLevel, description, uploadedImageUrl);
    console.log();
    
    // Wait 2 seconds between alerts
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  console.log("=".repeat(60));
  console.log("✅ Test complete!");
  console.log("📱 Check your mobile app for notifications");
  console.log("=".repeat(60));
}

// Run main function
main().catch(error => {
  console.error("❌ Fatal error:", error);
  process.exit(1);
});
