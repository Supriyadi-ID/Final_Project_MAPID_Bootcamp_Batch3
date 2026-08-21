const fs = require('fs');
let code = fs.readFileSync('JS/main.js', 'utf8');

const regex = /window\.togglePemukiman[\s\S]*?window\.toggleFacility = function/m;

const replacement = `window.togglePemukiman = function(isVisible) {
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
            let data;
            const savedData = localStorage.getItem('ecomap_layer_' + config.name);
            if (savedData) {
                data = JSON.parse(savedData);
            } else {
                const response = await fetch(API_PATH + config.file);
                data = await response.json();
            }

            // Ensure every feature has a unique _id and status
            if(data.features) {
                data.features.forEach(f => {
                    if (!f.properties._id) f.properties._id = Math.random().toString(36).substr(2, 9);
                    if (!f.properties.status) f.properties.status = 'Beroperasi';
                });
            }

            const count = data.features ? data.features.length : 0;
            
            const iconHtml = \`<span style="background-color: \${config.color}; width:24px; height:24px; display:flex; align-items:center; justify-content:center; color:white; font-size:10px; border-radius:50%; border:2px solid white; box-shadow:0 2px 4px rgba(0,0,0,0.3);"><i class="fa-solid \${config.icon}"></i></span>\`;
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
                        direction: 'auto',
                        className: 'facility-label',
                        offset: [0, 0]
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

                    const statusHtml = p.status === 'Tidak Beroperasi' ? '<span class="text-red-600 font-bold">Tidak Beroperasi</span>' : '<span class="text-emerald-600 font-bold">Beroperasi</span>';

                    layer.bindPopup(\`
                        <div class="p-1 min-w-[220px]">
                            <h3 class="font-bold text-emerald-800 text-sm border-b pb-1 mb-2">\${displayNama}</h3>
                            <div class="text-xs space-y-1">
                                <p><span class="text-gray-500">Jenis:</span> \${p.jenis || config.name}</p>
                                <p><span class="text-gray-500">Kecamatan:</span> \${p.kecamatan || '-'}</p>
                                <p><span class="text-gray-500">Status:</span> \${statusHtml}</p>
                            </div>
                            <div class="mt-3 flex space-x-2 border-t pt-2">
                                <button onclick="openEditModal('\${config.name}', '\${p._id}')" class="flex-1 bg-blue-50 text-blue-700 py-1 rounded border border-blue-200 hover:bg-blue-100 font-medium transition">Edit</button>
                                <button onclick="deleteFacility('\${config.name}', '\${p._id}')" class="flex-1 bg-red-50 text-red-700 py-1 rounded border border-red-200 hover:bg-red-100 font-medium transition">Hapus</button>
                            </div>
                        </div>
                    \`);
                }
            });

            const isVisible = defaultOn.includes(config.name);
            if (isVisible) {
                layer.addTo(facilitiesLayerGroup);
            }

            facilitiesData[config.name] = { layer, geojson: data, config, visible: isVisible };

            const id = 'chk-' + config.name.replace(/\s+/g, '-');
            controlsContainer.innerHTML += \`
                <label class="flex items-center space-x-2 cursor-pointer hover:bg-gray-100 p-1 rounded">
                    <input type="checkbox" id="\${id}" \${isVisible ? 'checked' : ''} class="rounded text-emerald-600 h-4 w-4 shrink-0" onchange="toggleFacility('\${config.name}', this.checked)">
                    <div class="scale-75 origin-left shrink-0">\${iconHtml}</div>
                    <span class="text-gray-700 flex-1 text-sm">\${config.name} <span class="text-gray-400 text-[10px]">(\${count})</span></span>
                </label>
            \`;
        } catch (e) { console.error("Facility data error", e); }
    }
    
    // Add Tambah Data Fasilitas button
    controlsContainer.innerHTML += \`
        <button onclick="startAddFacility()" class="mt-3 w-full bg-emerald-100 text-emerald-700 py-1.5 rounded text-sm font-bold border border-emerald-300 hover:bg-emerald-200 transition shadow-sm">
            <i class="fa-solid fa-plus mr-1"></i> Tambah Data Baru
        </button>
        <button onclick="resetAllEdits()" class="mt-1 w-full bg-red-50 text-red-600 py-1 rounded text-xs hover:bg-red-100 transition border border-red-200">
            <i class="fa-solid fa-rotate-left mr-1"></i> Reset Perubahan
        </button>
    \`;
}

window.toggleFacility = function`;

code = code.replace(regex, replacement);
fs.writeFileSync('JS/main.js', code, 'utf8');
