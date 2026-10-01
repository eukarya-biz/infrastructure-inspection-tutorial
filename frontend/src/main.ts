import {
  LngLatBounds,
  Map,
  NavigationControl,
  Popup,
  setWorkerUrl,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "./style.css";

setWorkerUrl(workerUrl);

function localDateString(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

type AssetCollection = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    id?: string;
    geometry: {
      type: "Point";
      coordinates: [number, number];
    };
    properties: {
      itemId: string;
      assetId: string | null;
      assetName: string | null;
      assetType: string | null;
      currentCondition: string | null;
      lastInspectedAt: string | null;
      referencePhotoUrl: string | null;
    };
  }>;
};

type InspectionReport = {
  itemId: string;
  createdAt: string;
  assetId: string | null;
  assetType: string | null;
  inspectionDate: string | null;
  condition: string | null;
  issueCategory: string | null;
  severity: string | null;
  notes: string | null;
  reportStatus: string | null;
  photos: string[];
};

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <div class="app-shell">
    <header>
      <div>
        <h1>Public Infrastructure Inspection Map</h1>
        <p>Select an infrastructure asset to begin an inspection.</p>
      </div>
      <button id="open-report-history" type="button">View report history</button>
    </header>

    <main class="map-container">
      <div id="map"></div>
      <div id="map-status" class="status">Loading assets…</div>

      <div class="legend">
        <strong>Infrastructure assets</strong>
        <span><i class="manhole"></i>Manhole</span>
        <span><i class="streetlight"></i>Streetlight</span>
        <span><i class="traffic-sign"></i>Traffic sign</span>
        <span><i class="public-bench"></i>Public bench</span>
      </div>
    </main>

    <dialog id="inspection-dialog">
      <form id="inspection-form">
        <div class="form-heading">
          <div>
            <h2>New inspection report</h2>
            <p id="selected-asset-name"></p>
          </div>
          <button id="close-form" type="button">×</button>
        </div>

        <input id="selected-asset-id" name="assetId" type="hidden" />
        <input id="selected-asset-type" name="assetType" type="hidden" />
        <input id="selected-location" name="location" type="hidden" />
        <input id="selected-item-id" name="itemId" type="hidden" />

        <label>
          Inspection date
          <input id="inspection-date" name="inspectionDate" type="date" required />
        </label>

        <label>
          Condition
          <select name="condition" required>
            <option value="">Select condition</option>
            <option value="good">Good</option>
            <option value="fair">Fair</option>
            <option value="poor">Poor</option>
            <option value="critical">Critical</option>
          </select>
        </label>

        <label>
          Issue
          <select name="issueCategory" required>
            <option value="">Select issue</option>
            <option value="no_issue">No issue</option>
            <option value="damage">Damage</option>
            <option value="obstruction">Obstruction</option>
            <option value="missing_component">Missing part</option>
            <option value="malfunction">Malfunction</option>
            <option value="cleaning_required">Cleaning required</option>
            <option value="other">Other</option>
          </select>
        </label>

        <label>
          Severity
          <select name="severity" required>
            <option value="">Select severity</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        </label>

        <label>
          Notes
          <textarea name="notes" rows="4"></textarea>
        </label>

        <label>
  Inspection photos (optional)
  <input
    id="inspection-photo"
    name="photo"
    type="file"
    accept="image/*"
    multiple
  />
  <small>Maximum file size: 5 MB each</small>
</label>

        <p id="form-status" role="status"></p>

        <button class="submit-button" type="submit">Submit report</button>
      </form>
    </dialog>

    <dialog id="report-history-dialog">
      <div class="form-heading">
        <h2>Report history</h2>
        <button id="close-report-history" type="button">×</button>
      </div>
      <div id="report-history-list"><p>Loading reports…</p></div>
    </dialog>
  </div>
`;

const issueCategory = document.querySelector<HTMLSelectElement>(
  '[name="issueCategory"]',
)!;

const severity =
  document.querySelector<HTMLSelectElement>('[name="severity"]')!;

const normalSeverityOptions = `
  <option value="">Select severity</option>
  <option value="low">Low</option>
  <option value="medium">Medium</option>
  <option value="high">High</option>
  <option value="urgent">Urgent</option>
`;

issueCategory.addEventListener("change", () => {
  if (issueCategory.value === "no_issue") {
    severity.innerHTML =
      '<option value="not_applicable">Not applicable</option>';
  } else {
    severity.innerHTML = normalSeverityOptions;
    severity.value = "";
  }
});

const statusElement = document.querySelector<HTMLDivElement>("#map-status")!;

const inspectionDialog =
  document.querySelector<HTMLDialogElement>("#inspection-dialog")!;

const inspectionForm =
  document.querySelector<HTMLFormElement>("#inspection-form")!;

const inspectionPhoto =
  document.querySelector<HTMLInputElement>("#inspection-photo")!;

const selectedAssetName = document.querySelector<HTMLParagraphElement>(
  "#selected-asset-name",
)!;

const selectedAssetId =
  document.querySelector<HTMLInputElement>("#selected-asset-id")!;

const selectedAssetType = document.querySelector<HTMLInputElement>(
  "#selected-asset-type",
)!;

const selectedItemId =
  document.querySelector<HTMLInputElement>("#selected-item-id")!;

const selectedLocation =
  document.querySelector<HTMLInputElement>("#selected-location")!;

const inspectionDate =
  document.querySelector<HTMLInputElement>("#inspection-date")!;

// Tracks a report that was already created in CMS but whose publish/asset-update
// step failed, so a retry resumes instead of creating a duplicate report and
// re-uploading its photos. Cleared on full success, on cancel, and whenever a
// new inspection starts.
let pendingReportId: string | null = null;

document
  .querySelector<HTMLButtonElement>("#close-form")!
  .addEventListener("click", () => {
    pendingReportId = null;
    inspectionDialog.close();
  });

const formStatus =
  document.querySelector<HTMLParagraphElement>("#form-status")!;

const reportHistoryDialog = document.querySelector<HTMLDialogElement>(
  "#report-history-dialog",
)!;

const reportHistoryList = document.querySelector<HTMLDivElement>(
  "#report-history-list",
)!;

document
  .querySelector<HTMLButtonElement>("#close-report-history")!
  .addEventListener("click", () => reportHistoryDialog.close());

document
  .querySelector<HTMLButtonElement>("#open-report-history")!
  .addEventListener("click", async () => {
    reportHistoryDialog.showModal();
    reportHistoryList.innerHTML = "<p>Loading reports…</p>";

    try {
      const response = await fetch("/api/reports");

      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }

      const data = (await response.json()) as { reports: InspectionReport[] };

      if (data.reports.length === 0) {
        reportHistoryList.innerHTML = "<p>No reports submitted yet.</p>";
        return;
      }

      reportHistoryList.innerHTML = "";

      for (const report of data.reports) {
        const card = document.createElement("article");
        card.className = "report-card";

        const heading = document.createElement("h3");
        heading.textContent = `${report.assetId ?? "—"} · ${report.assetType ?? "—"}`;

        const inspectionDateLabel = report.inspectionDate
          ? report.inspectionDate.slice(0, 10)
          : "—";

        const meta = document.createElement("p");
        meta.textContent =
          `${inspectionDateLabel} · condition: ${report.condition ?? "—"} · ` +
          `issue: ${report.issueCategory ?? "—"} · severity: ${report.severity ?? "—"} · ` +
          `status: ${report.reportStatus ?? "—"}`;

        card.append(heading, meta);

        if (report.notes) {
          const notes = document.createElement("p");
          notes.textContent = report.notes;
          card.append(notes);
        }

        if (report.photos.length > 0) {
          const photos = document.createElement("div");
          photos.className = "report-photos";

          for (const url of report.photos) {
            const image = document.createElement("img");
            image.src = url;
            image.alt = `${report.assetId ?? "Inspection"} photo`;
            photos.append(image);
          }

          card.append(photos);
        }

        reportHistoryList.append(card);
      }
    } catch (error) {
      console.error(error);
      reportHistoryList.innerHTML =
        "<p>Unable to load report history.</p>";
    }
  });

const submitButton =
  document.querySelector<HTMLButtonElement>(".submit-button")!;

inspectionForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const formData = new FormData(inspectionForm);
  const value = (name: string) => String(formData.get(name) ?? "");

  const assetId = value("assetId");
  const condition = value("condition");
  const inspectionDateValue = value("inspectionDate");
  const itemId = value("itemId");

  submitButton.disabled = true;
  submitButton.textContent = "Submitting…";
  formStatus.textContent = "";

  try {
    let reportId = pendingReportId;

    // Skip straight to publish/update on a retry — the report already exists
    // in CMS (and its photos are already attached to it), so redoing this
    // would create a duplicate report and re-upload the photos a second time.
    if (!reportId) {
      const photos = inspectionPhoto.files ? Array.from(inspectionPhoto.files) : [];
      const photoIds: string[] = [];

      for (const [index, photo] of photos.entries()) {
        submitButton.textContent = `Uploading photo ${index + 1} of ${photos.length}…`;

        const uploadData = new FormData();
        uploadData.append("file", photo);

        const uploadResponse = await fetch("/api/assets/upload", {
          method: "POST",
          body: uploadData,
        });

        const uploadResult = await uploadResponse.json();

        if (!uploadResponse.ok) {
          throw new Error(
            uploadResult.error || "The inspection photo could not be uploaded",
          );
        }

        if (!uploadResult.id) {
          throw new Error("The uploaded photo returned no asset ID");
        }

        photoIds.push(uploadResult.id);
      }

      const payload = {
        assetId,
        assetType: value("assetType"),
        location: JSON.parse(value("location")),
        inspectionDate: inspectionDateValue,
        condition,
        issueCategory: value("issueCategory"),
        severity: value("severity"),
        notes: value("notes"),
        photoIds,
      };

      submitButton.textContent = "Submitting report…";
      const response = await fetch("/api/reports", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const result = await response.json();

      if (!response.ok) {
        const details =
          typeof result.details === "string"
            ? result.details
            : JSON.stringify(result.details ?? "");

        throw new Error(details || result.error || "Unable to create report");
      }

      if (!result.id) {
        throw new Error("CMS created the report but returned no item ID");
      }

      reportId = result.id;
      pendingReportId = reportId;
    }

    submitButton.textContent = "Publishing report…";
    const publishResponse = await fetch(`/api/reports/${reportId}/publish`, {
      method: "POST",
    });

    const publishResult = await publishResponse.json();

    if (!publishResponse.ok) {
      const details =
        typeof publishResult.details === "string"
          ? publishResult.details
          : JSON.stringify(publishResult.details ?? "");

      throw new Error(
        details || publishResult.error || "Unable to publish report",
      );
    }

    // Only update the asset once the report is actually published, so the
    // asset can never end up reflecting a report that isn't published yet.
    submitButton.textContent = "Updating asset…";
    const assetUpdateResponse = await fetch(`/api/assets/${itemId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        condition,
        inspectedAt: `${inspectionDateValue}T00:00:00+09:00`,
      }),
    });

    const assetUpdateResult = await assetUpdateResponse.json();

    if (!assetUpdateResponse.ok) {
      const details =
        typeof assetUpdateResult.details === "string"
          ? assetUpdateResult.details
          : JSON.stringify(assetUpdateResult.details ?? "");

      throw new Error(
        details ||
          assetUpdateResult.error ||
          "Report was published, but the asset could not be updated",
      );
    }

    pendingReportId = null;
    inspectionDialog.close();
    statusElement.textContent = `Report submitted and ${assetId} updated`;

    inspectionForm.reset();
  } catch (error) {
    formStatus.textContent =
      error instanceof Error ? error.message : "Unable to create report";

    formStatus.className = "form-error";
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Submit report";
  }
});

const map = new Map({
  container: "map",
  style: {
    version: 8,
    sources: {
      reearthPapers: {
        type: "raster",
        tiles: [
          "https://papers.reearth.land/styles/protomaps-light/tile/{z}/{x}/{y}.webp",
        ],
        tileSize: 512,
        attribution:
          '<a href="https://papers.reearth.land/attribution">Re:Earth Papers</a> · &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      },
    },
    layers: [
      {
        id: "reearthPapers",
        type: "raster",
        source: "reearthPapers",
      },
    ],
  },
  center: [138.3, 36.1],
  zoom: 8,
});

map.addControl(new NavigationControl(), "top-right");

map.on("load", async () => {
  try {
    const response = await fetch("/api/assets");

    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    const assets = (await response.json()) as AssetCollection;

    map.addSource("infrastructure-assets", {
      type: "geojson",
      data: assets,
    });

    map.addLayer({
      id: "infrastructure-assets",
      type: "circle",
      source: "infrastructure-assets",
      paint: {
        "circle-radius": 9,
        "circle-color": [
          "match",
          ["get", "assetType"],
          "manhole",
          "#2563eb",
          "streetlight",
          "#f59e0b",
          "traffic_sign",
          "#ef4444",
          "public_bench",
          "#16a34a",
          "#64748b",
        ],
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2,
      },
    });

    const bounds = new LngLatBounds();

    assets.features.forEach((feature) => {
      bounds.extend(feature.geometry.coordinates);
    });

    if (!bounds.isEmpty()) {
      map.fitBounds(bounds, {
        padding: 80,
        maxZoom: 12,
      });
    }

    map.on("mouseenter", "infrastructure-assets", () => {
      map.getCanvas().style.cursor = "pointer";
    });

    map.on("mouseleave", "infrastructure-assets", () => {
      map.getCanvas().style.cursor = "";
    });

    map.on("click", "infrastructure-assets", (event) => {
      const feature = event.features?.[0];

      if (!feature || feature.geometry.type !== "Point") {
        return;
      }

      const properties = feature.properties;

      const content = document.createElement("div");
      const name = document.createElement("strong");
      const details = document.createElement("p");

      name.textContent = properties.assetName;
      details.textContent = `${properties.assetId ?? "—"} · ${properties.currentCondition ?? "—"}`;
      content.append(name, details);

      if (properties.referencePhotoUrl) {
        const referencePhoto = document.createElement("img");
        referencePhoto.src = properties.referencePhotoUrl;
        referencePhoto.alt = `${properties.assetName ?? "Reference"} photo`;
        referencePhoto.className = "reference-photo";
        content.append(referencePhoto);
      }

      const inspectButton = document.createElement("button");

      inspectButton.type = "button";
      inspectButton.className = "inspect-button";
      inspectButton.textContent = "Start inspection";

      inspectButton.addEventListener("click", () => {
        pendingReportId = null;
        inspectionForm.reset();
        severity.innerHTML = normalSeverityOptions;
        formStatus.textContent = "";
        formStatus.className = "";
        selectedAssetName.textContent = `${properties.assetName ?? "—"} (${properties.assetId ?? "—"})`;

        selectedAssetId.value = properties.assetId ?? "";
        selectedAssetType.value = properties.assetType ?? "";
        selectedItemId.value = properties.itemId;
        selectedLocation.value = JSON.stringify(feature.geometry);
        inspectionDate.value = localDateString();

        inspectionDialog.showModal();
      });

      content.append(inspectButton);

      new Popup()
        .setLngLat(feature.geometry.coordinates)
        .setDOMContent(content)
        .addTo(map);
    });

    statusElement.textContent = `${assets.features.length} assets loaded`;
    statusElement.classList.add("success");
  } catch (error) {
    console.error(error);
    statusElement.textContent = "Unable to load assets";
    statusElement.classList.add("error");
  }
});
