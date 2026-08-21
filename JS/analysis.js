function runGeoprocessing() {
    const overlay = document.getElementById('loading-overlay');
    overlay.classList.remove('hidden');

    setTimeout(() => {
        try {
            window.bufferLayerGroup.clearLayers();
            window.underservedLayerGroup.clearLayers();
            window.isochroneLinesGroup.clearLayers();

            const radiusKm = parseFloat(document.getElementById('buffer-radius').value);
            
            let allPoints = [];
            for (let key in window.facilitiesData) {
                if (window.facilitiesData[key].visible) allPoints = allPoints.concat(window.facilitiesData[key].geojson.features);
            }

            if (allPoints.length === 0) {
                alert("Pilih minimal satu fasilitas!");
                overlay.classList.add('hidden');
                return;
            }

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
                L.geoJSON(mergedBuffer, { style: { color: '#3b82f6', weight: 1, fillColor: '#60a5fa', fillOpacity: 0.3 } }).addTo(window.bufferLayerGroup);
            }

            const kecamatanSummaries = {};

            if (window.kecamatanData) {
                window.kecamatanData.features.forEach(kec => {
                    const kecName = kec.properties.NAMOBJ;
                    const popData = window.populationData[(kecName || "").toUpperCase()] || { pop: 0 };
                    let areaKec = turf.area(kec);
                    
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
                                }).addTo(window.underservedLayerGroup);
                            }
                        } catch (e) {}
                    }

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
                        let networkDistance = minDistance * window.DETOUR_INDEX;
                        travelTimeMins = (networkDistance / window.SPEED_KMH) * 60;
                        
                        L.polyline([[centroid.geometry.coordinates[1], centroid.geometry.coordinates[0]], 
                                    [nearestPt.geometry.coordinates[1], nearestPt.geometry.coordinates[0]]], {
                            color: '#eab308', weight: 2, dashArray: '5, 5'
                        }).addTo(window.isochroneLinesGroup);
                    }

                    const pctCovered = areaKec > 0 ? (areaCovered / areaKec) * 100 : 0;
                    
                    kecamatanSummaries[kecName] = {
                        name: kecName,
                        pop: popData.pop,
                        pctCovered: pctCovered,
                        travelTime: travelTimeMins,
                        nearestFacilityName: nearestFacilityName
                    };
                });
            }

            window.latestSummaries = kecamatanSummaries;
            
            const select = document.getElementById('kecamatan-select');
            select.innerHTML = '<option value="">-- Pilih Kecamatan --</option>';
            Object.keys(kecamatanSummaries).sort().forEach(k => {
                select.innerHTML += `<option value="${k}">${k}</option>`;
            });

            if (Object.keys(kecamatanSummaries).length > 0) {
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
