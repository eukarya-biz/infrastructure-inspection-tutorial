import type { Response } from "express";

export const ALLOWED_CONDITIONS = ["good", "fair", "poor", "critical"];

export type CmsConfig = {
  baseUrl: string;
  workspaceId: string;
  projectId: string;
  token: string;
};

export function getCmsConfig(): CmsConfig | null {
  const baseUrl = process.env.CMS_BASE_URL;
  const workspaceId = process.env.CMS_WORKSPACE_ID;
  const projectId = process.env.CMS_PROJECT_ID;
  const token = process.env.CMS_INTEGRATION_TOKEN;

  if (!baseUrl || !workspaceId || !projectId || !token) {
    return null;
  }

  return { baseUrl, workspaceId, projectId, token };
}

export function cmsProjectUrl(config: CmsConfig, path: string): string {
  return `${config.baseUrl}/${config.workspaceId}/projects/${config.projectId}${path}`;
}

export function cmsHeaders(
  config: CmsConfig,
  extra?: Record<string, string>,
): Record<string, string> {
  return {
    Authorization: `Bearer ${config.token}`,
    Accept: "application/json",
    ...extra,
  };
}

export async function fetchCmsText(
  response: Response,
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

export function parseCmsJson<T>(response: Response, body: string): T | null {
  try {
    return JSON.parse(body) as T;
  } catch {
    response.status(502).json({
      error: "The Re:Earth CMS returned an unexpected response",
    });
    return null;
  }
}

export function missingEnvVars(response: Response) {
  response.status(500).json({
    error: "One or more CMS environment variables are missing",
  });
}
