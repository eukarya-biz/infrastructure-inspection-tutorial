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
      assetId: string;
      assetName: string;
      assetType: string;
      currentCondition: string;
      lastInspectedAt: string | null;
    };
  }>;
};

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <div class="app-shell">
    <header>
      <div>
        <h1>Public Infrastructure Inspection Map</h1>
        <p>Select an infrastructure asset to begin an inspection.</p>
      </div>
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
            <option value="none">No issue</option>
            <option value="damage">Damage</option>
            <option value="obstruction">Obstruction</option>
            <option value="missing_component">Missing part</option>
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
  Inspection photo (optional)
  <input
    id="inspection-photo"
    name="photo"
    type="file"
    accept="image/*"
  />
  <small>Maximum file size: 5 MB</small>
</label>

        <p id="form-status" role="status"></p>

        <button class="submit-button" type="submit">Submit report</button>
      </form>
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
  if (issueCategory.value === "none") {
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

document
  .querySelector<HTMLButtonElement>("#close-form")!
  .addEventListener("click", () => inspectionDialog.close());

const formStatus =
  document.querySelector<HTMLParagraphElement>("#form-status")!;

const submitButton =
  document.querySelector<HTMLButtonElement>(".submit-button")!;

inspectionForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const formData = new FormData(inspectionForm);
  const value = (name: string) => String(formData.get(name) ?? "");

  const photoIds: string[] = [];

  const payload = {
    assetId: value("assetId"),
    assetType: value("assetType"),
    location: JSON.parse(value("location")),
    inspectionDate: value("inspectionDate"),
    condition: value("condition"),
    issueCategory: value("issueCategory"),
    severity: value("severity"),
    notes: value("notes"),
    photoIds,
  };

  submitButton.disabled = true;
  submitButton.textContent = "Submitting…";
  formStatus.textContent = "";

  try {
    const photo = inspectionPhoto.files?.[0];

    if (photo) {
      submitButton.textContent = "Uploading photo…";

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

      // Give CMS time to finish registering the uploaded asset.
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

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

    const publishResponse = await fetch(`/api/reports/${result.id}/publish`, {
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

    const assetUpdateResponse = await fetch(`/api/assets/${value("itemId")}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        condition: payload.condition,
        inspectedAt: `${payload.inspectionDate}T00:00:00+09:00`,
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

    inspectionDialog.close();
    statusElement.textContent = `Report submitted and ${payload.assetId} updated`;

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
      openStreetMap: {
        type: "raster",
        tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
        tileSize: 256,
        attribution: "© OpenStreetMap contributors",
      },
    },
    layers: [
      {
        id: "openStreetMap",
        type: "raster",
        source: "openStreetMap",
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
      details.textContent = `${properties.assetId} · ${properties.currentCondition}`;

      const inspectButton = document.createElement("button");

      inspectButton.type = "button";
      inspectButton.className = "inspect-button";
      inspectButton.textContent = "Start inspection";

      inspectButton.addEventListener("click", () => {
        inspectionForm.reset();
        severity.innerHTML = normalSeverityOptions;
        formStatus.textContent = "";
        formStatus.className = "";
        selectedAssetName.textContent = `${properties.assetName} (${properties.assetId})`;

        selectedAssetId.value = properties.assetId;
        selectedAssetType.value = properties.assetType;
        selectedItemId.value = properties.itemId;
        selectedLocation.value = JSON.stringify(feature.geometry);
        inspectionDate.value = new Date().toISOString().slice(0, 10);

        inspectionDialog.showModal();
      });

      content.append(name, details, inspectButton);

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
