// Global Map Variables
let map;
let kecamatanLayer;
let pemukimanLayer;
let facilitiesLayerGroup = L.markerClusterGroup({
    spiderfyOnMaxZoom: true,
    showCoverageOnHover: false,
    zoomToBoundsOnClick: true,
    maxClusterRadius: 50 // optional tweak for tighter clustering
});
let bufferLayerGroup = L.layerGroup();
let underservedLayerGroup = L.layerGroup();
let isochroneLinesGroup = L.layerGroup();

// Data Storage
let kecamatanData = null;
let pemukimanData = null;
let facilitiesData = {}; // key: name, value: { layer, geojson, config, visible }
let populationData = {};
let pemukimanAreaKec = {}; // To store actual calculated residential area in km2 per kecamatan

const API_PATH = 'APP/DATA/';
const SPEED_KMH = 30; // Average urban speed
const DETOUR_INDEX = 1.3; // To simulate road network distance from straight line

const facilityConfig = [
    { file: '00_Bank_Sampah_Induk.geojson', name: 'Bank Sampah Induk', color: '#16a34a', icon: 'fa-building' },
    { file: '01_Bank_Sampah.geojson', name: 'Bank Sampah', color: '#22c55e', icon: 'fa-recycle' },
    { file: '02_TPS3R_atau_UPS.geojson', name: 'TPS3R / UPS', color: '#eab308', icon: 'fa-truck-fast' },
    { file: '03_TPA_atau_TPST.geojson', name: 'TPA / TPST', color: '#ef4444', icon: 'fa-dumpster' },
    { file: '04_Komposting_Skala_RTRW.geojson', name: 'Unit Komposting Skala RT/RW', color: '#84cc16', icon: 'fa-leaf' },
    { file: '05_Rumah_Kompos.geojson', name: 'Rumah Kompos', color: '#a3e635', icon: 'fa-house' },
    { file: '06_Biodigester.geojson', name: 'Biodigester', color: '#06b6d4', icon: 'fa-flask' },
    { file: '07_Pengelolaan_Sampah_Sektor_Informal_2022.geojson', name: 'Fasilitas Lain (Sektor Informal)', color: '#8b5cf6', icon: 'fa-users' }
];

document.addEventListener("DOMContentLoaded", initMap);

function initMap() {
    map = L.map('map', { zoomControl: false }).setView([-2.976, 104.775], 12);
    L.control.zoom({ position: 'topright' }).addTo(map);

    const googleSat = L.tileLayer('https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', { maxZoom: 20, attribution: '© Google' });
    const googleHybrid = L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', { maxZoom: 20, attribution: '© Google' });
    
    const esriWorldImagery = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { 
        maxZoom: 20, 
        maxNativeZoom: 19,
        attribution: 'Tiles &copy; Esri' 
    });
    
    const openStreetMap = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 20,
        maxNativeZoom: 19,
        attribution: '&copy; OpenStreetMap'
    });
    
    googleSat.addTo(map); // Default basemap

    const baseMaps = {
        "Google Satellite": googleSat, 
        "Google Hybrid": googleHybrid, 
        "Esri World Imagery": esriWorldImagery,
        "OpenStreetMap": openStreetMap
    };

    L.control.layers(baseMaps, {}, { position: 'topright' }).addTo(map);

    facilitiesLayerGroup.addTo(map);
    bufferLayerGroup.addTo(map);
    underservedLayerGroup.addTo(map);
    isochroneLinesGroup.addTo(map);

    // Toggle facility labels class based on zoom level (approx > 1:10000 is zoom 15/16)
    map.on('zoomend', function() {
        if (map.getZoom() >= 16) {
            document.getElementById('map').classList.add('show-facility-labels');
        } else {
            document.getElementById('map').classList.remove('show-facility-labels');
        }
    });

    // Map click to clear highlight
    map.on('click', function(e) {
        if (highlightedKecamatan) {
            kecamatanLayer.resetStyle(highlightedKecamatan);
            highlightedKecamatan = null;
        }
    });

    // Create custom panes for z-index ordering (400 is leaflet overlayPane)
    map.createPane('kecamatanPane');
    map.getPane('kecamatanPane').style.zIndex = 400; // Bottom layer
    map.createPane('pemukimanPane');
    map.getPane('pemukimanPane').style.zIndex = 405; // Above kecamatan

    loadPopulationData().then(async () => {
        await loadPemukimanData(); 
        await loadKecamatanData();
        await loadFacilitiesData();
    });

    setupEvents();
}

async function loadPopulationData() {
    try {
        const response = await fetch(API_PATH + 'Data_Jumlah_Penduduk_Per_Kecamatan_Palembang_2025.csv');
        const csvText = await response.text();
        const lines = csvText.split('\n');
        for (let i = 1; i < lines.length; i++) {
            if (!lines[i].trim()) continue;
            const cols = lines[i].split(',');
            if (cols.length >= 2) {
                populationData[cols[0].trim().toUpperCase()] = { pop: parseInt(cols[1]), growth: parseFloat(cols[2] || 0) };
            }
        }
    } catch (e) { console.error("Pop data error", e); }
}

let highlightedKecamatan = null;

async function loadKecamatanData() {
    try {
        const response = await fetch(API_PATH + 'BASE_Adm_Kec_Palembang.geojson');
        kecamatanData = await response.json();
        kecamatanLayer = L.geoJSON(kecamatanData, {
            style: { color: '#ffffff', weight: 2.5, fillColor: '#334155', fillOpacity: 0.2, dashArray: '4' },
            onEachFeature: (feature, layer) => {
                const kecName = feature.properties.NAMOBJ;
                const popData = populationData[(kecName || "").toUpperCase()];
                let pop = 0; let kepadatan = 0;
                let areaKm2 = turf.area(feature) / 1000000;
                
                if(popData) {
                    pop = popData.pop;
                    kepadatan = Math.round(pop / areaKm2);
                }
                
                // Perkiraan area pemukiman dari data Google Building Footprint
                let estimasiAreaPemukiman = pemukimanAreaKec[kecName.toUpperCase()] || 0;
                estimasiAreaPemukiman = estimasiAreaPemukiman.toFixed(2);
                
                // Estimasi produksi sampah: 0.7 kg / jiwa / hari
                let estimasiSampahTon = (pop * 0.7 / 1000).toFixed(2);
                
                layer.bindPopup(`
                    <div class="p-2 min-w-[220px]">
                        <h3 class="font-bold text-emerald-800 text-sm border-b pb-1 mb-2">Kec. ${kecName}</h3>
                        <table class="w-full text-[11px] text-gray-700">
                            <tr><td class="py-1">Populasi (2025):</td><td class="font-semibold text-right">${pop.toLocaleString('id-ID')} jiwa</td></tr>
                            <tr><td class="py-1 border-t">Luas Area Pemukiman:</td><td class="font-semibold text-right border-t">${estimasiAreaPemukiman} km²</td></tr>
                            <tr><td class="py-1 border-t">Estimasi Produksi Sampah:</td><td class="font-semibold text-right border-t">${estimasiSampahTon} Ton/hari</td></tr>
                        </table>
                    </div>
                `);
                
                layer.on('click', (e) => {
                    L.DomEvent.stopPropagation(e.originalEvent); // Prevent map click
                    
                    if (highlightedKecamatan === layer) {
                        // Jika di-klik lagi, reset highlight dan tutup popup
                        kecamatanLayer.resetStyle(layer);
                        highlightedKecamatan = null;
                        layer.closePopup();
                        return;
                    }

                    if (highlightedKecamatan) {
                        kecamatanLayer.resetStyle(highlightedKecamatan);
                    }
                    highlightedKecamatan = layer;
                    layer.setStyle({
                        weight: 3.5,
                        color: '#facc15',
                        dashArray: '',
                        fillOpacity: Math.min(1, (parseFloat(document.getElementById('kec-opacity').value) || 30) / 100 + 0.3)
                    });
                    layer.bringToFront();
                    layer.openPopup();
                });

                const select = document.getElementById('kecamatan-select');
                const option = document.createElement('option');
                option.value = kecName; option.textContent = kecName;
                select.appendChild(option);
            }
        }).addTo(map);

        const controlsContainer = document.getElementById('kecamatan-control-container');
        if(controlsContainer) {
            controlsContainer.innerHTML = `
                <div class="mb-2">
                    <label class="flex items-center space-x-2 cursor-pointer hover:bg-gray-100 p-1 rounded">
                        <input type="checkbox" id="chk-kec" checked class="rounded text-emerald-600 focus:ring-emerald-500 h-4 w-4" onchange="toggleKecamatan(this.checked)">
                        <span class="w-4 h-4 border-2 border-slate-700 bg-slate-400 inline-block opacity-70"></span>
                        <span class="text-gray-700 flex-1 font-medium">Batas Administrasi Kecamatan</span>
                    </label>
                    <div class="pl-6 pr-2 py-1 flex items-center space-x-2">
                        <span class="text-[10px] text-gray-500">Transparansi:</span>
                        <input type="range" id="kec-opacity" min="0" max="100" value="30" class="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer" oninput="changeKecamatanOpacity(this.value)">
                    </div>
                </div>
            `;
        }
    } catch (e) { console.error("Kecamatan data error", e); }
}

window.toggleKecamatan = function(isVisible) {
    if (kecamatanLayer) {
        if (isVisible) map.addLayer(kecamatanLayer);
        else map.removeLayer(kecamatanLayer);
    }
}

window.changeKecamatanOpacity = function(val) {
    if (kecamatanLayer) {
        kecamatanLayer.setStyle({ fillOpacity: val / 100 });
        // Re-apply highlight if exists
        if (highlightedKecamatan) {
            highlightedKecamatan.setStyle({ fillOpacity: Math.min(1, (val / 100) + 0.2) });
        }
    }
}

async function loadPemukimanData() {
    try {
        const response = await fetch(API_PATH + 'BASE_Area_Pemukiman_(Google_Building_Footprint_v3).geojson');
        pemukimanData = await response.json();
        
        // Calculate areas
        pemukimanData.features.forEach(f => {
            const kecName = (f.properties.NAMOBJ || "").toUpperCase();
            if (kecName) {
                pemukimanAreaKec[kecName] = turf.area(f) / 1000000;
            }
        });

        pemukimanLayer = L.geoJSON(pemukimanData, {
            pane: 'pemukimanPane',
            style: { color: '#f97316', weight: 0.5, fillColor: '#fdba74', fillOpacity: 0.5, interactive: false }
        });
        
        // By default, maybe don't add to map because it's heavy, or add it if requested?
        // User said: "layer area pemukiman berada diatas layer Batas Administrasi Kecamatan."
        pemukimanLayer.addTo(map);

        const container = document.getElementById('pemukiman-control-container');
        if(container) {
            container.innerHTML = `
                <div class="mb-2">
                    <label class="flex items-center space-x-2 cursor-pointer hover:bg-gray-100 p-1 rounded">
                        <input type="checkbox" id="chk-pemukiman" checked class="rounded text-emerald-600 focus:ring-emerald-500 h-4 w-4" onchange="togglePemukiman(this.checked)">
                        <span class="w-4 h-4 border border-orange-500 bg-orange-300 inline-block opacity-70"></span>
                        <span class="text-gray-700 flex-1 font-medium">Area Pemukiman</span>
                    </label>
                </div>
            `;
        }
    } catch (e) { console.error("Pemukiman data error", e); }
}

window.togglePemukiman = function(isVisible) {
    if (pemukimanLayer) {
        if (isVisible) map.addLayer(pemukimanLayer);
        else map.removeLayer(pemukimanLayer);
    }
}

async function loadFacilitiesData() {
    const controlsContainer = document.getElementById('facility-controls');
    const defaultOn = ['Bank Sampah Induk', 'Bank Sampah'];

    for (const config of facilityConfig) {
        try {
            const response = await fetch(API_PATH + config.file);
            const data = await response.json();
            const count = data.features ? data.features.length : 0;
            
            const iconHtml = `<span style="background-color: ${config.color}; width:24px; height:24px; display:flex; align-items:center; justify-content:center; color:white; font-size:10px; border-radius:50%; border:2px solid white; box-shadow:0 2px 4px rgba(0,0,0,0.3);"><i class="fa-solid ${config.icon}"></i></span>`;
            const icon = L.divIcon({ className: 'custom-div-icon', html: iconHtml, iconSize: [24, 24], iconAnchor: [12, 12] });
            
            const isInduk = config.name === 'Bank Sampah Induk';

            const layer = L.geoJSON(data, {
                pointToLayer: (feature, latlng) => {
                    const marker = L.marker(latlng, { 
                        icon: icon,
                        zIndexOffset: isInduk ? 1000 : 0 
                    });
                    
                    const p = feature.properties;
                    let displayNama = p.nama || "";
                    let jenis = p.jenis || "";

                    if (config.name === 'Fasilitas Lain (Sektor Informal)') {
                        if (jenis && displayNama) {
                            if (!displayNama.toLowerCase().startsWith(jenis.toLowerCase())) {
                                displayNama = jenis + " " + displayNama;
                            }
                        } else {
                            displayNama = displayNama || jenis || config.name;
                        }
                    } else {
                        displayNama = displayNama || config.name;
                    }

                    // Add tooltip that will only be visible via CSS at high zoom levels
                    marker.bindTooltip(displayNama, {
                        permanent: true,
                        direction: 'bottom',
                        className: 'facility-label',
                        offset: [0, 10]
                    });
                    return marker;
                },
                onEachFeature: (feature, layer) => {
                    const p = feature.properties;
                    let displayNama = p.nama || "";
                    let jenis = p.jenis || "";

                    if (config.name === 'Fasilitas Lain (Sektor Informal)') {
                        if (jenis && displayNama) {
                            if (!displayNama.toLowerCase().startsWith(jenis.toLowerCase())) {
                                displayNama = jenis + " " + displayNama;
                            }
                        } else {
                            displayNama = displayNama || jenis || config.name;
                        }
                    } else {
                        displayNama = displayNama || config.name;
                    }

                    layer.bindPopup(`<div class="p-1 min-w-[200px]"><h3 class="font-bold text-emerald-800 text-sm border-b pb-1 mb-2">${displayNama}</h3><div class="text-xs space-y-1"><p><span class="text-gray-500">Jenis:</span> ${p.jenis || config.name}</p><p><span class="text-gray-500">Kecamatan:</span> ${p.kecamatan || '-'}</p></div></div>`);
                }
            });

            const isVisible = defaultOn.includes(config.name);
            if (isVisible) {
                layer.addTo(facilitiesLayerGroup);
            }

            facilitiesData[config.name] = { layer, geojson: data, config, visible: isVisible };

            const id = 'chk-' + config.name.replace(/\s+/g, '-');
            controlsContainer.innerHTML += `
                <label class="flex items-center space-x-2 cursor-pointer hover:bg-gray-100 p-1 rounded">
                    <input type="checkbox" id="${id}" ${isVisible ? 'checked' : ''} class="rounded text-emerald-600 h-4 w-4 shrink-0" onchange="toggleFacility('${config.name}', this.checked)">
                    <div class="scale-75 origin-left shrink-0">${iconHtml}</div>
                    <span class="text-gray-700 flex-1 text-sm">${config.name} <span class="text-gray-400 text-[10px]">(${count})</span></span>
                </label>
            `;
        } catch (e) { console.error("Facility data error", e); }
    }
}

window.toggleFacility = function(name, isVisible) {
    if (facilitiesData[name]) {
        facilitiesData[name].visible = isVisible;
        if (isVisible) facilitiesLayerGroup.addLayer(facilitiesData[name].layer);
        else facilitiesLayerGroup.removeLayer(facilitiesData[name].layer);
    }
}

function setupEvents() {
    document.getElementById('buffer-radius').addEventListener('input', (e) => {
        document.getElementById('buffer-value').textContent = e.target.value + ' km';
    });
    document.getElementById('btn-analyze').addEventListener('click', runGeoprocessing);
    document.getElementById('btn-clear').addEventListener('click', clearAnalysis);
    document.getElementById('kecamatan-select').addEventListener('change', updateSummary);
}

function runGeoprocessing() {
    const overlay = document.getElementById('loading-overlay');
    overlay.classList.remove('hidden');

    setTimeout(() => {
        try {
            bufferLayerGroup.clearLayers();
            underservedLayerGroup.clearLayers();
            isochroneLinesGroup.clearLayers();

            const radiusKm = parseFloat(document.getElementById('buffer-radius').value);
            
            let allPoints = [];
            for (let key in facilitiesData) {
                if (facilitiesData[key].visible) allPoints = allPoints.concat(facilitiesData[key].geojson.features);
            }

            if (allPoints.length === 0) {
                alert("Pilih minimal satu fasilitas!");
                overlay.classList.add('hidden');
                return;
            }

            // 1. Buffer & Underserved Area
            let buffers = [];
            allPoints.forEach(pt => {
                if (pt.geometry && pt.geometry.coordinates) {
                    try { buffers.push(turf.buffer(pt, radiusKm, {units: 'kilometers'})); } catch (e) {}
                }
            });

            let mergedBuffer = buffers[0];
            for (let i = 1; i < buffers.length; i++) {
                try { mergedBuffer = turf.union(mergedBuffer, buffers[i]); } catch (e) {}
            }

            if (mergedBuffer) {
                L.geoJSON(mergedBuffer, { style: { color: '#3b82f6', weight: 1, fillColor: '#60a5fa', fillOpacity: 0.3 } }).addTo(bufferLayerGroup);
            }

            const kecamatanSummaries = {};

            if (kecamatanData) {
                kecamatanData.features.forEach(kec => {
                    const kecName = kec.properties.NAMOBJ;
                    const popData = populationData[(kecName || "").toUpperCase()] || { pop: 0 };
                    let areaKec = turf.area(kec);
                    
                    // Underserved logic
                    let areaCovered = 0;
                    if (mergedBuffer) {
                        try {
                            const covered = turf.intersect(kec, mergedBuffer);
                            if (covered) areaCovered = turf.area(covered);
                            const underserved = turf.difference(kec, mergedBuffer);
                            if (underserved) {
                                L.geoJSON(underserved, {
                                    style: { color: '#ef4444', weight: 0, fillColor: '#ef4444', fillOpacity: 0.4 },
                                    onEachFeature: (f, l) => l.bindTooltip(`<b>${kecName}</b><br>Underserved`, {sticky: true})
                                }).addTo(underservedLayerGroup);
                            }
                        } catch (e) {}
                    }

                    // 2. Isokron / Waktu Tempuh Logic (Centroid to nearest facility)
                    let centroid = turf.centroid(kec);
                    let nearestPt = null;
                    let minDistance = Infinity;

                    allPoints.forEach(pt => {
                        let dist = turf.distance(centroid, pt, {units: 'kilometers'});
                        if (dist < minDistance) {
                            minDistance = dist;
                            nearestPt = pt;
                        }
                    });

                    let travelTimeMins = 0;
                    let nearestFacilityName = "-";

                    if (nearestPt) {
                        nearestFacilityName = nearestPt.properties.nama || nearestPt.properties.jenis || "Fasilitas Terdekat";
                        // Network Distance Simulation (Euclidean * Detour Index)
                        let networkDistance = minDistance * DETOUR_INDEX;
                        travelTimeMins = (networkDistance / SPEED_KMH) * 60; // in minutes
                        
                        // Draw line to represent shortest path vector
                        L.geoJSON(turf.lineString([centroid.geometry.coordinates, nearestPt.geometry.coordinates]), {
                            style: { color: '#f59e0b', weight: 2, dashArray: '5, 5' }
                        }).addTo(isochroneLinesGroup);
                    }

                    kecamatanSummaries[kecName] = {
                        name: kecName,
                        pop: popData.pop,
                        areaCovered: areaCovered,
                        areaKec: areaKec,
                        pctCovered: (areaCovered / areaKec) * 100,
                        travelTime: travelTimeMins,
                        networkDistance: minDistance * DETOUR_INDEX,
                        nearestFacilityName: nearestFacilityName
                    };
                });

                window.latestSummaries = kecamatanSummaries;
                document.getElementById('summary-panel').classList.remove('hidden');
                document.getElementById('btn-clear').classList.remove('hidden');
                updateSummary();
            }
        } catch (e) {
            console.error(e);
            alert("Terjadi kesalahan.");
        } finally {
            overlay.classList.add('hidden');
        }
    }, 100);
}

function clearAnalysis() {
    bufferLayerGroup.clearLayers();
    underservedLayerGroup.clearLayers();
    isochroneLinesGroup.clearLayers();
    potentialLayerGroup.clearLayers();
    document.getElementById('summary-panel').classList.add('hidden');
    document.getElementById('btn-clear').classList.add('hidden');
    window.latestSummaries = null;
}

function updateSummary() {
    const select = document.getElementById('kecamatan-select');
    const content = document.getElementById('summary-content');
    const kecName = select.value;

    if (!kecName || !window.latestSummaries || !window.latestSummaries[kecName]) {
        content.innerHTML = '<p class="text-gray-500 text-center italic text-xs py-2">Pilih kecamatan untuk melihat ringkasan hasil analisis.</p>';
        return;
    }

    const s = window.latestSummaries[kecName];
    const popServed = Math.round(s.pop * (s.pctCovered / 100));

    content.innerHTML = `
        <div class="flex justify-between border-b pb-1"><span class="text-gray-500">Kecamatan:</span><span class="font-bold text-gray-800">${s.name}</span></div>
        <div class="flex justify-between border-b pb-1"><span class="text-gray-500">Penduduk (2025):</span><span class="font-semibold text-gray-700">${s.pop.toLocaleString('id-ID')} jiwa</span></div>
        <div class="flex justify-between border-b pb-1"><span class="text-gray-500">Area Terlayani (Buffer):</span><span class="font-semibold text-emerald-600">${s.pctCovered.toFixed(1)}%</span></div>
        <div class="border-b pb-1">
            <div class="flex justify-between items-start"><span class="text-gray-500 mt-0.5">Fasilitas Terdekat:</span><span class="font-semibold text-gray-700 text-right text-[11px] leading-tight max-w-[140px]">${s.nearestFacilityName}</span></div>
            <div class="flex justify-between mt-1"><span class="text-gray-500">Waktu Tempuh Isokron:</span><span class="font-semibold text-amber-600">${Math.round(s.travelTime)} Menit</span></div>
        </div>
        <div class="flex justify-between pt-1 bg-emerald-100 rounded px-1 -mx-1"><span class="text-emerald-800 font-medium">Est. Terlayani:</span><span class="font-bold text-emerald-700">${popServed.toLocaleString('id-ID')} jiwa</span></div>
    `;
}
