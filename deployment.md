# Deployment Guide

This is the shortest path to a public prototype while keeping Gemini credentials on the server. The app is a full Next.js Node.js server, not a static export. Tiger Data is optional: SARAH does not currently write telemetry to a database.

## 1. Prove Live Gemini Locally

Use Node.js 24 LTS (Next.js 16 requires Node.js 20.9 or newer). Install dependencies and copy the environment template:

```bash
npm ci
cp .env.example .env.local
```

Create or select a project and API key in [Google AI Studio](https://aistudio.google.com/api-keys). Link an active billing account if the free project's live limits are insufficient; some accounts are prompted to prepay. Check the project's current model-specific quotas on the [AI Studio rate limits page](https://aistudio.google.com/rate-limit) rather than assuming a fixed free-tier allowance. Set a spend cap and monitor [usage and billing](https://aistudio.google.com/billing) before running a mission.

Put the key directly in `.env.local` using an editor. Keep `DECIDER` blank or remove it; `DECIDER=mock` deliberately disables live calls. Keep `NEXT_PUBLIC_DEV_CONSOLE` blank. The app tries its configured Flash-Lite model preference in order only for model-specific unavailability/quota. Never put the key in a `NEXT_PUBLIC_*` variable, source control, a replay, or a client component.

Start the app with `npm run dev`. Check `/api/health` reports `"decider":"gemini"`; this confirms configuration only, not that a model request succeeded. In the UI, press **Run** once and verify the source badge says `LIVE · gemini`, Gemini's decision appears, and its node/frontier declarations appear on the map. That is the T+8 checkpoint. Stop after the first action if only smoke-testing. Do not run a full mission until the project's current quota and billing are understood: it can make up to 40 model calls.

If the request fails, inspect the server terminal. A `400` often points to request/schema incompatibility, `401`/`403` to key or project setup, `429` to quota, spend caps, or rate limits, and `402` to billing/prepay. Do not switch to a local fallback to call the checkpoint live; mock mode is for development without model access.

## 2. Deploy to Azure App Service

The app already has `build` and `start` scripts. App Service must run the Node server so the `/api/*` handlers and live Gemini calls work.

1. In Azure, create a **Linux Web App** using the Node.js 24 LTS runtime. Use the Free F1 plan for an initial `azurewebsites.net` prototype if its resource limits are adequate. A custom domain and App Service managed certificate require a paid plan; choose Basic B1 or higher before connecting GoDaddy.
2. Deploy the repository from the project root using the VS Code **Azure App Service** extension, or configure Deployment Center for the repository and branch. Ensure deployment build automation is enabled so it installs dependencies and runs `npm run build`. For zip deployment, Azure documents `SCM_DO_BUILD_DURING_DEPLOYMENT=true`. The startup command is `npm start` if the platform does not detect the package script automatically.
3. In the Web App's **Configuration / App settings**, add `GEMINI_API_KEY` as a server-side setting. Model preference is configured in source; do not set a model override. Do not set `DECIDER=mock`; remove that setting if it already exists. Do not configure `NEXT_PUBLIC_DEV_CONSOLE`. Save and restart the app after changing settings.
4. Browse to `https://<app-name>.azurewebsites.net/api/health`. Confirm it reports `decider: gemini`, then use **Run** and verify a real decision and map update. The health response only reports whether a key is configured; the UI's `LIVE · gemini` result confirms an actual successful decision.
5. If startup or requests fail, enable App Service application logging and inspect **Log stream**. Do not log or paste the API key. Review Azure Cost Management; App Service plans other than Free are billed while provisioned.

Use an Azure App Service managed identity or another supported secret store for a longer-lived deployment if the team adopts one; app settings are sufficient for this prototype but access to the Azure app configuration must be restricted.

## 3. Optional Tiger Data

Tiger Data is a stretch item, not a deploy prerequisite. No current route or component reads a database URL, and no decision/observation telemetry is persisted to Tiger Data. Creating a database alone will not add charts or recording.

If the team elects to implement telemetry, create a Tiger Cloud service from the [five-minute quickstart](https://www.tigerdata.com/docs/get-started/quickstart/quickstart-5-minutes/). In Tiger Console, download the database config from **Download your database config** and store it privately; the service password is only shown once. Use its PostgreSQL connection string for the server-side integration. Store it as an Azure app setting (for example, `DATABASE_URL`) only after code has been added to consume it. Never commit the config or place credentials in `NEXT_PUBLIC_*` variables. Restrict network access according to Tiger Cloud's current connection guidance, and confirm service pricing/credits before provisioning.

Do not copy credentials from the local `tiger-cloud-credentials.txt` into this guide or a deployment. That file is ignored by Git and should remain private.

## 4. Optional GoDaddy Domain

First make sure the Azure default hostname works over HTTPS. In the Azure portal, open the Web App's **Custom domains** page and start adding the exact hostname you want. Azure shows the verification records and destination values for that app; use those values rather than guessing an IP address.

For a root domain such as `example.com`, Azure normally asks for an A record (`@`) pointing to the app's displayed IP and a TXT ownership record (`asuid`) with Azure's verification ID. For `www.example.com`, Azure normally asks for a CNAME (`www`) pointing to the app's default hostname plus a TXT record (`asuid.www`) with the verification ID. Follow the Azure dialog if it specifies a different supported record arrangement. Keep existing mail and domain records; change only conflicting website records.

In GoDaddy, open **Domain Portfolio → domain → DNS → Add New Record**, add the records Azure requested, and save. Return to Azure, validate ownership, and add the hostname. On Basic B1 or higher, select an App Service managed certificate for the hostname and wait until Azure shows it as secured. Then enable HTTPS-only for the app. DNS updates can take up to 48 hours. GoDaddy DNS changes only apply when the domain uses GoDaddy nameservers.

Enable two-step verification and auto-renew on the GoDaddy account. If the domain has not been purchased yet, choose and register it in GoDaddy first; registration, renewal, Azure hosting, and Gemini usage are separate costs.

## References

- [Next.js Node.js deployment](https://nextjs.org/docs/app/getting-started/deploying)
- [Azure Node.js App Service quickstart](https://learn.microsoft.com/en-us/azure/app-service/quickstart-nodejs)
- [Azure Node.js runtime and startup configuration](https://learn.microsoft.com/en-us/azure/app-service/configure-language-nodejs)
- [Azure custom domains](https://learn.microsoft.com/en-us/azure/app-service/app-service-web-tutorial-custom-domain)
- [Google AI Studio API keys](https://aistudio.google.com/api-keys)
- [Gemini API billing](https://ai.google.dev/gemini-api/docs/billing)
- [Gemini API rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)
- [Gemini API key security](https://ai.google.dev/gemini-api/docs/api-key)
- [Tiger Cloud quickstart](https://www.tigerdata.com/docs/get-started/quickstart/quickstart-5-minutes/)
- [GoDaddy A records](https://www.godaddy.com/help/add-an-a-record-19238)
- [GoDaddy CNAME records](https://www.godaddy.com/help/add-a-cname-record-19236)
