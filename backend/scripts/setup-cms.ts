// Creates the CMS project, both models, and every field used by this app,
// via the Integration API — the automated alternative to Step 1's console walkthrough.
//
// The Integration API has no way to set a Select field's option list, or a
// Geometry Editor field's supported type. So every such field is created with
// its type and key only, and this script prints which ones still need their
// options or supported type filled in by hand on the CMS's Schema screen -
// a Geometry Editor field with no supported type set shows a hard validation
// error in the UI, not just a quietly-incomplete field.
//
// Usage:
//   CMS_BASE_URL=https://api.cms.reearth.io/api \
//   CMS_WORKSPACE_ID=<your workspace id> \
//   CMS_INTEGRATION_TOKEN=<your integration token> \
//   tsx scripts/setup-cms.ts
//
// (or set these in backend/.env — dotenv.config() reads it automatically)

import dotenv from "dotenv";

dotenv.config();

type FieldType =
  | "text"
  | "textArea"
  | "select"
  | "date"
  | "geometryEditor"
  | "asset";

type FieldDef = {
  key: string;
  type: FieldType;
  required: boolean;
  multiple?: boolean;
  options?: string[]; // documented for the printed follow-up list; the API can't set these
  geometryType?: string; // same reason — the API can't set a Geometry Editor field's supported type
};

type ModelDef = {
  key: string;
  name: string;
  envVar: string;
  fields: FieldDef[];
};

const MODELS: ModelDef[] = [
  {
    key: "infrastructure-assets",
    name: "Infrastructure Assets",
    envVar: "CMS_ASSETS_MODEL",
    fields: [
      { key: "asset-id", type: "text", required: true },
      { key: "asset-name", type: "text", required: true },
      {
        key: "asset-type",
        type: "select",
        required: true,
        options: ["manhole", "streetlight", "traffic_sign", "public_bench"],
      },
      {
        key: "location",
        type: "geometryEditor",
        required: true,
        geometryType: "Point",
      },
      {
        key: "current-condition",
        type: "select",
        required: false,
        options: ["good", "fair", "poor", "critical", "Not inspected"],
      },
      { key: "last-inspected-at", type: "date", required: false },
      { key: "reference-photo", type: "asset", required: false },
    ],
  },
  {
    key: "inspection-reports",
    name: "Inspection Reports",
    envVar: "CMS_REPORTS_MODEL",
    fields: [
      { key: "asset-id", type: "text", required: true },
      {
        key: "asset-type",
        type: "select",
        required: true,
        options: ["manhole", "streetlight", "traffic_sign", "public_bench"],
      },
      {
        key: "location",
        type: "geometryEditor",
        required: true,
        geometryType: "Point",
      },
      { key: "inspection-date", type: "date", required: true },
      {
        key: "condition",
        type: "select",
        required: true,
        options: ["good", "fair", "poor", "critical"],
      },
      {
        key: "issue-category",
        type: "select",
        required: true,
        options: [
          "no_issue",
          "damage",
          "obstruction",
          "missing_component",
          "malfunction",
          "cleaning_required",
          "other",
        ],
      },
      {
        key: "severity",
        type: "select",
        required: true,
        options: ["low", "medium", "high", "urgent", "not_applicable"],
      },
      { key: "notes", type: "textArea", required: false },
      { key: "photos", type: "asset", required: false, multiple: true },
      {
        key: "report-status",
        type: "select",
        required: true,
        options: ["pending", "approved", "resolved"],
      },
    ],
  },
];

const baseUrl = process.env.CMS_BASE_URL ?? "https://api.cms.reearth.io/api";
const workspaceId = process.env.CMS_WORKSPACE_ID;
const token = process.env.CMS_INTEGRATION_TOKEN;
const projectName =
  process.env.CMS_PROJECT_NAME ?? "Infrastructure Inspection Map";

if (!workspaceId || !token) {
  console.error(
    "Missing CMS_WORKSPACE_ID or CMS_INTEGRATION_TOKEN (set them in backend/.env or as env vars).",
  );
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
  Accept: "application/json",
};

async function postJson(path: string, body: unknown) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`POST ${path} failed (${res.status}): ${text}`);
  }
  return JSON.parse(text);
}

async function main() {
  console.log(
    `Creating project "${projectName}" in workspace ${workspaceId}...`,
  );
  const project = await postJson(`/${workspaceId}/projects`, {
    name: projectName,
    description:
      "Created by setup-cms.ts for the Infrastructure Inspection Map tutorial",
  });
  const projectId: string = project.id;
  console.log(`  -> project id: ${projectId}`);

  const needsManualOptions: {
    model: string;
    field: string;
    options: string[];
  }[] = [];
  const needsManualGeometry: {
    model: string;
    field: string;
    geometryType: string;
  }[] = [];

  for (const model of MODELS) {
    console.log(`\nCreating model "${model.name}" (${model.key})...`);
    const created = await postJson(
      `/${workspaceId}/projects/${projectId}/models`,
      { name: model.name, key: model.key },
    );
    const schemaId: string = created.schemaId;
    console.log(`  -> model key for .env's ${model.envVar}: ${created.key}`);

    for (const field of model.fields) {
      await postJson(
        `/${workspaceId}/projects/${projectId}/schemata/${schemaId}/fields`,
        {
          type: field.type,
          key: field.key,
          required: field.required,
          multiple: field.multiple ?? false,
        },
      );
      console.log(`    field created: ${field.key} (${field.type})`);

      if (field.options) {
        needsManualOptions.push({
          model: model.name,
          field: field.key,
          options: field.options,
        });
      }

      if (field.geometryType) {
        needsManualGeometry.push({
          model: model.name,
          field: field.key,
          geometryType: field.geometryType,
        });
      }
    }
  }

  console.log("\n--- Done ---");
  console.log("Add these to backend/.env:");
  console.log(`  CMS_PROJECT_ID=${projectId}`);
  for (const model of MODELS) {
    console.log(`  ${model.envVar}=${model.key}`);
  }

  console.log(
    "\nThe Integration API can't set a Select field's options, so fill these in by hand\n" +
      "on the CMS's Schema screen before using the app:",
  );
  for (const item of needsManualOptions) {
    console.log(`  [${item.model}] ${item.field}: ${item.options.join(" / ")}`);
  }

  console.log(
    "\nThe Integration API also can't set a Geometry Editor field's supported type.\n" +
      'Without it, the field shows a validation error in the CMS UI ("Please select\n' +
      'the Support Type!") — set these on the Schema screen before using the app:',
  );
  for (const item of needsManualGeometry) {
    console.log(`  [${item.model}] ${item.field}: ${item.geometryType}`);
  }
}

main().catch((err) => {
  console.error("Setup failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
