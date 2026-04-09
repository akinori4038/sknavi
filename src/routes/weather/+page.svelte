<script>
	import { onMount } from 'svelte';

	let loading = $state(true);
	let error = $state(null);

	let lat = $state(null);
	let lon = $state(null);

	let times = $state([]);

	let temp = $state([]);
	let wind = $state([]);
	let windDir = $state([]);
	let weathercode = $state([]);
	let precipitation = $state([]);

	let waveHeight = $state([]);
	let swellHeight = $state([]);
	let swellDir = $state([]);
	let swellPeriod = $state([]);
	let seaTemp = $state([]);

	let highlightIndex = $state(null);

	function splitDateTime(t) {
		const d = new Date(t);
		const MM = String(d.getMonth() + 1).padStart(2, '0');
		const DD = String(d.getDate()).padStart(2, '0');
		const hh = String(d.getHours()).padStart(2, '0');
		const mm = String(d.getMinutes()).padStart(2, '0');
		return { date: `${MM}/${DD}`, time: `${hh}:${mm}` };
	}

	function isDateBoundary(i) {
		if (i === 0) return true;
		const prev = splitDateTime(times[i - 1]).date;
		const curr = splitDateTime(times[i]).date;
		return prev !== curr;
	}

	function weatherIcon(code) {
		if (code === 0) return '☀️';
		if (code === 1 || code === 2) return '🌤';
		if (code === 3) return '☁️';
		if (code === 45 || code === 48) return '🌫';
		if (code >= 51 && code <= 67) return '🌧';
		if (code >= 71 && code <= 77) return '❄️';
		if (code >= 80 && code <= 82) return '🌧';
		if (code >= 95 && code <= 99) return '⛈';
		return '❓';
	}

	function windDownwindDeg(deg) {
		return (deg + 180) % 360;
	}

	function windColor(speed) {
		if (speed < 1) return '#999999';
		if (speed < 4) return '#4da3ff';
		if (speed < 7) return '#3cb371';
		if (speed < 10) return '#ffa500';
		if (speed < 20) return '#ff4500';
		return '#8000ff';
	}

	function rainBgColor(mm) {
		if (mm <= 0) return '#ffffff';
		if (mm < 1) return '#e8f4ff';
		if (mm < 3) return '#cce8ff';
		if (mm < 10) return '#99d0ff';
		if (mm < 20) return '#66b8ff';
		if (mm < 30) return '#339fff';
		if (mm < 50) return '#0077ff';
		return '#004c99';
	}

	onMount(() => {
		let responded = false;

		try {
			navigator.geolocation.getCurrentPosition(
				(pos) => {
					responded = true;
					lat = pos.coords.latitude;
					lon = pos.coords.longitude;
					loadAll();
				},
				(err) => {
					responded = true;
					lat = 35.4437;
					lon = 139.638;
					loadAll();
				}
			);

			setTimeout(() => {
				if (!responded) {
					lat = 35.4437;
					lon = 139.638;
					loadAll();
				}
			}, 1000);
		} catch (e) {
			lat = 35.4437;
			lon = 139.638;
			loadAll();
		}
	});

	async function loadAll() {
		loading = true;
		error = null;

		try {
			await Promise.all([loadWeather(), loadMarine()]);
			calcHighlightIndex();
		} catch (e) {
			error = 'データ取得に失敗しました';
		}

		loading = false;
	}

	function calcHighlightIndex() {
		const now = Date.now();
		let minDiff = Infinity;
		let idx = 0;

		times.forEach((t, i) => {
			const diff = Math.abs(new Date(t).getTime() - now);
			if (diff < minDiff) {
				minDiff = diff;
				idx = i;
			}
		});

		highlightIndex = idx;
	}

	async function loadWeather() {
		const url =
			`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
			`&hourly=temperature_2m,wind_speed_10m,wind_direction_10m,weathercode,precipitation` +
			`&forecast_days=3&timezone=Asia/Tokyo`;

		let res = await fetch(url);
		let json = await res.json();

		times = json.hourly.time;
		temp = json.hourly.temperature_2m;
		wind = json.hourly.wind_speed_10m;
		windDir = json.hourly.wind_direction_10m;
		weathercode = json.hourly.weathercode;
		precipitation = json.hourly.precipitation;
	}

	async function loadMarine() {
		const url =
			`https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}` +
			`&hourly=wave_height,swell_wave_height,swell_wave_direction,swell_wave_period,sea_surface_temperature` +
			`&forecast_days=3&timezone=Asia/Tokyo`;

		let res = await fetch(url);
		let json = await res.json();

		waveHeight = json.hourly.wave_height;
		swellHeight = json.hourly.swell_wave_height;
		swellDir = json.hourly.swell_wave_direction;
		swellPeriod = json.hourly.swell_wave_period;
		seaTemp = json.hourly.sea_surface_temperature;
	}
</script>

<h2>3日間の天気・海況（1時間ごと）</h2>

{#if loading}
	<p>読み込み中…</p>
{:else if error}
	<p style="color:red">{error}</p>
{:else}
	<div class="table-wrapper">
		<table>
			<thead>
				<tr>
					<th>日時</th>

					{#each times as t, i}
						{@const dt = splitDateTime(t)}
						<th
							class="
                                datetime-header
                                {i === highlightIndex ? 'highlight-top' : ''}
                                {isDateBoundary(i) ? 'date-border' : ''}
                            "
						>
							<div>{dt.date}</div>
							<div>{dt.time}</div>
						</th>
					{/each}
				</tr>
			</thead>

			<tbody>
				<tr>
					<td>天気</td>
					{#each weathercode as v, i}
						<td
							class="{i === highlightIndex ? 'highlight-mid' : ''} {isDateBoundary(i)
								? 'date-border'
								: ''}"
						>
							<span class="weather-icon">{weatherIcon(v)}</span>
						</td>
					{/each}
				</tr>

				<tr>
					<td>
						<div>降水量</div>
						<div>(mm)</div>
					</td>
					{#each precipitation as v, i}
						<td
							class="{i === highlightIndex ? 'highlight-mid' : ''} {isDateBoundary(i)
								? 'date-border'
								: ''}"
							style="background:{rainBgColor(v)}"
						>
							{v.toFixed(1)}
						</td>
					{/each}
				</tr>

				<tr>
					<td>
						<div>気温</div>
						<div>(°C)</div>
					</td>
					{#each temp as v, i}
						<td
							class="{i === highlightIndex ? 'highlight-mid' : ''} {isDateBoundary(i)
								? 'date-border'
								: ''}"
						>
							{v.toFixed(1)}
						</td>
					{/each}
				</tr>

				<tr>
					<td>
						<div>風速</div>
						<div>(m/s)</div>
					</td>
					{#each wind as v, i}
						<td
							class="{i === highlightIndex ? 'highlight-mid' : ''} {isDateBoundary(i)
								? 'date-border'
								: ''}"
							style="color:{windColor(v)}"
						>
							{v.toFixed(1)}
						</td>
					{/each}
				</tr>

				<tr>
					<td>風向</td>
					{#each windDir as v, i}
						<td
							class="{i === highlightIndex ? 'highlight-mid' : ''} {isDateBoundary(i)
								? 'date-border'
								: ''}"
						>
							<div class="arrow-cell">
								<svg
									class="triangle-small"
									viewBox="0 0 24 24"
									style={`transform: rotate(${windDownwindDeg(v)}deg);`}
								>
									<polygon points="12,0 16,24 8,24" fill={windColor(wind[i])} />
								</svg>
							</div>
						</td>
					{/each}
				</tr>

				<tr>
					<td>
						<div>波高</div>
						<div>(m)</div>
					</td>
					{#each waveHeight as v, i}
						<td
							class="{i === highlightIndex ? 'highlight-mid' : ''} {isDateBoundary(i)
								? 'date-border'
								: ''}"
						>
							{v.toFixed(1)}
						</td>
					{/each}
				</tr>

				<tr>
					<td>
						<div>うねり高さ</div>
						<div>(m)</div>
					</td>
					{#each swellHeight as v, i}
						<td
							class="{i === highlightIndex ? 'highlight-mid' : ''} {isDateBoundary(i)
								? 'date-border'
								: ''}"
						>
							{v.toFixed(1)}
						</td>
					{/each}
				</tr>

				<!-- ★ うねり方向：反対方向（+180°）に変更 -->
				<tr>
					<td>うねり方向</td>
					{#each swellDir as v, i}
						<td
							class="{i === highlightIndex ? 'highlight-mid' : ''} {isDateBoundary(i)
								? 'date-border'
								: ''}"
						>
							<div class="arrow-cell">
								<svg
									class="triangle-small"
									viewBox="0 0 24 24"
									style={`transform: rotate(${(v + 180) % 360}deg);`}
								>
									<polygon points="12,0 16,24 8,24" fill="blue" />
								</svg>
							</div>
						</td>
					{/each}
				</tr>

				<tr>
					<td>
						<div>うねり周期</div>
						<div>(秒)</div>
					</td>
					{#each swellPeriod as v, i}
						<td
							class="{i === highlightIndex ? 'highlight-mid' : ''} {isDateBoundary(i)
								? 'date-border'
								: ''}"
						>
							{v.toFixed(1)}
						</td>
					{/each}
				</tr>

				<tr>
					<td>
						<div>海水温</div>
						<div>(°C)</div>
					</td>
					{#each seaTemp as v, i}
						<td
							class="{i === highlightIndex ? 'highlight-bottom' : ''} {isDateBoundary(i)
								? 'date-border'
								: ''}"
						>
							{v.toFixed(1)}
						</td>
					{/each}
				</tr>
			</tbody>
		</table>
	</div>
{/if}

<style>
	.table-wrapper {
		overflow-x: scroll;
		border: 1px solid #ccc;
	}

	table {
		border-collapse: collapse;
		min-width: 1400px;
	}

	th,
	td {
		border: 1px solid #ccc;
		padding: 4px 6px;
		white-space: nowrap;
		font-size: 14px;
		text-align: center;
	}

	th {
		position: sticky;
		top: 0;
		z-index: 10;
		background: #e8f4ff;
	}

	td:first-child,
	th:first-child {
		position: sticky;
		left: 0;
		background: #e8f4ff;
		z-index: 20;
	}

	.datetime-header div {
		line-height: 1.2;
	}

	.weather-icon {
		font-size: 200%;
		line-height: 1;
	}

	.arrow-cell {
		display: flex;
		justify-content: center;
		align-items: center;
	}

	/* 三角形アイコン（底辺1/3 & 鋭角 & 27px） */
	.triangle-small {
		width: 27px;
		height: 27px;
		transition: transform 0.1s linear;
	}

	.highlight-top {
		border-top: 3px solid #ffd900 !important;
		border-left: 3px solid #ffd900 !important;
		border-right: 3px solid #ffd900 !important;
	}

	.highlight-mid {
		border-left: 3px solid #ffd900 !important;
		border-right: 3px solid #ffd900 !important;
	}

	.highlight-bottom {
		border-left: 3px solid #ffd900 !important;
		border-right: 3px solid #ffd900 !important;
		border-bottom: 3px solid #ffd900 !important;
	}

	.date-border {
		border-left: 3px solid #0077ff !important;
	}
</style>
