# JNC System app

Read the [repository README](../README.md) for Windows/Node prerequisites, Supabase migrations, private environment setup and deployment guidance.

Run these commands from this folder:

```powershell
npm ci
Copy-Item .env.example .env.local
# Configure .env.local locally before operating the app.
npm test
npm run lint
npm run build
npm run start
```

Customer ordering: http://127.0.0.1:3100/order

Staff sign-in: http://127.0.0.1:3100/login?redirect=/admin

For development use `npm run dev`. For publishing and deployment see [GitHub launch](../docs/GITHUB-LAUNCH.md). Keep actual keys, customer uploads and runtime databases out of Git.
