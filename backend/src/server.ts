import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";

dotenv.config();

const app = express();
const port = Number(process.env.PORT) || 3000;

app.use(cors());
app.use(express.json());

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});

app.get("/api/health", (_request, response) => {
  response.json({ status: "ok" });
});

app.get("/api/assets", async (_request, response) => {
  try {
    const baseUrl = process.env.CMS_BASE_URL;
    const workspaceId = process.env.CMS_WORKSPACE_ID;
    const projectId = process.env.CMS_PROJECT_ID;
    const modelKey = process.env.CMS_ASSETS_MODEL;
    const token = process.env.CMS_INTEGRATION_TOKEN;

    if (!baseUrl || !workspaceId || !projectId || !modelKey || !token) {
      response.status(500).json({
        error: "One or more CMS environment variables are missing",
      });
      return;
    }

    const cmsUrl =
      `${baseUrl}/${workspaceId}/projects/${projectId}` +
      `/models/${modelKey}/items`;

    const cmsResponse = await fetch(cmsUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });

    const responseBody = await cmsResponse.text();

    if (!cmsResponse.ok) {
      response.status(cmsResponse.status).json({
        error: "The Re:Earth CMS request failed",
        details: responseBody,
      });
      return;
    }

    const cmsData = JSON.parse(responseBody) as {
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

        return [
          {
            type: "Feature",
            id: item.id,
            geometry,
            properties: {
              itemId: item.id,
              assetId: fields["asset-id"],
              assetName: fields["asset-name"],
              assetType: fields["asset-type"],
              currentCondition: fields["current-condition"],
              lastInspectedAt: fields["last-inspected-at"],
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
    const baseUrl = process.env.CMS_BASE_URL;
    const workspaceId = process.env.CMS_WORKSPACE_ID;
    const projectId = process.env.CMS_PROJECT_ID;
    const modelKey = process.env.CMS_REPORTS_MODEL;
    const token = process.env.CMS_INTEGRATION_TOKEN;

    if (!baseUrl || !workspaceId || !projectId || !modelKey || !token) {
      response.status(500).json({
        error: "One or more CMS environment variables are missing",
      });
      return;
    }

    const cmsUrl =
      `${baseUrl}/${workspaceId}/projects/${projectId}` +
      `/models/${modelKey}/items`;

    const cmsResponse = await fetch(cmsUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });

    const responseBody = await cmsResponse.text();

    if (!cmsResponse.ok) {
      response.status(cmsResponse.status).json({
        error: "The Re:Earth CMS request failed",
        details: responseBody,
      });
      return;
    }

    response.type("application/json").send(responseBody);
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

    const baseUrl = process.env.CMS_BASE_URL;
    const workspaceId = process.env.CMS_WORKSPACE_ID;
    const projectId = process.env.CMS_PROJECT_ID;
    const modelKey = process.env.CMS_REPORTS_MODEL;
    const token = process.env.CMS_INTEGRATION_TOKEN;

    if (!baseUrl || !workspaceId || !projectId || !modelKey || !token) {
      response.status(500).json({
        error: "One or more CMS environment variables are missing",
      });
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

    const cmsUrl =
      `${baseUrl}/${workspaceId}/projects/${projectId}` +
      `/models/${modelKey}/items`;

    const cmsResponse = await fetch(cmsUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ fields }),
    });

    const responseBody = await cmsResponse.text();

    if (!cmsResponse.ok) {
      response.status(cmsResponse.status).json({
        error: "The inspection report could not be created",
        details: responseBody,
      });
      return;
    }

    response.status(201).type("application/json").send(responseBody);
  } catch (error) {
    console.error(error);
    response.status(500).json({
      error: "Unable to create the inspection report",
    });
  }
});

app.post(
  "/api/assets/upload",
  upload.single("file"),
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

      const baseUrl = process.env.CMS_BASE_URL;
      const workspaceId = process.env.CMS_WORKSPACE_ID;
      const projectId = process.env.CMS_PROJECT_ID;
      const token = process.env.CMS_INTEGRATION_TOKEN;

      if (!baseUrl || !workspaceId || !projectId || !token) {
        response.status(500).json({
          error: "One or more CMS environment variables are missing",
        });
        return;
      }

      const formData = new FormData();

      const image = new Blob([new Uint8Array(file.buffer)], {
        type: file.mimetype,
      });

      formData.append("file", image, file.originalname);

      const cmsUrl = `${baseUrl}/${workspaceId}/projects/${projectId}/assets`;

      const cmsResponse = await fetch(cmsUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      const responseBody = await cmsResponse.text();

      if (!cmsResponse.ok) {
        response.status(cmsResponse.status).json({
          error: "The inspection photo could not be uploaded",
          details: responseBody,
        });
        return;
      }

      const uploadedAsset = JSON.parse(responseBody) as {
        id?: string;
      };

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

    const baseUrl = process.env.CMS_BASE_URL;
    const workspaceId = process.env.CMS_WORKSPACE_ID;
    const projectId = process.env.CMS_PROJECT_ID;
    const modelKey = process.env.CMS_REPORTS_MODEL;
    const token = process.env.CMS_INTEGRATION_TOKEN;

    if (!baseUrl || !workspaceId || !projectId || !modelKey || !token) {
      response.status(500).json({
        error: "One or more CMS environment variables are missing",
      });
      return;
    }

    const cmsUrl =
      `${baseUrl}/${workspaceId}/projects/${projectId}` +
      `/models/${modelKey}/items/${itemId}/publish`;

    const cmsResponse = await fetch(cmsUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });

    const responseBody = await cmsResponse.text();

    if (!cmsResponse.ok) {
      response.status(cmsResponse.status).json({
        error: "The inspection report could not be published",
        details: responseBody,
      });
      return;
    }

    response.type("application/json").send(responseBody);
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

    const allowedConditions = ["good", "fair", "poor", "critical"];

    if (!allowedConditions.includes(condition)) {
      response.status(400).json({
        error: "Condition must be good, fair, poor, or critical",
      });
      return;
    }

    const baseUrl = process.env.CMS_BASE_URL;
    const workspaceId = process.env.CMS_WORKSPACE_ID;
    const projectId = process.env.CMS_PROJECT_ID;
    const modelKey = process.env.CMS_ASSETS_MODEL;
    const token = process.env.CMS_INTEGRATION_TOKEN;

    if (!baseUrl || !workspaceId || !projectId || !modelKey || !token) {
      response.status(500).json({
        error: "One or more CMS environment variables are missing",
      });
      return;
    }

    const cmsUrl =
      `${baseUrl}/${workspaceId}/projects/${projectId}` +
      `/models/${modelKey}/items/${itemId}`;

    const updateResponse = await fetch(cmsUrl, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
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
            value: inspectedAt
              ? new Date(inspectedAt).toISOString()
              : new Date().toISOString(),
          },
        ],
      }),
    });

    const updateBody = await updateResponse.text();

    if (!updateResponse.ok) {
      response.status(updateResponse.status).json({
        error: "The infrastructure asset could not be updated",
        details: updateBody,
      });
      return;
    }

    // Republish the asset so its new condition is available
    // through the Public API and Re:Earth Visualizer.
    const publishResponse = await fetch(`${cmsUrl}/publish`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });

    const publishBody = await publishResponse.text();

    if (!publishResponse.ok) {
      response.status(publishResponse.status).json({
        error: "The asset was updated but could not be republished",
        details: publishBody,
      });
      return;
    }

    response.type("application/json").send(publishBody);
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
