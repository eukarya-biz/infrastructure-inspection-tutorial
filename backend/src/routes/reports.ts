import { Router } from "express";
import {
  ALLOWED_CONDITIONS,
  cmsHeaders,
  cmsProjectUrl,
  fetchCmsText,
  getCmsConfig,
  missingEnvVars,
  parseCmsJson,
} from "../cms";

export const reportsRouter = Router();

reportsRouter.get("/", async (_request, response) => {
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

reportsRouter.post("/", async (request, response) => {
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

reportsRouter.post("/:itemId/publish", async (request, response) => {
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
