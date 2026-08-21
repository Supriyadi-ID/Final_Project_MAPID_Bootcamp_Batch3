function setupEvents() {
    document.getElementById('buffer-radius').addEventListener('input', (e) => {
        document.getElementById('buffer-value').textContent = e.target.value + ' km';
    });
    document.getElementById('btn-analyze').addEventListener('click', runGeoprocessing);
    document.getElementById('btn-clear').addEventListener('click', clearAnalysis);
    document.getElementById('kecamatan-select').addEventListener('change', updateSummary);
}

function clearAnalysis() {
    window.bufferLayerGroup.clearLayers();
    window.underservedLayerGroup.clearLayers();
    window.isochroneLinesGroup.clearLayers();
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
