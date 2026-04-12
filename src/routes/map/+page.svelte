<script>
	import { onMount } from 'svelte';
	import maplibregl from 'maplibre-gl';

	let map = $state(null);
	let isTracking = $state(true); // 現在地追従
	let isPathOn = $state(false); // 軌跡表示
	let wpInfo = $state(''); // WP距離・方位

	let watchId = $state(null);
	let marker = $state(null);
	let track = $state([]); // 配列もOK
	let trackLine = $state(null);

	let heading = $state(0);
	let lastLat = $state(null);
	let lastLng = $state(null);

	let waypoint = $state(null);
	let wpMarker = $state(null);
	let wpLineAdded = $state(false);

	// ★ 追加：進行方向モード（Heading-Up）
	let isHeadingUp = $state(false); // false = 北固定, true = 進行方向を上

	let windDir = $state(0); // 風向（度）
	let windTimer = null;
	let windTime = $state(0); // 前回取得のタイムスタンプ(ms)
	let windError = $state(true); // 風向取得エラー
	let windSpeed = $state(0); // ★ 風速（m/s）
	/* -----------------------------
     ▼ Wake Lock（スリープ防止）
  ------------------------------ */
	let wakeLock = $state(null);

	async function enableWakeLock() {
		try {
			wakeLock = await navigator.wakeLock.request('screen');
			console.log('Wake Lock enabled');

			wakeLock.addEventListener('release', () => {
				console.log('Wake Lock released by system');
			});
		} catch (err) {
			console.error('Wake Lock error:', err);
		}
	}

	function disableWakeLock() {
		if (wakeLock) {
			wakeLock.release();
			wakeLock = null;
			console.log('Wake Lock disabled');
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
		const toRad = (d) => (d * Math.PI) / 180;
		const dLat = toRad(lat2 - lat1);
		const dLon = toRad(lon2 - lon1);
		const a =
			Math.sin(dLat / 2) ** 2 +
			Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
		return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
	}

	function calcBearing(lat1, lon1, lat2, lon2) {
		const toRad = (d) => (d * Math.PI) / 180;
		const toDeg = (r) => (r * 180) / Math.PI;
		const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
		const x =
			Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
			Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
		return (toDeg(Math.atan2(y, x)) + 360) % 360;
	}

	function clearWaypoint() {
		waypoint = null;

		if (wpMarker) {
			wpMarker.remove();
			wpMarker = null;
		}

		if (wpLineAdded) {
			if (map.getLayer('wp-line-layer')) map.removeLayer('wp-line-layer');
			if (map.getSource('wp-line')) map.removeSource('wp-line');
			wpLineAdded = false;
		}

		wpInfo = '';
	}

	function clearTrack() {
		track = [];

		if (map.getSource('track')) {
			map.getSource('track').setData({
				type: 'Feature',
				geometry: { type: 'LineString', coordinates: [] }
			});
		}
	}

	onMount(() => {
		/* ▼ 地図画面に入った瞬間に Wake Lock ON */
		enableWakeLock();

		/* ▼ タブ復帰時に再取得（OS が勝手に解除する対策） */
		const handleVisibility = () => {
			if (document.visibilityState === 'visible' && wakeLock === null) {
				enableWakeLock();
			}
		};
		document.addEventListener('visibilitychange', handleVisibility);

		/* ▼ ページ離脱時に Wake Lock OFF */
		const cleanup = () => {
			document.removeEventListener('visibilitychange', handleVisibility);
			disableWakeLock();
			clearInterval(windTimer); // ← ★ タイマー停止
		};

		/* ---------------- 地図初期化 ---------------- */

		map = new maplibregl.Map({
			container: 'map',
			style: {
				version: 8,
				sources: {},
				layers: []
			},
			center: [139.767125, 35.681236],
			zoom: 14
		});

		map.on('load', () => {
			map.addSource('osm', {
				type: 'raster',
				tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
				tileSize: 256
			});

			map.addLayer({
				id: 'osm-layer',
				type: 'raster',
				source: 'osm'
			});

			map.addSource('seamap', {
				type: 'raster',
				tiles: ['https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png'],
				tileSize: 256
			});

			map.addLayer({
				id: 'seamap-layer',
				type: 'raster',
				source: 'seamap'
			});
		});

		/*------------WP 設定　クリック動作処理----Start-------*/
		let pressTimer = null;
		let longPressDuration = 600; // 長押し判定時間
		let startPos = null;
		let moved = false;
		let moveThreshold = 10; // px（これ以上動いたらドラッグと判定）

		// タッチ開始
		map.on('touchstart', (e) => {
			// ★ 指が1本でなければ長押しを無効化
			if (e.originalEvent.touches.length !== 1) {
				clearTimeout(pressTimer);
				return;
			}

			startPos = e.point;
			moved = false;

			pressTimer = setTimeout(() => {
				if (!moved) handleLongPress(e);
			}, longPressDuration);
		});

		// タッチ移動（ドラッグ判定）
		map.on('touchmove', (e) => {
			if (!startPos) return;

			const dx = e.point.x - startPos.x;
			const dy = e.point.y - startPos.y;

			if (Math.sqrt(dx * dx + dy * dy) > moveThreshold) {
				moved = true;
				clearTimeout(pressTimer);
			}
		});

		// タッチ終了
		map.on('touchend', () => {
			clearTimeout(pressTimer);
			startPos = null;
		});

		// --- PC マウス版（同じ仕組み） ---
		map.on('mousedown', (e) => {
			startPos = e.point;
			moved = false;

			pressTimer = setTimeout(() => {
				if (!moved) handleLongPress(e);
			}, longPressDuration);
		});

		map.on('mousemove', (e) => {
			if (!startPos) return;

			const dx = e.point.x - startPos.x;
			const dy = e.point.y - startPos.y;

			if (Math.sqrt(dx * dx + dy * dy) > moveThreshold) {
				moved = true;
				clearTimeout(pressTimer);
			}
		});

		map.on('mouseup', () => {
			clearTimeout(pressTimer);
			startPos = null;
		});
		/*------------WP 設定　クリック動作処理--End------------*/

		/*------------ 風向きの定期取得（300秒） ------------*/
		windTimer = setInterval(() => {
			if (lastLat != null && lastLng != null) {
				fetchWind();
			}
		}, 300000);

		/*------------ GPS 更新 ------------*/
		watchId = navigator.geolocation.watchPosition(
			(pos) => {
				const lat = pos.coords.latitude;
				const lng = pos.coords.longitude;

				/*--- ▼ 進行方向（heading）の計算 ---*/
				if (lastLat !== null && lastLng !== null) {
					const move = calcDistance(lastLat, lastLng, lat, lng);
					if (move > 0.3) {
						// ★ ここを 1 → 0.3 に変更
						heading = calcBearing(lastLat, lastLng, lat, lng);
					}
				}
				lastLat = lat;
				lastLng = lng;
				/*--- ▲--------------------------------*/

				/* ★ GPS 更新直後に風向きを取得（初回も確実に成功） */
				fetchWind();

				/*--- ▼ カカヤックアイコンの生成・更新 ---*/
				if (!marker) {
					marker = new maplibregl.Marker({
						element: createKayakIcon()
					})
						.setLngLat([lng, lat])
						.addTo(map);
				} else {
					marker.setLngLat([lng, lat]);
				}

				// heading に応じて回転
				const inner = marker.getElement().querySelector('.kayak-rot');
				if (inner) {
					inner.style.transform = `rotate(${heading}deg)`;
				}
				/******************/
				// ★ 追加：進行方向モードのときはカヤックを回転させない
				if (inner) {
					if (!isHeadingUp) {
						// 北固定モード → カヤックを heading に合わせて回転
						inner.style.transform = `rotate(${heading}deg)`;
					} else {
						// 進行方向モード → カヤックは常に上向き
						inner.style.transform = `rotate(0deg)`;
					}
				}
				// --- ★ 追加：地図の向き制御 ---
				if (isTracking) {
					if (isHeadingUp) {
						map.setBearing(heading); // 進行方向を上
					} else {
						map.setBearing(0); // 北を上
					}
				}

				/*--- ▼ 現在地追従（センタリング） ---*/
				if (isTracking) {
					map.setCenter([lng, lat]);
				}

				/*--- ▼ 軌跡（トラックライン）の更新 ---*/
				track.push([lng, lat]);
				updateTrackLine();

				/* ▼ 軌跡の表示/非表示 */
				if (map.getLayer('track-layer')) {
					map.setLayoutProperty('track-layer', 'visibility', isPathOn ? 'visible' : 'none'); // ★ pathVisible → isPathOn に統一
				}

				/*--- ▼ WP（ウェイポイント）情報の更新 ---*/
				if (waypoint) {
					const [wLat, wLng] = waypoint;

					const dist = calcDistance(lat, lng, wLat, wLng);
					const bearing = calcBearing(lat, lng, wLat, wLng);

					const distStr = dist >= 1000 ? `${(dist / 1000).toFixed(2)} km` : `${dist.toFixed(0)} m`;

					//					wpInfo = `距離: ${distStr} / 方位: ${bearing.toFixed(1)}°`;
					wpInfo = `距離: ${distStr} \n方位: ${bearing.toFixed(1)}°`;

					const lineData = {
						type: 'Feature',
						geometry: {
							type: 'LineString',
							coordinates: [
								[lng, lat],
								[wLng, wLat]
							]
						}
					};

					if (!wpLineAdded) {
						map.addSource('wp-line', {
							type: 'geojson',
							data: lineData
						});

						map.addLayer({
							id: 'wp-line-layer',
							type: 'line',
							source: 'wp-line',
							paint: {
								'line-color': 'blue',
								'line-width': 3
							}
						});

						wpLineAdded = true;
					} else {
						map.getSource('wp-line').setData(lineData);
					}
				}
			},
			console.warn,
			{ enableHighAccuracy: true }
		);

		return cleanup;
	});

	/**
	 * 地図の長押し位置をウェイポイント（WP）として設定し、
	 * WP マーカーの表示、現在地から WP までの距離・方位の計算、
	 * および現在地 → WP のライン描画を行う。
	 *
	 * 処理内容:
	 * - 長押しした地点の緯度経度を WP として保存
	 * - WP マーカー（緑色）を新規作成または移動
	 * - 現在地が取得済みの場合:
	 *     - 現在地 → WP の距離を計算（m / km）
	 *     - 現在地 → WP の方位角を計算（度）
	 *     - 距離・方位を wpInfo に反映
	 *     - GeoJSON LineString を生成し、WP ラインを描画または更新
	 * - 現在地が未取得の場合:
	 *     - 「WP 設定済み（現在位置未取得）」を wpInfo に設定
	 *
	 * 引数:
	 *   e : maplibre の long-press イベント（lngLat を含む）
	 */
	function handleLongPress(e) {
		const wLat = e.lngLat.lat;
		const wLng = e.lngLat.lng;

		waypoint = [wLat, wLng];

		if (!wpMarker) {
			wpMarker = new maplibregl.Marker({ color: 'green' }).setLngLat([wLng, wLat]).addTo(map);
		} else {
			wpMarker.setLngLat([wLng, wLat]);
		}

		if (marker) {
			const pos = marker.getLngLat();
			const lat = pos.lat;
			const lng = pos.lng;

			const dist = calcDistance(lat, lng, wLat, wLng);
			const bearing = calcBearing(lat, lng, wLat, wLng);

			const distStr = dist >= 1000 ? `${(dist / 1000).toFixed(2)} km` : `${dist.toFixed(0)} m`;

			wpInfo = `距離: ${distStr}\n方位: ${bearing.toFixed(1)}°`;

			const lineData = {
				type: 'Feature',
				geometry: {
					type: 'LineString',
					coordinates: [
						[lng, lat],
						[wLng, wLat]
					]
				}
			};

			if (!wpLineAdded) {
				map.addSource('wp-line', {
					type: 'geojson',
					data: lineData
				});

				map.addLayer({
					id: 'wp-line-layer',
					type: 'line',
					source: 'wp-line',
					paint: {
						'line-color': 'blue',
						'line-width': 3
					}
				});

				wpLineAdded = true;
			} else {
				map.getSource('wp-line').setData(lineData);
			}
		} else {
			wpInfo = 'WP 設定済み（現在位置未取得）';
		}
	}

	/**
	 * カヤック用のマーカー画像（SVG）を内包した DOM 要素を生成して返す。
	 *
	 * 役割:
	 * - 外側コンテナ（div）を 75×75px で作成
	 * - 内側にカヤック画像（img）を配置し、クラス名 'kayak-rot' を付与
	 * - カヤック画像は中心を基準に回転できるよう transform-origin を設定
	 * - MapLibre の Marker に渡せる HTML 要素として完成させて返す
	 *
	 * 戻り値:
	 *   HTMLElement（MapLibre Marker の element として使用）
	 */
	function createKayakIcon() {
		const outer = document.createElement('div');
		outer.style.width = '75px';
		outer.style.height = '75px';

		const inner = document.createElement('img');
		inner.className = 'kayak-rot';
		inner.src = kayakSvg;
		inner.style.width = '75px';
		inner.style.height = '75px';
		inner.style.transformOrigin = 'center center';

		outer.appendChild(inner);
		return outer;
	}

	/**
	 * 現在までに蓄積された軌跡データ（track 配列）をもとに、
	 * 地図上の軌跡ライン（track-layer）を新規作成または更新する。
	 *
	 * 主な処理内容:
	 * - 初回呼び出し時:
	 *     - GeoJSON Source「track」を追加し、LineString として軌跡を登録
	 *     - 赤色・太さ 3px のラインレイヤー「track-layer」を追加
	 *     - trackLine フラグを true にして「軌跡レイヤーが存在する」状態にする
	 *
	 * - 2回目以降:
	 *     - 既存の GeoJSON Source「track」に対して setData() を実行し、
	 *       最新の軌跡（track 配列）に更新する
	 *
	 * 前提:
	 * - track は [lng, lat] の配列を連ねた LineString 用の座標配列
	 * - map は MapLibre GL JS のインスタンス
	 * - trackLine は「軌跡レイヤーが既に追加済みか」を示すフラグ
	 */
	function updateTrackLine() {
		if (!trackLine) {
			map.addSource('track', {
				type: 'geojson',
				data: {
					type: 'Feature',
					geometry: { type: 'LineString', coordinates: track }
				}
			});
			map.addLayer({
				id: 'track-layer',
				type: 'line',
				source: 'track',
				paint: { 'line-color': 'red', 'line-width': 3 }
			});
			trackLine = true;
		} else {
			map.getSource('track').setData({
				type: 'Feature',
				geometry: { type: 'LineString', coordinates: track }
			});
		}
	}
	/*--- 風向きアイコン風速で色分け ---*/
	function windColor(speed) {
		if (speed < 1) return '#999999';
		if (speed < 4) return '#4da3ff';
		if (speed < 7) return '#3cb371';
		if (speed < 10) return '#ffa500';
		if (speed < 20) return '#ff4500';
		return '#8000ff';
	}

	/**
	 * 風向データを Open‑Meteo API から取得し、キャッシュを考慮して
	 * 必要な場合のみ API を呼び出して windDir を更新する。
	 *
	 * 主な処理内容:
	 * - 前回取得時刻 windTime を確認し、30分以内なら API を呼ばず終了
	 * - API 取得成功時:
	 *     - windDir（風向）を更新
	 *     - windTime を現在時刻に更新
	 *     - windError を false に設定
	 * - API 取得失敗またはデータ欠落時:
	 *     - windError を true に設定し、×アイコン表示へ切り替えるための状態を反映
	 *
	 * キャッシュ仕様:
	 * - 有効期間は「前回取得から 30 分」
	 * - 30 分以内は API を呼ばず、前回の windDir をそのまま使用
	 *
	 * 注意:
	 * - lastLat / lastLng が未設定の場合は API URL が成立しないため、
	 *   呼び出し側で位置情報がある状態で実行することを前提とする
	 */
	async function fetchWind() {
		console.log('fetchWind() START');
		if (lastLat == null || lastLng == null) {
			console.log('→ GPS 未取得のため windError = true');
			windError = true;
			return;
		}

		const now = Date.now();
		const CACHE_DURATION = 30 * 60 * 1000;

		// キャッシュが有効なら API を呼ばない
		if (windTime && now - windTime < CACHE_DURATION) {
			console.log('→ キャッシュ有効のため API 呼び出しスキップ');
			return;
		}

		try {
			// ★ 風向と風速を両方取得するように変更
			const url = `https://api.open-meteo.com/v1/forecast?latitude=${lastLat}&longitude=${lastLng}&current=wind_direction_10m,wind_speed_10m`;
			const res = await fetch(url);
			const data = await res.json();

			// ★ 風向が取得できた場合
			if (data?.current?.wind_direction_10m !== undefined) {
				windDir = data.current.wind_direction_10m;
				windTime = now;
				windError = false;
			} else {
				windError = true;
			}

			// ★ 風速が取得できた場合（新規追加）
			if (data?.current?.wind_speed_10m !== undefined) {
				windSpeed = data.current.wind_speed_10m;
				console.log('→ windSpeed 更新成功:', windSpeed);
			}
		} catch (e) {
			console.error('Wind fetch error:', e);
			windError = true;
		}
	}
</script>

<div id="map"></div>

<div class="overlay bottom-right-2">
	<label class="switch">
		<input type="checkbox" bind:checked={isTracking} />
		<span class="slider"></span>
	</label>
	<span style="margin-left:8px;">現在地</span>
</div>

<div class="overlay bottom-right">
	<button
		onclick={clearWaypoint}
		style="background: {waypoint ? '#0078d4' : '#888'}; color: white;"
	>
		WPクリア
	</button>
</div>

<div class="overlay top-right">
	{wpInfo}
</div>

<div class="overlay bottom-left-2">
	<label class="switch">
		<input type="checkbox" bind:checked={isPathOn} />
		<span class="slider"></span>
	</label>
	<span style="margin-left:8px;">軌跡表示</span>
</div>

<div class="overlay bottom-left-3">
	<button onclick={clearTrack} style="background:#888; color:white;"> 軌跡クリア </button>
</div>

<div class="overlay top-left">
	<label class="switch">
		<input type="checkbox" bind:checked={isHeadingUp} />
		<span class="slider"></span>
	</label>
	<span style="margin-left:8px;">進行方向</span>
</div>

{#if isTracking}
	<div class="overlay top-right-wind">
		{#if windError}
			<img src="/x-icon.svg" alt="wind" class="wind-icon" />
		{:else}
			<svg
				width="60"
				height="60"
				viewBox="0 0 100 100"
				xmlns="http://www.w3.org/2000/svg"
				style="
          color: {windSpeed !== undefined ? windColor(windSpeed) : '#4da6ff'};
          transform: rotate(
            {!isHeadingUp ? windDir + 180 : windDir - heading + 180}deg
          );
          transform-origin: center;
        "
			>
				<circle cx="50" cy="50" r="45" fill="none" stroke="currentColor" stroke-width="4" />
				<polygon
					points="50,15 65,45 55,45 55,80 45,80 45,45 35,45"
					fill="currentColor"
					stroke="currentColor"
					stroke-width="3"
				/>
			</svg>
		{/if}
	</div>
{/if}

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
		font-size: 20px;
		white-space: pre-line;
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
		transition: 0.3s;
	}

	.slider:before {
		position: absolute;
		content: '';
		height: 22px;
		width: 22px;
		left: 3px;
		bottom: 3px;
		background-color: white;
		border-radius: 50%;
		transition: 0.3s;
	}

	input:checked + .slider {
		background-color: #0078d4;
	}

	input:checked + .slider:before {
		transform: translateX(22px);
	}

	.top-right-wind {
		position: absolute;
		top: 80px;
		right: 10px;
		background: rgba(255, 255, 255, 0);
		padding: 6px;
		border-radius: 6px;
		z-index: 1000;
	}

	.wind-icon {
		width: 60px;
		height: 60px;
		transform-origin: center center;
	}
</style>
