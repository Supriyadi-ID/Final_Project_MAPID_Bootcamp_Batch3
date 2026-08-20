// Global Map Variables
let map;
let kecamatanLayer;
let roadLayer;
let facilitiesLayerGroup = L.layerGroup();
let bufferLayerGroup = L.layerGroup();
let underservedLayerGroup = L.layerGroup();
let isochroneLinesGroup = L.layerGroup();
let potentialLayerGroup = L.layerGroup();
let startingPointMarker = null;

// Data Storage
let kecamatanData = null;
let roadData = null;
let facilitiesData = {}; // key: name, value: { layer, geojson, config, visible }
let populationData = {};

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
    L.control.zoom({ position: 'bottomright' }).addTo(map);

    const googleMap = L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', { maxZoom: 20, attribution: '© Google' });
    const googleSat = L.tileLayer('https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', { maxZoom: 20, attribution: '© Google' });
    const googleHybrid = L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', { maxZoom: 20, attribution: '© Google' });
    
    googleSat.addTo(map); // Default basemap

    L.control.layers({"Google Satellite": googleSat, "Google Hybrid": googleHybrid, "Google Map": googleMap}, {}, { position: 'bottomright' }).addTo(map);

    facilitiesLayerGroup.addTo(map);
    bufferLayerGroup.addTo(map);
    underservedLayerGroup.addTo(map);
    isochroneLinesGroup.addTo(map);
    potentialLayerGroup.addTo(map);

    // Map click for routing start point
    map.on('click', function(e) {
        if (startingPointMarker) {
            startingPointMarker.setLatLng(e.latlng);
        } else {
            startingPointMarker = L.marker(e.latlng, {draggable: true}).addTo(map)
                .bindPopup("Titik Awal Rute").openPopup();
        }
    });

    loadPopulationData().then(async () => {
        await loadKecamatanData();
        await loadRoadNetwork(); 
        await loadFacilitiesData();
    });

    setupEvents();
}

window.routeTo = function(lat, lng) {
    if (!startingPointMarker) {
        alert("Silakan klik pada peta terlebih dahulu untuk menentukan Titik Awal rute.");
        return;
    }
    
    // Close popups immediately
    map.closePopup();

    const overlay = document.getElementById('loading-overlay');
    document.getElementById('loading-text').innerText = "Memproses Rute...";
    overlay.classList.remove('hidden');

    const mode = document.getElementById('route-mode').value;
    const start = startingPointMarker.getLatLng();
    
    if (window.routingControl) {
        map.removeControl(window.routingControl);
    }
    
    window.routingControl = L.Routing.control({
        waypoints: [
            start,
            L.latLng(lat, lng)
        ],
        router: L.Routing.osrmv1({
            serviceUrl: 'https://router.project-osrm.org/route/v1',
            profile: mode
        }),
        routeWhileDragging: false,
        language: 'id',
        showAlternatives: false,
        fitSelectedRoutes: true,
        lineOptions: {
            styles: [{color: '#3b82f6', opacity: 0.8, weight: 6}]
        },
        createMarker: function(i, wp) {
            if (i === 0) return null; // We already have starting point marker
            return null; // Don't create default markers
        }
    }).addTo(map);

    // Hide overlay shortly after sending request
    setTimeout(() => { overlay.classList.add('hidden'); }, 1000);
}

window.clearRoute = function() {
    if (window.routingControl) {
        map.removeControl(window.routingControl);
        window.routingControl = null;
    }
    if (startingPointMarker) {
        map.removeLayer(startingPointMarker);
        startingPointMarker = null;
    }
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
            style: { color: '#64748b', weight: 1.5, fillOpacity: 0.1, dashArray: '4' },
            onEachFeature: (feature, layer) => {
                const kecName = feature.properties.NAMOBJ;
                const popData = populationData[(kecName || "").toUpperCase()];
                let pop = 0; let kepadatan = 0;
                if(popData) {
                    pop = popData.pop;
                    const areaKm2 = turf.area(feature) / 1000000;
                    kepadatan = Math.round(pop / areaKm2);
                }
                
                layer.bindTooltip(`<b>${kecName}</b><br>Penduduk: ${pop.toLocaleString('id-ID')} jiwa<br>Kepadatan: ${kepadatan.toLocaleString('id-ID')} jiwa/km²`, { permanent: false, direction: 'center', className: 'text-xs bg-white/80 border-none shadow-sm text-gray-700 p-2 rounded' });
                
                layer.on('click', (e) => {
                    if (highlightedKecamatan) {
                        kecamatanLayer.resetStyle(highlightedKecamatan);
                    }
                    highlightedKecamatan = layer;
                    layer.setStyle({
                        weight: 3,
                        color: '#0ea5e9',
                        dashArray: '',
                        fillOpacity: 0.3
                    });
                    layer.bringToFront();
                });

                const select = document.getElementById('kecamatan-select');
                const option = document.createElement('option');
                option.value = kecName; option.textContent = kecName;
                select.appendChild(option);
            }
        }).addTo(map);

        const controlsContainer = document.getElementById('base-controls');
        controlsContainer.innerHTML += `
            <label class="flex items-center space-x-2 cursor-pointer hover:bg-gray-100 p-1 rounded mb-2">
                <input type="checkbox" id="chk-kec" checked class="rounded text-emerald-600 focus:ring-emerald-500 h-4 w-4" onchange="toggleKecamatan(this.checked)">
                <span class="w-4 h-4 border-2 border-slate-500 bg-slate-200 inline-block opacity-50"></span>
                <span class="text-gray-700 flex-1 font-medium">Batas Administrasi Kecamatan</span>
            </label>
        `;
    } catch (e) { console.error("Kecamatan data error", e); }
}

window.toggleKecamatan = function(isVisible) {
    if (kecamatanLayer) {
        if (isVisible) map.addLayer(kecamatanLayer);
        else map.removeLayer(kecamatanLayer);
    }
}

async function loadRoadNetwork() {
    try {
        const response = await fetch(API_PATH + 'BASE_Jaringan_Jalan_Palembang_OSM.geojson');
        roadData = await response.json();
        roadLayer = L.geoJSON(roadData, {
            style: function(feature) {
                const type = feature.properties.highway || 'unclassified';
                let color = '#9ca3af'; // default gray
                let weight = 0.5;
                let opacity = 0.6;
                
                if (type === 'motorway' || type === 'trunk') {
                    color = '#ef4444'; weight = 3; opacity = 1;
                } else if (type === 'primary') {
                    color = '#f97316'; weight = 2.5; opacity = 1;
                } else if (type === 'secondary') {
                    color = '#eab308'; weight = 2; opacity = 0.9;
                } else if (type === 'tertiary') {
                    color = '#fde047'; weight = 1.5; opacity = 0.8;
                } else if (type === 'residential') {
                    color = '#e5e7eb'; weight = 1; opacity = 0.7;
                }

                return { color: color, weight: weight, opacity: opacity };
            }
        });
        
        const controlsContainer = document.getElementById('base-controls');
        controlsContainer.innerHTML += `
            <label class="flex items-center space-x-2 cursor-pointer hover:bg-gray-100 p-1 rounded mb-2 pb-2 border-b">
                <input type="checkbox" id="chk-road" class="rounded text-emerald-600 focus:ring-emerald-500 h-4 w-4" onchange="toggleRoad(this.checked)">
                <div class="flex flex-col space-y-0.5">
                    <span style="width: 16px; height: 2px; background-color: #ef4444;"></span>
                    <span style="width: 16px; height: 1.5px; background-color: #f97316;"></span>
                </div>
                <span class="text-gray-700 flex-1 font-medium ml-1">Jaringan Jalan</span>
            </label>
        `;
    } catch (e) { console.error("Road data error", e); }
}

window.toggleRoad = function(isVisible) {
    if (roadLayer) {
        if (isVisible) map.addLayer(roadLayer);
        else map.removeLayer(roadLayer);
    }
}

async function loadFacilitiesData() {
    const controlsContainer = document.getElementById('facility-controls');
    const defaultOn = ['Bank Sampah Induk', 'Bank Sampah'];

    for (const config of facilityConfig) {
        try {
            const response = await fetch(API_PATH + config.file);
            const data = await response.json();
            
            const iconHtml = `<span style="background-color: ${config.color}; width:24px; height:24px; display:flex; align-items:center; justify-content:center; color:white; font-size:10px; border-radius:50%; border:2px solid white; box-shadow:0 2px 4px rgba(0,0,0,0.3);"><i class="fa-solid ${config.icon}"></i></span>`;
            const icon = L.divIcon({ className: 'custom-div-icon', html: iconHtml, iconSize: [24, 24], iconAnchor: [12, 12] });

            const layer = L.geoJSON(data, {
                pointToLayer: (feature, latlng) => L.marker(latlng, { icon: icon }),
                onEachFeature: (feature, layer) => {
                    const p = feature.properties;
                    // For routing
                    let lat = null, lng = null;
                    if(feature.geometry && feature.geometry.coordinates) {
                        lng = feature.geometry.coordinates[0];
                        lat = feature.geometry.coordinates[1];
                    }
                    
                    const btnHtml = (lat && lng) ? `<button onclick="routeTo(${lat}, ${lng})" class="mt-2 w-full bg-blue-100 hover:bg-blue-200 text-blue-700 font-semibold py-1 rounded text-xs transition"><i class="fa-solid fa-route"></i> Rute ke Sini</button>` : '';

                    layer.bindPopup(`<div class="p-1 min-w-[200px]"><h3 class="font-bold text-emerald-800 text-sm border-b pb-1 mb-2">${p.nama || config.name}</h3><div class="text-xs space-y-1"><p><span class="text-gray-500">Jenis:</span> ${p.jenis || config.name}</p><p><span class="text-gray-500">Kecamatan:</span> ${p.kecamatan || '-'}</p></div>${btnHtml}</div>`);
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
                    <input type="checkbox" id="${id}" ${isVisible ? 'checked' : ''} class="rounded text-emerald-600 h-4 w-4" onchange="toggleFacility('${config.name}', this.checked)">
                    <span class="w-4 h-4 rounded-full border border-white shadow-sm inline-block" style="background-color: ${config.color}"></span>
                    <span class="text-gray-700 flex-1">${config.name}</span>
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
    document.getElementById('btn-potential').addEventListener('click', findPotential);
    document.getElementById('btn-clear').addEventListener('click', clearAnalysis);
    document.getElementById('kecamatan-select').addEventListener('change', updateSummary);
}

function findPotential() {
    potentialLayerGroup.clearLayers();
    
    let underservedFeatures = [];
    underservedLayerGroup.eachLayer(layer => {
        if(layer.toGeoJSON) {
            underservedFeatures.push(layer.toGeoJSON());
        }
    });
    
    if(underservedFeatures.length === 0) {
        alert("Silakan jalankan 'Hitung & Analisis' terlebih dahulu, atau area sudah terlayani 100%.");
        return;
    }
    
    let count = 0;
    const addPoint = (poly) => {
        try {
            let pt = turf.pointOnFeature(poly);
            let iconHtml = `<span style="background-color: #f43f5e; width:22px; height:22px; display:flex; align-items:center; justify-content:center; color:white; font-size:12px; border-radius:50%; border:2px solid white; box-shadow:0 2px 4px rgba(0,0,0,0.3);"><i class="fa-solid fa-lightbulb"></i></span>`;
            let icon = L.divIcon({ className: 'custom-div-icon', html: iconHtml, iconSize: [22, 22], iconAnchor: [11, 11] });
            
            L.marker([pt.geometry.coordinates[1], pt.geometry.coordinates[0]], {icon: icon})
                .bindPopup(`<div class="p-2"><h3 class="font-bold text-rose-600 border-b pb-1 mb-1"><i class="fa-solid fa-lightbulb mr-1"></i>Rekomendasi Lokasi Baru</h3><p class="text-xs text-gray-600">Titik ini secara strategis berada di area blank spot (belum terlayani) dan direkomendasikan untuk pembangunan fasilitas baru.</p></div>`)
                .addTo(potentialLayerGroup);
            count++;
        } catch(e) {}
    };

    underservedFeatures.forEach(f => {
        if (f.geometry.type === 'Polygon') {
            addPoint(f);
        } else if (f.geometry.type === 'MultiPolygon') {
            f.geometry.coordinates.forEach(polyCoords => {
                const singlePoly = turf.polygon(polyCoords);
                // Area filter to ignore very small slivers (e.g. < 0.1 sq km)
                if (turf.area(singlePoly) > 100000) { 
                    addPoint(singlePoly);
                }
            });
        }
    });
    
    if(count > 0) {
        alert(`Ditemukan ${count} titik potensial baru untuk menutup area blank spot (underserved).`);
    } else {
        alert("Tidak ada blank spot yang cukup luas untuk direkomendasikan lokasi baru.");
    }
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
                    if (nearestPt) {
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
                        networkDistance: minDistance * DETOUR_INDEX
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
        <div class="flex justify-between border-b pb-1"><span class="text-gray-500">Waktu ke Fasilitas Terdekat:</span><span class="font-semibold text-amber-600">${Math.round(s.travelTime)} Menit</span></div>
        <div class="flex justify-between pt-1 bg-emerald-100 rounded px-1 -mx-1"><span class="text-emerald-800 font-medium">Est. Terlayani:</span><span class="font-bold text-emerald-700">${popServed.toLocaleString('id-ID')} jiwa</span></div>
    `;
}
