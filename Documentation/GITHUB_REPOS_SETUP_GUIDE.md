# GITHUB_REPOS_SETUP_GUIDE

This guide defines repository ownership, purpose, and safe workflow for the RuTAG project.

## 1. Repository Map

## 1.1 Mobile App Repository

- URL: `https://github.com/rutaghacs/rutag-app.git`
- Contains: React Native app code from `sensor_app` folder
- Primary branch: `main`

## 1.2 Backend Repository

- URL: `https://github.com/rutaghacs/rutag_backend.git`
- Contains: Backend service files, API/server logic, backend documentation
- Primary branch: `main`

## 1.3 Admin Portal Repository

- URL: `https://github.com/rutaghacs/rutag-app-admin.git`
- Contains: `admin-portal-v2` service and portal UI
- Primary branch: `main`

## 2. Initial Local Setup

Run once per machine:

1. Configure git identity:
   - `git config --global user.name "<Your Name>"`
   - `git config --global user.email "<your-email>"`
2. Verify access:
   - `git ls-remote https://github.com/rutaghacs/rutag-app.git`
3. Use personal access token / credential manager for authenticated push.

## 3. Branch Strategy

Recommended:

1. Keep `main` always deployable.
2. Create feature branches per task:
   - `feature/<short-description>`
3. Create bugfix branches per issue:
   - `fix/<short-description>`
4. Merge via PR after review.

## 4. Commit Standards

1. Keep commits scoped to one logical change.
2. Use clear commit messages:
   - `feat: add local alert retention filtering`
   - `fix: prevent backend delete in ml alert cleanup`
3. Never commit secrets or credential files.

## 5. Sensitive File Policy

Do not commit:

1. `serviceAccountKey.json`
2. `.env` files with production secrets
3. Private keys / certificates
4. Any token-bearing config files

Use:

1. `.gitignore` for local secrets
2. environment variables on runtime hosts
3. cloud secret managers when available

## 6. Repo-Specific Push Guidance

## 6.1 Push Mobile App (`sensor_app` only)

1. Ensure changes are from `sensor_app` content only.
2. Confirm remote is `rutag-app`.
3. Push to feature branch, open PR, merge to `main`.

## 6.2 Push Backend

1. Confirm backend files belong to backend repo.
2. Verify deployment notes/doc updates are included.
3. Merge to `main` only after smoke tests.

## 6.3 Push Admin Portal

1. Work inside `admin-portal-v2` codebase.
2. Confirm remote is `rutag-app-admin`.
3. Run portal startup test before PR merge.

## 7. Pull Request Checklist

Before opening PR:

1. Code builds locally.
2. Lint/tests pass where applicable.
3. No secrets in diff.
4. Documentation updated for behavior/config changes.
5. Deployment impact described.

## 8. Release Tagging

After production deploy:

1. Tag release commit:
   - `git tag -a vX.Y.Z -m "Release vX.Y.Z"`
2. Push tags:
   - `git push origin --tags`
3. Record release notes and rollback commit.

## 9. Troubleshooting Git Issues

1. Wrong remote:
   - `git remote -v`
   - `git remote set-url origin <correct-url>`
2. Non-fast-forward push:
   - `git pull --rebase origin main`
3. Accidental secret commit:
   - rotate secret immediately
   - remove from history using repository-cleanup workflow

## 10. Ownership and Responsibility

1. Mobile app repo owner: app team lead
2. Backend repo owner: backend team lead
3. Admin repo owner: portal/admin team lead
4. Final release approval: project maintainer
