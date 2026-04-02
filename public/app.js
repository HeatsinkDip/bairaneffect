const form = document.getElementById('compose-form');
const videoInput = document.getElementById('video-input');
const photosInput = document.getElementById('photos-input');
const composeBtn = document.getElementById('compose-btn');
const statusBox = document.getElementById('status-box');
const summary = document.getElementById('selection-summary');
const resultBox = document.getElementById('result-box');
const resultText = document.getElementById('result-text');
const downloadLink = document.getElementById('download-link');
const clearPhotosBtn = document.getElementById('clear-photos-btn');
const photoList = document.getElementById('photo-list');

let selectedPhotos = [];
const MAX_VIDEO_BYTES = 500 * 1024 * 1024;
const ALLOWED_VIDEO_EXT = ['.mp4', '.mov', '.avi'];
const ALLOWED_PHOTO_EXT = ['.jpg', '.jpeg', '.png', '.heic', '.webp'];

function extOf(fileName) {
  const idx = fileName.lastIndexOf('.');
  return idx >= 0 ? fileName.slice(idx).toLowerCase() : '';
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(1)} ${units[unitIndex]}`;
}

function updateSelectionSummary() {
  const video = videoInput.files[0];
  const photos = selectedPhotos;

  if (!video && photos.length === 0) {
    summary.textContent = 'No files selected yet.';
    photoList.classList.add('hidden');
    photoList.innerHTML = '';
    return;
  }

  const videoPart = video ? `Video: ${video.name} (${formatBytes(video.size)})` : 'Video: none';
  const photosPart = photos.length > 0 ? `Photos: ${photos.length}` : 'Photos: none';
  summary.textContent = `${videoPart} | ${photosPart}`;

  if (photos.length > 0) {
    photoList.classList.remove('hidden');
    photoList.innerHTML = photos
      .map((photo, i) => `<div>${i + 1}. ${photo.name} (${formatBytes(photo.size)})</div>`)
      .join('');
  } else {
    photoList.classList.add('hidden');
    photoList.innerHTML = '';
  }
}

videoInput.addEventListener('change', updateSelectionSummary);
photosInput.addEventListener('change', () => {
  const incoming = Array.from(photosInput.files || []);
  if (incoming.length > 0) {
    const existing = new Set(selectedPhotos.map((f) => `${f.name}-${f.size}-${f.lastModified}`));
    for (const file of incoming) {
      const ext = extOf(file.name);
      if (!ALLOWED_PHOTO_EXT.includes(ext)) {
        statusBox.textContent = `Skipped ${file.name}: unsupported photo format.`;
        continue;
      }

      const key = `${file.name}-${file.size}-${file.lastModified}`;
      if (!existing.has(key)) {
        selectedPhotos.push(file);
        existing.add(key);
      }
    }
  }

  photosInput.value = '';
  updateSelectionSummary();
});

clearPhotosBtn.addEventListener('click', () => {
  selectedPhotos = [];
  photosInput.value = '';
  updateSelectionSummary();
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const video = videoInput.files[0];
  const photos = selectedPhotos;

  statusBox.textContent = '';

  if (!video) {
    statusBox.textContent = 'Please choose a video file.';
    return;
  }

  if (!ALLOWED_VIDEO_EXT.includes(extOf(video.name))) {
    statusBox.textContent = 'Video must be MP4, MOV, or AVI.';
    return;
  }

  if (video.size > MAX_VIDEO_BYTES) {
    statusBox.textContent = 'Video is too large. Max allowed size is 500 MB.';
    return;
  }

  if (photos.length === 0) {
    statusBox.textContent = 'Please choose at least one photo.';
    return;
  }

  composeBtn.disabled = true;
  resultBox.classList.add('hidden');
  statusBox.textContent = 'Uploading files and composing video. This can take a few minutes...';

  try {
    const formData = new FormData();
    formData.append('video', video);
    for (const photo of photos) {
      formData.append('photos', photo);
    }

    const response = await fetch('/compose', {
      method: 'POST',
      body: formData
    });

    const contentType = response.headers.get('content-type') || '';
    const data = contentType.includes('application/json')
      ? await response.json()
      : { success: false, error: await response.text() };

    if (!response.ok || !data.success) {
      throw new Error(data.error || 'Failed to compose video');
    }

    statusBox.textContent = data.bgRemovalApplied
      ? 'Composition complete with background removal + border effect.'
      : 'Composition complete, but background removal was not applied.';
    resultText.textContent = `Request ${data.requestId} is ready. Photos used: ${data.photosUsed ?? photos.length}.`;
    downloadLink.href = data.downloadUrl;
    downloadLink.setAttribute('download', data.filename || 'final-video.mp4');
    resultBox.classList.remove('hidden');
  } catch (error) {
    statusBox.textContent = `Error: ${error.message}`;
  } finally {
    composeBtn.disabled = false;
  }
});
