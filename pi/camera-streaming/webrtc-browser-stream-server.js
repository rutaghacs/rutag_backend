#!/usr/bin/env node
/**
 * Raspberry Pi — WebRTC Browser Stream Server
 *
 * Streams Pi camera directly to Chrome via WebRTC.
 * Signaling is handled through Firebase Realtime Database.
 *
 * Prerequisites on the Pi:
 *   sudo apt-get install -y nodejs npm ffmpeg
 *   npm install firebase-admin wrtc dotenv
 *
 * .env file (same directory):
 *   FIREBASE_KEY_PATH=./serviceAccountKey.json
 *   FIREBASE_DB_URL=https://rutag-app-default-rtdb.asia-southeast1.firebasedatabase.app
 *   DEVICE_ID=<your-device-id>    # optional; falls back to device_id.txt
 *
 * Run:
 *   node webrtc-browser-stream-server.js
 */

'use strict';

require('dotenv').config();

const admin = require('firebase-admin');
const { RTCPeerConnection, RTCSessionDescription, RTCIceCandidate, MediaStream, nonstandard } = require('wrtc');
const { RTCVideoSource } = nonstandard;
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const os = require('os');

// ─── Configuration ────────────────────────────────────────────────────────────

const SERVICE_ACCOUNT_PATH = process.env.FIREBASE_KEY_PATH || './serviceAccountKey.json';
const FIREBASE_DB_URL = process.env.FIREBASE_DB_URL || process.env.FIREBASE_DB_UTRL;

let DEVICE_ID = process.env.DEVICE_ID || '';
if (!DEVICE_ID) {
  try {
    DEVICE_ID = fs.readFileSync('./device_id.txt', 'utf8').trim();
  } catch (_) {
    DEVICE_ID = 'rpi-' + os.hostname();
  }
}

const VIDEO_WIDTH  = parseInt(process.env.WEBRTC_WIDTH  || '640',  10);
const VIDEO_HEIGHT = parseInt(process.env.WEBRTC_HEIGHT || '480',  10);
const VIDEO_FPS    = Math.max(15, Math.min(60, parseInt(process.env.WEBRTC_FPS || '30', 10) || 30));
const VIDEO_BITRATE = process.env.WEBRTC_BITRATE || '1000k';
const ENABLE_PREVIEW = /^(1|true|yes)$/i.test(process.env.WEBRTC_PREVIEW || '');

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
];

// ─── Startup checks ───────────────────────────────────────────────────────────

if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
  console.error(`[ERROR] Firebase service account key not found at: ${SERVICE_ACCOUNT_PATH}`);
  console.error('        Set FIREBASE_KEY_PATH in .env or place serviceAccountKey.json here.');
  process.exit(1);
}

if (!FIREBASE_DB_URL) {
  console.error('[ERROR] FIREBASE_DB_URL is not set in .env');
  console.error('[ERROR] If you used FIREBASE_DB_UTRL by mistake, rename it to FIREBASE_DB_URL.');
  process.exit(1);
}

if (!process.env.FIREBASE_DB_URL && process.env.FIREBASE_DB_UTRL) {
  console.warn('[WARN] Using FIREBASE_DB_UTRL fallback. Please rename it to FIREBASE_DB_URL in .env');
}

// ─── Firebase init ────────────────────────────────────────────────────────────

const serviceAccount = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: FIREBASE_DB_URL,
});
const db = admin.database();

console.log('╔══════════════════════════════════════════════════════╗');
console.log('║   🎥  WebRTC Browser Stream Server                   ║');
console.log(`║   Device ID : ${DEVICE_ID.padEnd(37)}║`);
console.log(`║   Resolution: ${VIDEO_WIDTH}x${VIDEO_HEIGHT} @ ${VIDEO_FPS}fps`.padEnd(55) + '║');
console.log('╚══════════════════════════════════════════════════════╝');

// ─── Active session tracking ─────────────────────────────────────────────────

const activeSessions = new Map(); // sessionId → { pc, ffmpeg, cleanup }

// ─── Camera capture via ffmpeg ────────────────────────────────────────────────

/**
 * Returns a wrtc RTCVideoSource and starts pushing frames from the Pi camera.
 * Uses rpicam-vid (Pi 5 / bullseye+) or libcamera-vid falling back to ffmpeg /dev/video0.
 *
 * Frame format pushed into RTCVideoSource: I420 (YUV 4:2:0).
 */
function createCameraSource() {
  const source = new RTCVideoSource();
  const FRAME_BYTES = Math.floor(VIDEO_WIDTH * VIDEO_HEIGHT * 1.5); // I420
  let frameCounter = 0;
  let lastFrameLogAt = Date.now();

  // Try rpicam-vid first, fall back to libcamera-vid, then ffmpeg v4l2
  let cameraCmd, cameraArgs;

  const hasRpicam = commandExists('rpicam-vid');
  const hasLibcamera = commandExists('libcamera-vid');

  if (hasRpicam) {
    // rpicam-vid → raw H264 → ffmpeg decodes → raw yuv420p frames
    cameraCmd = 'rpicam-vid';
    cameraArgs = ['--timeout', '0', '--codec', 'h264', '--bitrate', VIDEO_BITRATE,
                  '--width', String(VIDEO_WIDTH), '--height', String(VIDEO_HEIGHT),
                  '--framerate', String(VIDEO_FPS), '--inline'];
    if (!ENABLE_PREVIEW) {
      cameraArgs.push('--nopreview');
    }
    cameraArgs.push('-o', '-');
  } else if (hasLibcamera) {
    cameraCmd = 'libcamera-vid';
    cameraArgs = ['--timeout', '0', '--codec', 'h264', '--bitrate', VIDEO_BITRATE,
                  '--width', String(VIDEO_WIDTH), '--height', String(VIDEO_HEIGHT),
                  '--framerate', String(VIDEO_FPS), '--inline'];
    if (!ENABLE_PREVIEW) {
      cameraArgs.push('--nopreview');
    }
    cameraArgs.push('-o', '-');
  } else {
    // Generic V4L2 via ffmpeg (USB cam or Pi using v4l2-ctl)
    cameraCmd = 'ffmpeg';
    cameraArgs = ['-f', 'v4l2', '-input_format', 'h264',
                  '-video_size', `${VIDEO_WIDTH}x${VIDEO_HEIGHT}`, '-framerate', String(VIDEO_FPS),
                  '-i', '/dev/video0',
                  '-vf', `scale=${VIDEO_WIDTH}:${VIDEO_HEIGHT}`,
                  '-f', 'h264', '-'];
  }

  // Pipe camera H264 output into ffmpeg for YUV420p raw frames
  const camProcess = spawn(cameraCmd, cameraArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

  const ffmpeg = spawn('ffmpeg', [
    '-loglevel', 'error',
    '-f', 'h264',
    '-i', 'pipe:0',
    '-vf', `scale=${VIDEO_WIDTH}:${VIDEO_HEIGHT}`,
    '-f', 'rawvideo',
    '-pix_fmt', 'yuv420p',
    'pipe:1',
  ], { stdio: ['pipe', 'pipe', 'pipe'] });

  camProcess.stdout.pipe(ffmpeg.stdin);

  camProcess.stderr.on('data', d => process.stdout.write(`[cam] ${d}`));
  ffmpeg.stderr.on('data', d => process.stdout.write(`[ffmpeg] ${d}`));

  camProcess.on('error', err => console.error('[cam] Process error:', err.message));
  ffmpeg.on('error', err => console.error('[ffmpeg] Process error:', err.message));

  let buf = Buffer.alloc(0);

  ffmpeg.stdout.on('data', chunk => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= FRAME_BYTES) {
      const frameData = buf.slice(0, FRAME_BYTES);
      buf = buf.slice(FRAME_BYTES);

      const i420Frame = {
        width: VIDEO_WIDTH,
        height: VIDEO_HEIGHT,
        data: new Uint8ClampedArray(frameData),
      };

      try {
        source.onFrame(i420Frame);
        frameCounter += 1;
        const now = Date.now();
        if (now - lastFrameLogAt >= 5000) {
          console.log(`[Camera] Delivered ${frameCounter} frames in last 5s`);
          frameCounter = 0;
          lastFrameLogAt = now;
        }
      } catch (_) { /* ignore if no peer is listening yet */ }
    }
  });

  console.log(`[Camera] Started: ${cameraCmd} ${cameraArgs.slice(0, 4).join(' ')} …`);
  console.log(`[Camera] Preview: ${ENABLE_PREVIEW ? 'enabled' : 'disabled'}`);

  return { source, camProcess, ffmpeg };
}

// ─── WebRTC session handler ───────────────────────────────────────────────────

async function handleSession(sessionId, sessionData, cameraSource) {
  if (activeSessions.has(sessionId)) return; // already handling

  console.log(`[Session] New session: ${sessionId}`);

  const sessionRef = db.ref(`webrtc_sessions/${sessionId}`);

  // Wait for an offer
  const offerSnap = await sessionRef.child('offer').once('value');
  if (!offerSnap.exists()) {
    console.log(`[Session] ${sessionId}: no offer yet, skipping`);
    return;
  }

  const offerData = offerSnap.val();
  if (!offerData || !offerData.data) {
    console.log(`[Session] ${sessionId}: offer data malformed`);
    return;
  }

  console.log(`[Session] ${sessionId}: handling offer`);

  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  const track = cameraSource.source.createTrack();
  const mediaStream = new MediaStream();
  mediaStream.addTrack(track);
  pc.addTrack(track, mediaStream);

  const seenCandidates = new Set();
  const pendingCandidates = [];
  let remoteDescSet = false;

  async function applyPendingCandidates() {
    for (const c of pendingCandidates) {
      try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch (_) {}
    }
    pendingCandidates.length = 0;
  }

  // Listen for ICE candidates from browser
  sessionRef.child('ice_candidates').on('child_added', async snap => {
    const cand = snap.val();
    if (!cand || seenCandidates.has(snap.key)) return;
    seenCandidates.add(snap.key);
    if (cand.from === 'pi') return;

    const iceInit = {
      candidate: cand.candidate,
      sdpMLineIndex: cand.sdpMLineIndex,
      sdpMid: cand.sdpMid,
    };

    if (remoteDescSet) {
      try { await pc.addIceCandidate(new RTCIceCandidate(iceInit)); }
      catch (_) {}
    } else {
      pendingCandidates.push(iceInit);
    }
  });

  // Send our ICE candidates to Firebase for the browser
  pc.onicecandidate = async event => {
    if (!event.candidate) return;
    try {
      await sessionRef.child('ice_candidates_from_pi').push({
        candidate: event.candidate.candidate,
        sdpMLineIndex: event.candidate.sdpMLineIndex,
        sdpMid: event.candidate.sdpMid,
        from: 'pi',
        timestamp: Date.now(),
      });
    } catch (_) {}
  };

  pc.onconnectionstatechange = () => {
    const state = pc.connectionState;
    console.log(`[Session] ${sessionId}: connection state → ${state}`);
    if (state === 'connected') {
      console.log(`[Session] ${sessionId}: ✅ streaming to browser`);
    }
    if (state === 'disconnected' || state === 'failed' || state === 'closed') {
      cleanupSession(sessionId);
    }
  };

  // Set remote description (offer)
  await pc.setRemoteDescription(new RTCSessionDescription(offerData.data));
  remoteDescSet = true;
  await applyPendingCandidates();

  // Create answer
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  await sessionRef.child('answer').set({
    type: 'answer',
    data: { sdp: answer.sdp, type: answer.type },
    from: 'pi',
    timestamp: Date.now(),
  });

  console.log(`[Session] ${sessionId}: answer sent`);

  activeSessions.set(sessionId, {
    pc,
    cleanup: () => {
      pc.close();
      sessionRef.off();
      sessionRef.remove().catch(() => {});
    },
  });
}

function cleanupSession(sessionId) {
  const session = activeSessions.get(sessionId);
  if (!session) return;
  session.cleanup();
  activeSessions.delete(sessionId);
  console.log(`[Session] ${sessionId}: cleaned up`);
}

// ─── Device status ────────────────────────────────────────────────────────────

async function setDeviceStatus(ready) {
  await db.ref(`device_status/${DEVICE_ID}`).set({
    online: ready,
    webrtcReady: ready,
    lastSeen: Date.now(),
    capabilities: { video: true, audio: false, codec: 'h264' },
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function commandExists(cmd) {
  try { execSync(`which ${cmd}`, { stdio: 'ignore' }); return true; }
  catch (_) { return false; }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('[Init] Starting camera source…');
  const cameraSource = createCameraSource();

  console.log('[Init] Registering device status in Firebase…');
  await setDeviceStatus(true);

  // Heartbeat every 30 seconds
  setInterval(() => setDeviceStatus(true).catch(() => {}), 30_000);

  console.log('[Init] Listening for WebRTC session offers…');

  db.ref('webrtc_sessions').on('child_added', async snap => {
    const sessionId = snap.key;
    const data = snap.val();

    // Only handle sessions targeting this device
    if (!data || data.deviceId !== DEVICE_ID) return;
    if (activeSessions.has(sessionId)) return;

    try {
      // Wait briefly for offer to arrive if it's not in the snapshot yet
      if (!data.offer) {
        await new Promise(r => setTimeout(r, 1500));
      }
      await handleSession(sessionId, data, cameraSource);
    } catch (err) {
      console.error(`[Session] ${sessionId}: error —`, err.message);
    }
  });

  console.log('[Ready] Waiting for browser connections. Press Ctrl+C to stop.\n');
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────

async function shutdown() {
  console.log('\n[Shutdown] Cleaning up…');
  for (const [id] of activeSessions) cleanupSession(id);
  await setDeviceStatus(false).catch(() => {});
  db.goOffline();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch(err => {
  console.error('[Fatal]', err);
  process.exit(1);
});
