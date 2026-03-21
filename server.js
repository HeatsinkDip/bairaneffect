const express = require('express');
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const FormData = require('form-data');

const app = express();
app.use(express.json({ limit: '100mb' }));

const FFMPEG = 'ffmpeg';
const TEMP_BASE_DIR = 'temp-requests';

if (!fs.existsSync(TEMP_BASE_DIR)) fs.mkdirSync(TEMP_BASE_DIR, { recursive: true });

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(dest);
    
    protocol.get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        downloadFile(response.headers.location, dest).then(resolve).catch(reject);
        return;
      }
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download: ${response.statusCode}`));
        return;
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

function generateRequestId() {
  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

async function uploadToStoreFile(filePath, userId) {
  const url = process.env.PORT;
  
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('file', fs.createReadStream(filePath));
    form.append('userid', userId);
    
    const parsedUrl = new URL(url);
    const protocol = parsedUrl.protocol === 'https:' ? https : http;
    
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.pathname,
      method: 'POST',
      headers: form.getHeaders()
    };
    
    const req = protocol.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`Failed to parse response: ${data}`));
          }
        } else {
          reject(new Error(`Upload failed with status ${res.statusCode}: ${data}`));
        }
      });
    });
    
    req.on('error', reject);
    form.pipe(req);
  });
}

function extractZip(zipPath, destDir) {
  console.log(`Extracting zip: ${zipPath}`);
  execSync(`unzip -o "${zipPath}" -d "${destDir}"`, { stdio: 'inherit' });
  
  const files = fs.readdirSync(destDir);
  console.log(`Extracted ${files.length} files`);
}

function runStep(stepNum, workDir) {
  return new Promise((resolve, reject) => {
    let scriptName;
    if (stepNum === 1) scriptName = 'step1-extract-last-frame.js';
    else if (stepNum === 2) scriptName = 'step2-remove-background.js';
    else if (stepNum === 3) scriptName = 'step3-add-borders.js';
    else if (stepNum === 4) scriptName = 'step4-compose-video.js';
    
    console.log(`Running step ${stepNum}: ${scriptName}`);
    
    const proc = spawn('node', [scriptName, workDir], { 
      cwd: __dirname,
      stdio: 'inherit' 
    });
    
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Step ${stepNum} failed with code ${code}`));
    });
  });
}

async function processVideo(videoPath, isUrl = false, zipPath = null, zipUrl = false, userId = null, imageUrls = null) {
  const requestId = generateRequestId();
  const effectiveUserId = userId || requestId;
  const workDir = path.join(TEMP_BASE_DIR, requestId);
  const imagesDir = path.join(workDir, 'middle-images');
  const outputDir = path.join(workDir, 'output');
  
  fs.mkdirSync(imagesDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });
  console.log(`Created work directory for request: ${requestId}`);
  
  try {
    const tempZip = path.join(workDir, 'input-images.zip');
    const middleSlideshow = path.join(outputDir, 'middle-slideshow.mp4');
    
    if (zipPath) {
      if (zipUrl) {
        console.log(`Downloading zip from: ${zipPath}`);
        await downloadFile(zipPath, tempZip);
        zipPath = tempZip;
      }
      
      if (!fs.existsSync(zipPath)) {
        throw new Error(`Zip file not found: ${zipPath}`);
      }
      
      console.log(`Extracting images from zip: ${zipPath}`);
      extractZip(zipPath, imagesDir);
      
      if (zipUrl && fs.existsSync(tempZip)) {
        fs.unlinkSync(tempZip);
      }
      
      console.log('Creating slideshow from images...');
      await new Promise((resolve, reject) => {
        const proc = spawn('node', ['create-middle-slideshow.js', imagesDir, middleSlideshow], { 
          cwd: __dirname,
          stdio: 'inherit' 
        });
        proc.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`Slideshow creation failed with code ${code}`));
        });
      });
    } else if (imageUrls && imageUrls.length > 0) {
      console.log(`Downloading ${imageUrls.length} images...`);
      for (let i = 0; i < imageUrls.length; i++) {
        const imageUrl = imageUrls[i];
        const ext = path.extname(new URL(imageUrl).pathname).split('?')[0] || '.jpg';
        const destPath = path.join(imagesDir, `image_${String(i).padStart(3, '0')}${ext}`);
        console.log(`Downloading image ${i + 1}/${imageUrls.length}: ${imageUrl}`);
        await downloadFile(imageUrl, destPath);
      }
      
      console.log('Creating slideshow from images...');
      await new Promise((resolve, reject) => {
        const proc = spawn('node', ['create-middle-slideshow.js', imagesDir, middleSlideshow], { 
          cwd: __dirname,
          stdio: 'inherit' 
        });
        proc.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`Slideshow creation failed with code ${code}`));
        });
      });
    }
    
    const tempVideo = path.join(workDir, 'input-video.mp4');
    
    if (isUrl) {
      console.log(`Downloading video from: ${videoPath}`);
      await downloadFile(videoPath, tempVideo);
      videoPath = tempVideo;
    } else {
      if (!fs.existsSync(videoPath)) {
        throw new Error(`Video file not found: ${videoPath}`);
      }
    }

    console.log(`Processing: ${videoPath}`);
    
    const ext = path.extname(videoPath).toLowerCase();
    if (!['.mp4', '.mov', '.avi'].includes(ext)) {
      throw new Error('Unsupported video format. Use MP4, MOV, or AVI.');
    }

    const mainVideo = path.join(workDir, 'main-video.MP4');
    
    // Convert video to MP4 format (handles MOV and other formats)
    console.log(`Converting to MP4: ${videoPath}`);
    await new Promise((resolve, reject) => {
      const proc = spawn('ffmpeg', [
        '-i', videoPath,
        '-c:v', 'libx264',
        '-c:a', 'aac',
        '-movflags', '+faststart',
        '-y',
        mainVideo
      ], { stdio: 'inherit' });
      proc.on('close', (code) => {
        if (code === 0) {
          console.log(`✅ Converted to MP4: ${mainVideo}`);
          resolve();
        } else {
          reject(new Error(`Video conversion failed with code ${code}`));
        }
      });
    });

    await runStep(1, workDir);
    await runStep(2, workDir);
    await runStep(3, workDir);
    await runStep(4, workDir);

    const finalVideo = path.join(outputDir, 'final-video.mp4');
    
    console.log('Uploading final video to store-file...');
    const uploadResult = await uploadToStoreFile(finalVideo, effectiveUserId);
    console.log(`Upload complete: ${uploadResult.fileUrl}`);

    if (isUrl && fs.existsSync(tempVideo)) {
      fs.unlinkSync(tempVideo);
    }

    fs.rmSync(workDir, { recursive: true, force: true });
    console.log(`Cleaned up work directory: ${requestId}`);

    return {
      success: true,
      fileUrl: uploadResult.fileUrl,
      fileId: uploadResult.fileId,
      originalFilename: uploadResult.originalFilename,
      fileSize: uploadResult.fileSize
    };
  } catch (error) {
    console.error('Error:', error.message);
    if (fs.existsSync(workDir)) {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
    throw error;
  }
}

app.post('/process', async (req, res) => {
  try {
    const { videoPath, isUrl, zipPath, zipUrl, userId, imageUrls } = req.body;
    
    if (!videoPath) {
      return res.status(400).json({ error: 'videoPath is required' });
    }

    console.log('\n========== NEW REQUEST ==========');
    console.log(`Video: ${videoPath}`);
    console.log(`Video Is URL: ${isUrl}`);
    console.log(`Zip: ${zipPath || 'none'}`);
    console.log(`Zip Is URL: ${zipUrl}`);
    console.log(`Image URLs: ${imageUrls ? imageUrls.length + ' images' : 'none'}`);
    console.log(`UserId: ${userId || 'default'}\n`);

    const result = await processVideo(videoPath, isUrl, zipPath, zipUrl, userId, imageUrls);
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

app.get('/download/:filename', (req, res) => {
  const filename = req.params.filename;
  const filepath = path.join(__dirname, 'output', filename);
  
  if (!fs.existsSync(filepath)) {
    return res.status(404).json({ error: 'File not found' });
  }
  
  res.download(filepath);
});

app.get('/status', (req, res) => {
  res.json({ status: 'running' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`   POST /process { "videoPath": "...", "isUrl": false, "zipPath": "..." | "imageUrls": [...] }`);
  console.log(`   GET  /download/<filename>`);
});
