import { readFileSync, writeFileSync } from "node:fs";
const databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID;
if (
  !databaseId ||
  !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    databaseId,
  ) ||
  databaseId === "00000000-0000-0000-0000-000000000000"
)
  throw new Error(
    "Set CLOUDFLARE_D1_DATABASE_ID to the provisioned household D1 database ID.",
  );
const config = JSON.parse(readFileSync("wrangler.jsonc", "utf8"));
config.d1_databases[0].database_id = databaseId;
writeFileSync("wrangler.deploy.json", JSON.stringify(config, null, 2) + "\n");
