import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import {
  ALLOWED_CONDITIONS,
  cmsHeaders,
  cmsProjectUrl,
  fetchCmsText,
  getCmsConfig,
  missingEnvVars,
  parseCmsJson,
} from "../cms";

export const assetsRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});

function handleUpload(request: Request, response: Response, next: NextFunction) {
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

assetsRouter.get("/", async (_request, response) => {
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

assetsRouter.post("/upload", handleUpload, async (request, response) => {
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
});

assetsRouter.patch("/:itemId", async (request, response) => {
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
