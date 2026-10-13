# Deploy with GitHub Actions

The workflow in `.github/workflows/deploy-dashboard.yml` builds and checks the
dashboard for pull requests. Pushes to `main` that change the dashboard or workflow
also deploy it to Cloudflare Workers. You can run it manually from the repository's
Actions tab; deployment only happens when the selected branch is `main`.

## One-time setup

In GitHub, open this repository's **Settings → Secrets and variables → Actions**
and add two repository secrets:

| Secret | Value |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | The account ID from your Cloudflare account |
| `CLOUDFLARE_API_TOKEN` | A Cloudflare API token with permission to deploy Workers in that account |

Cloudflare's **Edit Cloudflare Workers** token template is a starting point.
Restrict it to your account. Never commit the token or paste it into source files.
See [Cloudflare's GitHub Actions guide](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/).

The Worker is named `home-dashboard`, as configured in `wrangler.jsonc`. Change
that name before deploying if the account already uses it for another project.
The workflow deploys to the account identified by the repository secret and
prints the resulting URL in its deployment logs.

Use GitHub Actions as the deployment source. If Cloudflare's own Git-connected
builds are already enabled for this Worker, disable those automatic builds to
avoid two deployments for every push.

## First deployment

After the workflow is on `main` and both secrets are saved, open **Actions → Build
and deploy dashboard → Run workflow**, select `main`, and run it. Subsequent
dashboard changes deploy automatically when pushed or merged into `main`.

The deployed page initially contains the upstream demo data. Google Calendar
integration and editable household settings need separate implementation.
Once the deployment URL is ready, save it on the frame:

```sh
adb -d shell am start -n com.wesbos.homehq/.MainActivity --es url https://YOUR-WORKER-URL/
```

## Local validation

From `dashboard/`, using Node 24:

```sh
npm ci
npm run build
npx --no-install wrangler deploy --dry-run
```

These commands build and validate the deployment without publishing it.
