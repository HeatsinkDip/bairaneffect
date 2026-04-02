const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const workDir = process.argv[2] || '.';
const OUTPUT_DIR = path.join(workDir, 'output');
const INPUT_IMAGE = path.join(OUTPUT_DIR, 'last-frame.png');
const BG_REMOVED_IMAGE = path.join(OUTPUT_DIR, 'bg-removed.png');
const PYTHON_SCRIPT = path.join(__dirname, 'remove_bg.py');

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

async function removeBackgroundWithPython(imagePath, outputPath) {
  console.log('Removing background locally using Python rembg...');
  console.log(`Input: ${imagePath}`);
  console.log(`Output: ${outputPath}`);
  
  try {
    const command = `python3 "${PYTHON_SCRIPT}" "${imagePath}" "${outputPath}"`;
    console.log(`Executing: ${command}`);
    
    execSync(command, { stdio: 'inherit' });
    
    console.log(`✅ Background removed successfully (Local Python)!`);
    console.log(`�ߒ� Saved to: ${outputPath}`);
    
    return outputPath;
  } catch (error) {
    console.error('❍ Background removal failed:', error.message);
    throw error;
  }
}

console.log('🎨 Step 2: Removing background from last frame locally...');
console.log(`WorkDir: ${workDir}`);

removeBackgroundWithPython(INPUT_IMAGE, BG_REMOVED_IMAGE)
  .then(() => {
    console.log('\n✙ Step 2 complete!');
    console.log(`Next: Add thick white borders to ${BG_REMOVED_IMAGE}`);
  })
  .catch((err) => {
    console.error('❍ Step 2 failed:', err.message);
    process.exit(1);
  });