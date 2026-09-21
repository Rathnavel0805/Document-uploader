// Step 2: compress the image to 15KB and convert it to JPG
const sharp = require('sharp');
const settings = require('./settings');

const MAX_BYTES = settings.MAX_KB * 1024;

// Starting size (in pixels) for each document type.
// Change these numbers if your form needs different sizes.
const SIZES = {
  photo:     { width: 200, height: 230 },
  signature: { width: 140, height: 60 }
};

async function compressToJpeg(inputBuffer, docType) {
  let width = SIZES[docType].width;
  let height = SIZES[docType].height;

  // Try up to 6 times, making the image smaller each round
  for (let round = 0; round < 6; round++) {

    // In each round, lower the quality step by step: 90, 80, 70 ... 20
    for (let quality = 90; quality >= 20; quality -= 10) {

      const output = await sharp(inputBuffer)
        .rotate()                               // fix sideways phone photos
        .flatten({ background: '#ffffff' })     // transparent areas become white
        .resize(width, height, {
          fit: 'inside',                        // keep the original shape
          withoutEnlargement: true              // never stretch small images
        })
        .jpeg({ quality: quality, mozjpeg: true })  // convert to JPG
        .toBuffer();

      // If the file is now 15KB or smaller, we are done
      if (output.length <= MAX_BYTES) {
        return output;
      }
    }

    // Still too big: make the picture 15% smaller and try again
    width = Math.round(width * 0.85);
    height = Math.round(height * 0.85);
  }

  throw new Error('Could not compress this image to ' + settings.MAX_KB + 'KB');
}

module.exports = { compressToJpeg };
