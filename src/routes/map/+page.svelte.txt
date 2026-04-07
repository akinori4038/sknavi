<script>
  import { onMount } from "svelte";
  import { writable } from "svelte/store";
  import maplibregl from "maplibre-gl";

  let map;

  const isTracking = writable(true);   // センタリング（画面ロック）
  const isPathOn = writable(false);    // 軌跡表示ON/OFF
  const wpInfo = writable("");         // WP距離・方位

  let trackingValue = true;
  isTracking.subscribe(v => trackingValue = v);

  let pathVisible = false;
  isPathOn.subscribe(v => pathVisible = v);

  let watchId;
  let marker = null;
  let track = [];
  let trackLine = null;

  let heading = 0;
  let lastLat = null;
  let lastLng = null;

  let waypoint = null;
  let wpMarker = null;
  let wpLineAdded = false;

  /* -----------------------------
     ▼ Wake Lock（スリープ防止）
  ------------------------------ */
  let wakeLock = null;

  async function enableWakeLock() {
    try {
      wakeLock = await navigator.wakeLock.request("screen");
      console.log("Wake Lock enabled");

      wakeLock.addEventListener("release", () => {
        console.log("Wake Lock released by system");
      });
    } catch (err) {
      console.error("Wake Lock error:", err);
    }
  }

  function disableWakeLock() {
    if (wakeLock) {
      wakeLock.release();
      wakeLock = null;
      console.log("Wake Lock disabled");
    }
  }

  /* ----------------------------- */

  const kayakSvg = `data:image/svg+xml;utf8,${encodeURIComponent(`
    <svg width="60" height="60" viewBox="0 0 100 100"
    xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="kayakBody" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#4de0d8"/>
          <stop offset="50%" stop-color="#1fb5ad"/>
          <stop offset="100%" stop-color="#0e7f79"/>
        </linearGradient>
        <linearGradient id="cockpitGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#777"/>
          <stop offset="100%" stop-color="#222"/>
        </linearGradient>
      </defs>

      <path d="M50 3 C56 22, 60 40, 60 50 C60 60, 56 78, 50 97 C44 78, 40 60, 40 50 C40 40, 44 22, 50 3 Z"
            fill="url(#kayakBody)" stroke="#0a5f5a" stroke-width="3"/>

      <ellipse cx="50" cy="50" rx="5" ry="12"
               fill="url(#cockpitGrad)" stroke="#000" stroke-width="3"/>
    </svg>
  `)}`;

  function calcDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = d => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function calcBearing(lat1, lon1, lat2, lon2) {
    const toRad = d => d * Math.PI / 180;
    const toDeg = r => r * 180 / Math.PI;
    const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
    const x =
      Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
      Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) *
      Math.cos(toRad(lon2 - lon1));
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  }

  function clearWaypoint() {
    waypoint = null;

    if (wpMarker) {
      wpMarker.remove();
      wpMarker = null;
    }

    if (wpLineAdded) {
      if (map.getLayer("wp-line-layer")) map.removeLayer("wp-line-layer");
      if (map.getSource("wp-line")) map.removeSource("wp-line");
      wpLineAdded = false;
    }

    wpInfo.set("");
  }

  function clearTrack() {
    track = [];

    if (map.getSource("track")) {
      map.getSource("track").setData({
        type: "Feature",
        geometry: { type: "LineString", coordinates: [] }
      });
    }
  }

  onMount(() => {

    /* ▼ 地図画面に入った瞬間に Wake Lock ON */
    enableWakeLock();

    /* ▼ タブ復帰時に再取得（OS が勝手に解除する対策） */
    const handleVisibility = () => {
      if (document.visibilityState === "visible" && wakeLock === null) {
        enableWakeLock();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    /* ▼ ページ離脱時に Wake Lock OFF */
    const cleanup = () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      disableWakeLock();
    };

    /* ---------------- 地図初期化 ---------------- */

    map = new maplibregl.Map({
      container: "map",
      style: {
        version: 8,
        sources: {},
        layers: []
      },
      center: [139.767125, 35.681236],
      zoom: 14
    });

    map.on("load", () => {
      map.addSource("osm", {
        type: "raster",
        tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
        tileSize: 256
      });

      map.addLayer({
        id: "osm-layer",
        type: "raster",
        source: "osm"
      });

      map.addSource("seamap", {
        type: "raster",
        tiles: ["https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png"],
        tileSize: 256
      });

      map.addLayer({
        id: "seamap-layer",
        type: "raster",
        source: "seamap"
      });
    });

    map.on("click", (e) => {
      const wLat = e.lngLat.lat;
      const wLng = e.lngLat.lng;

      waypoint = [wLat, wLng];

      if (!wpMarker) {
        wpMarker = new maplibregl.Marker({ color: "green" })
          .setLngLat([wLng, wLat])
          .addTo(map);
      } else {
        wpMarker.setLngLat([wLng, wLat]);
      }

      if (marker) {
        const pos = marker.getLngLat();
        const lat = pos.lat;
        const lng = pos.lng;

        const dist = calcDistance(lat, lng, wLat, wLng);
        const bearing = calcBearing(lat, lng, wLat, wLng);

        const distStr = dist >= 1000
          ? `${(dist / 1000).toFixed(2)} km`
          : `${dist.toFixed(0)} m`;

        wpInfo.set(`距離: ${distStr} / 方位: ${bearing.toFixed(1)}°`);

        const lineData = {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [lng, lat],
              [wLng, wLat]
            ]
          }
        };

        if (!wpLineAdded) {
          map.addSource("wp-line", {
            type: "geojson",
            data: lineData
          });

          map.addLayer({
            id: "wp-line-layer",
            type: "line",
            source: "wp-line",
            paint: {
              "line-color": "blue",
              "line-width": 3
            }
          });

          wpLineAdded = true;
        } else {
          map.getSource("wp-line").setData(lineData);
        }
      } else {
        wpInfo.set("WP 設定済み（現在位置未取得）");
      }
    });

    watchId = navigator.geolocation.watchPosition(pos => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;

      /* ▼ heading 計算（進行方向） */
      if (lastLat !== null && lastLng !== null) {
        const move = calcDistance(lastLat, lastLng, lat, lng);
        if (move > 0.3) {   // ★ ここを 1 → 0.3 に変更
          heading = calcBearing(lastLat, lastLng, lat, lng);
        }
      }
      lastLat = lat;
      lastLng = lng;

      /* ▼ カヤックアイコン更新 */
      if (!marker) {
        marker = new maplibregl.Marker({
          element: createKayakIcon()
        }).setLngLat([lng, lat]).addTo(map);
      } else {
        marker.setLngLat([lng, lat]);
      }

      const inner = marker.getElement().querySelector(".kayak-rot");
      if (inner) {
        inner.style.transform = `rotate(${heading}deg)`;
      }

      /* ▼ センタリング */
      if (trackingValue) {
        map.setCenter([lng, lat]);
      }

      /* ▼ 軌跡 */
      track.push([lng, lat]);
      updateTrackLine();

      if (map.getLayer("track-layer")) {
        map.setLayoutProperty(
          "track-layer",
          "visibility",
          pathVisible ? "visible" : "none"
        );
      }

      /* ▼ WP 更新 */
      if (waypoint) {
        const [wLat, wLng] = waypoint;

        const dist = calcDistance(lat, lng, wLat, wLng);
        const bearing = calcBearing(lat, lng, wLat, wLng);

        const distStr = dist >= 1000
          ? `${(dist / 1000).toFixed(2)} km`
          : `${dist.toFixed(0)} m`;

        wpInfo.set(`距離: ${distStr} / 方位: ${bearing.toFixed(1)}°`);

        const lineData = {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [lng, lat],
              [wLng, wLat]
            ]
          }
        };

        if (!wpLineAdded) {
          map.addSource("wp-line", {
            type: "geojson",
            data: lineData
          });

          map.addLayer({
            id: "wp-line-layer",
            type: "line",
            source: "wp-line",
            paint: {
              "line-color": "blue",
              "line-width": 3
            }
          });

          wpLineAdded = true;
        } else {
          map.getSource("wp-line").setData(lineData);
        }
      }
    }, console.warn, { enableHighAccuracy: true });

    return cleanup;
  });

  function createKayakIcon() {
    const outer = document.createElement("div");
    outer.style.width = "75px";
    outer.style.height = "75px";

    const inner = document.createElement("img");
    inner.className = "kayak-rot";
    inner.src = kayakSvg;
    inner.style.width = "75px";
    inner.style.height = "75px";
    inner.style.transformOrigin = "center center";

    outer.appendChild(inner);
    return outer;
  }

  function updateTrackLine() {
    if (!trackLine) {
      map.addSource("track", {
        type: "geojson",
        data: {
          type: "Feature",
          geometry: { type: "LineString", coordinates: track }
        }
      });
      map.addLayer({
        id: "track-layer",
        type: "line",
        source: "track",
        paint: { "line-color": "red", "line-width": 3 }
      });
      trackLine = true;
    } else {
      map.getSource("track").setData({
        type: "Feature",
        geometry: { type: "LineString", coordinates: track }
      });
    }
  }
</script>

<style>
  #map {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
  }

  .overlay {
    position: absolute;
    background: rgba(255, 255, 255, 0.8);
    padding: 6px 10px;
    border-radius: 6px;
    z-index: 1000;
    font-size: 14px;
  }

  .bottom-right {
    bottom: 10px;
    right: 10px;
  }

  .bottom-right-2 {
    bottom: 60px;
    right: 10px;
  }

  .bottom-left-2 {
    bottom: 60px;
    left: 10px;
  }

  .bottom-left-3 {
    bottom: 10px;
    left: 10px;
  }

  .top-right {
    top: 10px;
    right: 10px;
  }

  .switch {
    position: relative;
    display: inline-block;
    width: 50px;
    height: 28px;
  }

  .switch input {
    opacity: 0;
    width: 0;
    height: 0;
  }

  .slider {
    position: absolute;
    cursor: pointer;
    background-color: #888;
    border-radius: 34px;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    transition: .3s;
  }

  .slider:before {
    position: absolute;
    content: "";
    height: 22px;
    width: 22px;
    left: 3px;
    bottom: 3px;
    background-color: white;
    border-radius: 50%;
    transition: .3s;
  }

  input:checked + .slider {
    background-color: #0078d4;
  }

  input:checked + .slider:before {
    transform: translateX(22px);
  }
</style>

<div id="map"></div>

<div class="overlay bottom-right-2">
  <label class="switch">
    <input type="checkbox" bind:checked={$isTracking}>
    <span class="slider"></span>
  </label>
  <span style="margin-left:8px;">センタリング</span>
</div>

<div class="overlay bottom-right">
  <button
    on:click={clearWaypoint}
    style="background: {waypoint ? '#0078d4' : '#888'}; color: white;"
  >
    WPクリア
  </button>
</div>

<div class="overlay top-right">
  {$wpInfo}
</div>

<div class="overlay bottom-left-2">
  <label class="switch">
    <input type="checkbox" bind:checked={$isPathOn}>
    <span class="slider"></span>
  </label>
  <span style="margin-left:8px;">軌跡表示</span>
</div>

<div class="overlay bottom-left-3">
  <button on:click={clearTrack} style="background:#888; color:white;">
    軌跡クリア
  </button>
</div>