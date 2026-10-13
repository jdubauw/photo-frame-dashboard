import { readFileSync, writeFileSync } from "node:fs";
import { parse, printParseErrorCode } from "jsonc-parser";
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
const errors = [];
const config = parse(readFileSync("wrangler.jsonc", "utf8"), errors, {
  allowTrailingComma: true,
});
if (errors.length) {
  throw new Error(
    `Invalid wrangler.jsonc: ${printParseErrorCode(errors[0].error)} at offset ${errors[0].offset}`,
  );
}
const database = config?.d1_databases?.find((entry) => entry.binding === "DB");
if (!database) throw new Error("wrangler.jsonc must define the DB D1 binding.");
database.database_id = databaseId;
writeFileSync("wrangler.deploy.json", JSON.stringify(config, null, 2) + "\n");
