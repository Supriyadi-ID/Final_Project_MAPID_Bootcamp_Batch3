window.openEditModal = function(layerName, featureId) {
    const facility = window.facilitiesData[layerName].geojson.features.find(f => f.properties._id === featureId);
    if (!facility) return;
    const p = facility.properties;
    const coords = facility.geometry.coordinates;

    document.getElementById('edit-modal-title').innerHTML = '<i class="fa-solid fa-pen-to-square mr-2"></i>Edit Fasilitas';
    document.getElementById('edit-id').value = p._id;
    document.getElementById('edit-original-layer').value = layerName;
    
    const select = document.getElementById('edit-layer');
    select.innerHTML = window.facilityConfig.map(c => `<option value="${c.name}" ${c.name === layerName ? 'selected' : ''}>${c.name}</option>`).join('');

    document.getElementById('edit-nama').value = p.nama || '';
    document.getElementById('edit-jenis').value = p.jenis || '';
    document.getElementById('edit-kecamatan').value = p.kecamatan || '';
    document.getElementById('edit-status').value = p.status || 'Beroperasi';
    document.getElementById('edit-lat').value = coords[1];
    document.getElementById('edit-lng').value = coords[0];

    window.toggleJenisVisibility();
    toggleModal('modal-edit-facility');
    window.map.closePopup();
};

window.toggleJenisVisibility = function() {
    const layer = document.getElementById('edit-layer').value;
    const container = document.getElementById('jenis-container');
    if (layer === 'Fasilitas Lain (Sektor Informal)') {
        container.style.display = 'block';
    } else {
        container.style.display = 'none';
        document.getElementById('edit-jenis').value = '';
    }
};

window.startAddFacility = function() {
    document.getElementById('edit-modal-title').innerHTML = '<i class="fa-solid fa-plus mr-2"></i>Tambah Fasilitas Baru';
    document.getElementById('edit-facility-form').reset();
    document.getElementById('edit-id').value = '';
    document.getElementById('edit-original-layer').value = '';

    const select = document.getElementById('edit-layer');
    select.innerHTML = window.facilityConfig.map(c => `<option value="${c.name}">${c.name}</option>`).join('');

    window.toggleJenisVisibility();
    toggleModal('modal-edit-facility');
};

window.deleteFacility = function(layerName, featureId) {
    if(!confirm('Apakah Anda yakin ingin menghapus fasilitas ini?')) return;
    
    const data = window.facilitiesData[layerName].geojson;
    data.features = data.features.filter(f => f.properties._id !== featureId);
    
    saveToLocalStorageAndReload(layerName, data);
};

window.saveFacility = function() {
    const id = document.getElementById('edit-id').value;
    const originalLayer = document.getElementById('edit-original-layer').value;
    const targetLayer = document.getElementById('edit-layer').value;
    
    const nama = document.getElementById('edit-nama').value;
    const jenis = document.getElementById('edit-jenis').value;
    const kecamatan = document.getElementById('edit-kecamatan').value;
    const status = document.getElementById('edit-status').value;
    const lat = parseFloat(document.getElementById('edit-lat').value);
    const lng = parseFloat(document.getElementById('edit-lng').value);

    let feature = null;

    if (id && originalLayer) {
        const data = window.facilitiesData[originalLayer].geojson;
        const index = data.features.findIndex(f => f.properties._id === id);
        if (index > -1) {
            if (originalLayer !== targetLayer) {
                feature = data.features.splice(index, 1)[0];
                saveToLocalStorageAndReload(originalLayer, data);
            } else {
                feature = data.features[index];
            }
        }
    }

    if (!feature) {
        feature = {
            type: "Feature",
            geometry: { type: "Point", coordinates: [] },
            properties: { _id: Math.random().toString(36).substr(2, 9) }
        };
    }

    feature.properties.nama = nama;
    feature.properties.jenis = jenis;
    feature.properties.kecamatan = kecamatan;
    feature.properties.status = status;
    feature.geometry.coordinates = [lng, lat];

    const targetData = window.facilitiesData[targetLayer].geojson;
    if (!id || originalLayer !== targetLayer) {
        targetData.features.push(feature);
    }
    
    saveToLocalStorageAndReload(targetLayer, targetData);
    toggleModal('modal-edit-facility');
};

function saveToLocalStorageAndReload(layerName, geojsonData) {
    localStorage.setItem('ecomap_layer_' + layerName, JSON.stringify(geojsonData));
    location.reload();
}

window.resetAllEdits = function() {
    if(!confirm('Hapus semua perubahan dan kembalikan data ke kondisi asli?')) return;
    window.facilityConfig.forEach(c => localStorage.removeItem('ecomap_layer_' + c.name));
    location.reload();
};

window.isAddingFacility = false;
window.pickLocationOnMap = function() {
    toggleModal('modal-edit-facility');
    document.getElementById('instruction-overlay').classList.remove('hidden');
    window.map.getContainer().style.cursor = 'crosshair';
    window.isAddingFacility = true;
};

window.cancelPickLocation = function() {
    document.getElementById('instruction-overlay').classList.add('hidden');
    window.map.getContainer().style.cursor = '';
    window.isAddingFacility = false;
    toggleModal('modal-edit-facility');
};
