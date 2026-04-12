# DEPLOYMENT_CHECKLIST

This checklist covers deployment validation for:
1. Mobile app (`sensor_app`)
2. Backend services (`rutag_backend` / EC2 APIs)
3. Admin portal (`admin-portal-v2`)

Use this before every production rollout.

## 1. Pre-Deployment Checks

1. Confirm latest code is pushed to correct branch/repository.
2. Confirm secrets are present in runtime environment (not in source code).
3. Confirm no sensitive files are committed (for example `serviceAccountKey.json`).
4. Confirm changelog/release notes are prepared.
5. Confirm rollback point is available (tag/commit/backup).

## 2. Mobile App Deployment Checks

## 2.1 Build readiness

1. `npm install` runs successfully in `sensor_app`.
2. `npx expo start --clear` works without config errors.
3. `app.json` and `eas.json` contain correct package IDs and environment config.
4. Native files are regenerated if plugin/native settings changed.

## 2.2 Authentication and API config

1. Firebase config files are valid for target environment.
2. Google Sign-In IDs/SHA/package values are aligned.
3. Backend URLs are correct and use HTTPS in production.
4. Notification permissions and token registration are verified.

## 2.3 Smoke tests (mobile)

1. Login (Google and/or Email/Password) succeeds.
2. Device list loads.
3. Sensor data refreshes.
4. Alert list loads and retention filter behaves as expected.
5. Camera stream opens.

## 3. Backend Deployment Checks

## 3.1 Service health

1. API process starts successfully.
2. Health endpoint returns 200.
3. Service logs show no startup errors.

## 3.2 Database and Firebase

1. PostgreSQL connection succeeds.
2. Firebase Admin initialization succeeds.
3. Required tables/columns are present.
4. Device registration endpoint works with expected secret header.

## 3.3 Functional API checks

1. Device registration API returns `deviceId`.
2. Alert ingestion endpoint accepts valid payload.
3. User/device access control checks return expected responses.
4. Push notification path is operational.

## 4. Admin Portal Deployment Checks

1. Admin portal process starts and is reachable.
2. Login works with admin credentials.
3. Devices and users load from database.
4. Access-control changes persist and reflect in app behavior.
5. Session/cookie settings are correct for HTTPS/proxy setup.

## 5. Infrastructure and Security Checks

1. Reverse proxy/Nginx routes point to correct upstream services.
2. TLS certificate is valid and not expired.
3. CORS allowlist includes required origins only.
4. Firewall/security group ports are correct.
5. Rate limits and request size limits are configured.

## 6. Post-Deployment Verification

1. Re-run smoke tests for app + backend + admin portal.
2. Verify logs for first 30 minutes after deploy.
3. Verify registration and alert pipelines with one real test device.
4. Confirm no abnormal error-rate spike.
5. Capture release version, deploy time, and owner.

## 7. Rollback Checklist

If critical issues occur:
1. Stop new traffic/deployments.
2. Roll back to last known good version.
3. Restart affected services.
4. Verify health endpoints and primary flows.
5. Document incident and root cause.

## 8. Sign-Off

1. Mobile app checks: ✅ / ❌
2. Backend checks: ✅ / ❌
3. Admin portal checks: ✅ / ❌
4. Security checks: ✅ / ❌
5. Final production approval: ✅ / ❌
