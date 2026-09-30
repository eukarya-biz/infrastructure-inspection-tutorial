import express from "express";
import dotenv from "dotenv";
import multer from "multer";

dotenv.config();

const app = express();
const port = Number(process.env.PORT) || 3000;

app.use(express.json());

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});

const ALLOWED_CONDITIONS = ["good", "fair", "poor", "critical"];

type CmsConfig = {
  baseUrl: string;
  workspaceId: string;
  projectId: string;
  token: string;
};

function getCmsConfig(): CmsConfig | null {
  const baseUrl = process.env.CMS_BASE_URL;
  const workspaceId = process.env.CMS_WORKSPACE_ID;
  const projectId = process.env.CMS_PROJECT_ID;
  const token = process.env.CMS_INTEGRATION_TOKEN;

  if (!baseUrl || !workspaceId || !projectId || !token) {
    return null;
  }

  return { baseUrl, workspaceId, projectId, token };
}

function cmsProjectUrl(config: CmsConfig, path: string): string {
  return `${config.baseUrl}/${config.workspaceId}/projects/${config.projectId}${path}`;
}

function cmsHeaders(
  config: CmsConfig,
  extra?: Record<string, string>,
): Record<string, string> {
  return {
    Authorization: `Bearer ${config.token}`,
    Accept: "application/json",
    ...extra,
  };
}

async function fetchCmsText(
  response: express.Response,
  url: string,
  init: RequestInit,
  errorMessage: string,
): Promise<string | null> {
  const cmsResponse = await fetch(url, init);
  const body = await cmsResponse.text();

  if (!cmsResponse.ok) {
    response.status(cmsResponse.status).json({
      error: errorMessage,
      details: body,
    });
    return null;
  }

  return body;
}

function parseCmsJson<T>(response: express.Response, body: string): T | null {
  try {
    return JSON.parse(body) as T;
  } catch {
    response.status(502).json({
      error: "The Re:Earth CMS returned an unexpected response",
    });
    return null;
  }
}

function missingEnvVars(response: express.Response) {
  response.status(500).json({
    error: "One or more CMS environment variables are missing",
  });
}

function handleUpload(
  request: express.Request,
  response: express.Response,
  next: express.NextFunction,
) {
  upload.single("file")(request, response, (err: unknown) => {
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      response.status(400).json({
        error: "The photo must be 5 MB or smaller",
      });
      return;
    }

    if (err) {
      response.status(400).json({
        error: "The photo could not be processed",
      });
      return;
    }

    next();
  });
}

app.get("/api/health", (_request, response) => {
  response.json({ status: "ok" });
});

app.get("/api/assets", async (_request, response) => {
  try {
    const config = getCmsConfig();
    const modelKey = process.env.CMS_ASSETS_MODEL;

    if (!config || !modelKey) {
      missingEnvVars(response);
      return;
    }

    const url = cmsProjectUrl(config, `/models/${modelKey}/items?asset=true`);
    const body = await fetchCmsText(
      response,
      url,
      { headers: cmsHeaders(config) },
      "The Re:Earth CMS request failed",
    );

    if (body === null) {
      return;
    }

    const cmsData = JSON.parse(body) as {
      items: Array<{
        id: string;
        fields: Array<{
          key: string;
          value: unknown;
        }>;
      }>;
    };

    const features = cmsData.items.flatMap((item) => {
      const fields = Object.fromEntries(
        item.fields.map((field) => [field.key, field.value]),
      );

      if (typeof fields.location !== "string") {
        return [];
      }

      try {
        const geometry = JSON.parse(fields.location);

        if (geometry.type !== "Point" || !Array.isArray(geometry.coordinates)) {
          return [];
        }

        const referencePhoto = fields["reference-photo"] as
          | { url?: string }
          | null;

        return [
          {
            type: "Feature",
            id: item.id,
            geometry,
            properties: {
              itemId: item.id,
              assetId: fields["asset-id"] ?? null,
              assetName: fields["asset-name"] ?? null,
              assetType: fields["asset-type"] ?? null,
              currentCondition: fields["current-condition"] ?? null,
              lastInspectedAt: fields["last-inspected-at"] ?? null,
              referencePhotoUrl: referencePhoto?.url ?? null,
            },
          },
        ];
      } catch {
        return [];
      }
    });

    response.json({
      type: "FeatureCollection",
      features,
    });
  } catch (error) {
    console.error(error);
    response.status(500).json({
      error: "Unable to retrieve infrastructure assets",
    });
  }
});

app.get("/api/reports", async (_request, response) => {
  try {
    const config = getCmsConfig();
    const modelKey = process.env.CMS_REPORTS_MODEL;

    if (!config || !modelKey) {
      missingEnvVars(response);
      return;
    }

    const url = cmsProjectUrl(
      config,
      `/models/${modelKey}/items?asset=true&sort=createdAt&dir=desc`,
    );
    const body = await fetchCmsText(
      response,
      url,
      { headers: cmsHeaders(config) },
      "The Re:Earth CMS request failed",
    );

    if (body === null) {
      return;
    }

    const cmsData = JSON.parse(body) as {
      items: Array<{
        id: string;
        createdAt: string;
        fields: Array<{
          key: string;
          value: unknown;
        }>;
      }>;
    };

    const reports = cmsData.items.map((item) => {
      const fields = Object.fromEntries(
        item.fields.map((field) => [field.key, field.value]),
      );

      const photos = Array.isArray(fields.photos)
        ? (fields.photos as Array<{ url?: string }>)
            .map((photo) => photo?.url)
            .filter((url): url is string => Boolean(url))
        : [];

      return {
        itemId: item.id,
        createdAt: item.createdAt,
        assetId: fields["asset-id"] ?? null,
        assetType: fields["asset-type"] ?? null,
        inspectionDate: fields["inspection-date"] ?? null,
        condition: fields.condition ?? null,
        issueCategory: fields["issue-category"] ?? null,
        severity: fields.severity ?? null,
        notes: fields.notes ?? null,
        reportStatus: fields["report-status"] ?? null,
        photos,
      };
    });

    response.json({ reports });
  } catch (error) {
    console.error(error);
    response.status(500).json({
      error: "Unable to retrieve inspection reports",
    });
  }
});

app.post("/api/reports", async (request, response) => {
  try {
    const {
      assetId,
      assetType,
      location,
      inspectionDate,
      condition,
      issueCategory,
      severity,
      notes,
      photoIds,
    } = request.body;

    if (
      !assetId ||
      !assetType ||
      !location ||
      !inspectionDate ||
      !condition ||
      !issueCategory ||
      !severity
    ) {
      response.status(400).json({
        error: "Required inspection fields are missing",
      });
      return;
    }

    if (!ALLOWED_CONDITIONS.includes(condition)) {
      response.status(400).json({
        error: "Condition must be good, fair, poor, or critical",
      });
      return;
    }

    if (issueCategory === "no_issue" && severity !== "not_applicable") {
      response.status(400).json({
        error: "Severity must be 'not_applicable' when there is no issue",
      });
      return;
    }

    if (issueCategory !== "no_issue" && severity === "not_applicable") {
      response.status(400).json({
        error: "Severity 'not_applicable' is only valid when there is no issue",
      });
      return;
    }

    const config = getCmsConfig();
    const modelKey = process.env.CMS_REPORTS_MODEL;

    if (!config || !modelKey) {
      missingEnvVars(response);
      return;
    }

    const fields: Array<{
      key: string;
      type: string;
      value: unknown;
    }> = [
      { key: "asset-id", type: "text", value: assetId },
      { key: "asset-type", type: "select", value: assetType },
      {
        key: "location",
        type: "geometryEditor",
        value:
          typeof location === "string" ? location : JSON.stringify(location),
      },
      {
        key: "inspection-date",
        type: "date",
        value: `${inspectionDate}T00:00:00+09:00`,
      },
      { key: "condition", type: "select", value: condition },
      {
        key: "issue-category",
        type: "select",
        value: issueCategory,
      },
      { key: "severity", type: "select", value: severity },
      { key: "report-status", type: "select", value: "pending" },
    ];

    if (Array.isArray(photoIds)) {
      const validPhotoIds = photoIds.filter(
        (photoId): photoId is string =>
          typeof photoId === "string" && photoId.trim().length > 0,
      );

      if (validPhotoIds.length > 0) {
        fields.push({
          key: "photos",
          type: "asset",
          value: validPhotoIds,
        });
      }
    }

    if (typeof notes === "string" && notes.trim()) {
      fields.push({
        key: "notes",
        type: "textArea",
        value: notes.trim(),
      });
    }

    const url = cmsProjectUrl(config, `/models/${modelKey}/items`);
    const body = await fetchCmsText(
      response,
      url,
      {
        method: "POST",
        headers: cmsHeaders(config, { "Content-Type": "application/json" }),
        body: JSON.stringify({ fields }),
      },
      "The inspection report could not be created",
    );

    if (body === null) {
      return;
    }

    const parsed = parseCmsJson<{ id?: string }>(response, body);

    if (parsed === null) {
      return;
    }

    response.status(201).json(parsed);
  } catch (error) {
    console.error(error);
    response.status(500).json({
      error: "Unable to create the inspection report",
    });
  }
});

app.post(
  "/api/assets/upload",
  handleUpload,
  async (request, response) => {
    try {
      const file = request.file;

      if (!file) {
        response.status(400).json({
          error: "An image file is required",
        });
        return;
      }

      if (!file.mimetype.startsWith("image/")) {
        response.status(400).json({
          error: "Only image files are allowed",
        });
        return;
      }

      const config = getCmsConfig();

      if (!config) {
        missingEnvVars(response);
        return;
      }

      const formData = new FormData();
      const image = new Blob([new Uint8Array(file.buffer)], {
        type: file.mimetype,
      });

      formData.append("file", image, file.originalname);

      const url = cmsProjectUrl(config, "/assets");
      const body = await fetchCmsText(
        response,
        url,
        {
          method: "POST",
          headers: cmsHeaders(config),
          body: formData,
        },
        "The inspection photo could not be uploaded",
      );

      if (body === null) {
        return;
      }

      const uploadedAsset = parseCmsJson<{ id?: string }>(response, body);

      if (uploadedAsset === null) {
        return;
      }

      if (!uploadedAsset.id) {
        response.status(500).json({
          error: "CMS uploaded the photo but returned no asset ID",
        });
        return;
      }

      response.status(201).json({
        id: uploadedAsset.id,
      });
    } catch (error) {
      console.error(error);
      response.status(500).json({
        error: "Unable to upload the inspection photo",
      });
    }
  },
);

app.post("/api/reports/:itemId/publish", async (request, response) => {
  try {
    const { itemId } = request.params;

    const config = getCmsConfig();
    const modelKey = process.env.CMS_REPORTS_MODEL;

    if (!config || !modelKey) {
      missingEnvVars(response);
      return;
    }

    const url = cmsProjectUrl(
      config,
      `/models/${modelKey}/items/${encodeURIComponent(itemId)}/publish`,
    );
    const body = await fetchCmsText(
      response,
      url,
      {
        method: "POST",
        headers: cmsHeaders(config),
      },
      "The inspection report could not be published",
    );

    if (body === null) {
      return;
    }

    const parsed = parseCmsJson<Record<string, unknown>>(response, body);

    if (parsed === null) {
      return;
    }

    response.json(parsed);
  } catch (error) {
    console.error(error);
    response.status(500).json({
      error: "Unable to publish the inspection report",
    });
  }
});

app.patch("/api/assets/:itemId", async (request, response) => {
  try {
    const { itemId } = request.params;
    const { condition, inspectedAt } = request.body;

    if (!ALLOWED_CONDITIONS.includes(condition)) {
      response.status(400).json({
        error: "Condition must be good, fair, poor, or critical",
      });
      return;
    }

    const config = getCmsConfig();
    const modelKey = process.env.CMS_ASSETS_MODEL;

    if (!config || !modelKey) {
      missingEnvVars(response);
      return;
    }

    const itemUrl = cmsProjectUrl(
      config,
      `/models/${modelKey}/items/${encodeURIComponent(itemId)}`,
    );

    const updateBody = await fetchCmsText(
      response,
      itemUrl,
      {
        method: "PATCH",
        headers: cmsHeaders(config, { "Content-Type": "application/json" }),
        body: JSON.stringify({
          fields: [
            {
              key: "current-condition",
              type: "select",
              value: condition,
            },
            {
              key: "last-inspected-at",
              type: "date",
              // `inspectedAt` already arrives as a fully-zoned ISO string
              // (e.g. with a +09:00 offset) — re-parsing it through `Date`
              // and calling `.toISOString()` would convert it to UTC and
              // shift its calendar date, so it's passed through as-is.
              value: inspectedAt || new Date().toISOString(),
            },
          ],
        }),
      },
      "The infrastructure asset could not be updated",
    );

    if (updateBody === null) {
      return;
    }

    // Republish the asset so its new condition is available
    // through the Public API and Re:Earth Visualizer.
    const publishBody = await fetchCmsText(
      response,
      `${itemUrl}/publish`,
      {
        method: "POST",
        headers: cmsHeaders(config),
      },
      "The asset was updated but could not be republished",
    );

    if (publishBody === null) {
      return;
    }

    const parsed = parseCmsJson<Record<string, unknown>>(response, publishBody);

    if (parsed === null) {
      return;
    }

    response.json(parsed);
  } catch (error) {
    console.error(error);
    response.status(500).json({
      error: "Unable to update the infrastructure asset",
    });
  }
});

app.listen(port, () => {
  console.log(`Backend running at http://localhost:${port}`);
});
