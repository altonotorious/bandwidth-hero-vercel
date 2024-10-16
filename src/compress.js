const sharp = require('sharp');
const redirect = require('./redirect');
const { URL } = require('url');

const sharpenParams = {
  sigma: 1.0,
  flat: 1.0,
  jagged: 0.5
};

// Optimized compress function for limited resources
async function compress(req, res, input) {
  try {
    const format = req.params.webp ? 'avif' : 'jpeg';
    const { quality, grayscale, originSize, url } = req.params;

    const metadata = await sharp(input).metadata();
    const { width, height, pages } = metadata;
    const pixelCount = width * height;

    // Check if the image is animated
    const isAnimated = pages && pages > 1;

    // If animated, force WebP format
    const outputFormat = isAnimated ? 'webp' : format;

    const compressionQuality = adjustCompressionQuality(pixelCount, metadata.size, quality);

    const { tileRows, tileCols, minQuantizer, maxQuantizer, effort } = optimizeAvifParams(width, height);

    let sharpInstance = sharp(input, { animated: isAnimated });

    if (grayscale) {
      sharpInstance = sharpInstance.grayscale();
    }

    if (!isAnimated) {
      // Apply artifact removal for static images before sharpening
      if (outputFormat === 'jpeg' || outputFormat === 'avif') {
        sharpInstance = applyArtifactReduction(sharpInstance, pixelCount);
      }

      if (pixelCount > 500000) { // Apply sharpening for large or detailed images
        sharpInstance = sharpInstance.sharpen(sharpenParams.sigma, sharpenParams.flat, sharpenParams.jagged);
      }
    }

    sharpInstance = sharpInstance.toFormat(outputFormat, {
      quality: compressionQuality,
      alphaQuality: 80,
      smartSubsample: true,
      chromaSubsampling: '4:2:0',
      tileRows: outputFormat === 'avif' ? tileRows : undefined,
      tileCols: outputFormat === 'avif' ? tileCols : undefined,
      minQuantizer: outputFormat === 'avif' ? minQuantizer : undefined,
      maxQuantizer: outputFormat === 'avif' ? maxQuantizer : undefined,
      effort: outputFormat === 'avif' ? effort : undefined,
      loop: isAnimated ? 0 : undefined, // For animated WebP, set loop
    });

    const outputStream = sharpInstance.toBuffer({ resolveWithObject: true });
    const { data: output, info } = await outputStream;

    if (res.headersSent) {
      console.error('Headers already sent, unable to compress the image.');
      return;
    }

    sendImage(res, output, outputFormat, url, originSize, info.size);

  } catch (err) {
    console.error('Error during image compression:', err);
    return redirect(req, res);
  }
}

// Dynamically adjust AVIF parameters for limited resources
function optimizeAvifParams(width, height) {
  const largeImageThreshold = 2000;
  const mediumImageThreshold = 1000;

  let tileRows = 1, tileCols = 1, minQuantizer = 26, maxQuantizer = 48, effort = 4;

  if (width > largeImageThreshold || height > largeImageThreshold) {
    tileRows = 4;
    tileCols = 4;
    minQuantizer = 30;
    maxQuantizer = 50;
    effort = 3;
  } else if (width > mediumImageThreshold || height > mediumImageThreshold) {
    tileRows = 2;
    tileCols = 2;
    minQuantizer = 28;
    maxQuantizer = 48;
    effort = 4;
  }

  return { tileRows, tileCols, minQuantizer, maxQuantizer, effort };
}

// Adjust compression quality based on image size and pixel count
function adjustCompressionQuality(pixelCount, size, quality) {
  // Constants to tweak the curve behavior
  const pixelFactor = 1.5;   // Higher values compress large images more aggressively
  const sizeFactor = 0.002;  // Affects how sensitive compression is to size changes
  const baseQuality = Math.min(quality, 100); // Ensure quality doesn't exceed 100

  // Normalized pixel size factor with logarithmic scaling for smoother quality adjustments
  const pixelSizeScale = Math.log10(Math.max(pixelCount / 1e6, 1));  // Normalizes to ~1 for small images, scales up for larger

  // Calculate a scaling factor based on size
  const sizeScale = Math.log2(Math.max(size / 1e6, 1)); // Normalizes based on file size, logarithmic progression

  // Dynamic quality adjustment with a smooth, continuous function
  let adjustedQuality = baseQuality - (pixelSizeScale * pixelFactor + sizeScale * sizeFactor) * baseQuality;

  // Ensure that quality doesn't drop below a minimum threshold (e.g., 10)
  adjustedQuality = Math.max(adjustedQuality, 40);

  return Math.ceil(adjustedQuality);
}

// Apply artifact reduction before sharpening and compression
function applyArtifactReduction(sharpInstance, pixelCount) {
  if (pixelCount > 1000000) { // Apply denoise only for large images
    sharpInstance = sharpInstance.modulate({
      saturation: 0.9 // Slightly reduce color noise
    }).blur(0.4); // Light blur to reduce compression block artifacts
  } else {
    sharpInstance = sharpInstance.blur(0.3); // Lower blur for smaller images
  }

  return sharpInstance;
}


// Send the compressed image as response
function sendImage(res, data, imgFormat, url, originSize, compressedSize) {
  const filename = encodeURIComponent(new URL(url).pathname.split('/').pop() || 'image') + `.${imgFormat}`;

  res.setHeader('Content-Type', `image/${imgFormat}`);
  res.setHeader('Content-Length', data.length);
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');

  const safeOriginSize = Math.max(originSize, 0);
  res.setHeader('x-original-size', safeOriginSize);
  res.setHeader('x-bytes-saved', Math.max(safeOriginSize - compressedSize, 0));

  res.status(200).end(data);
}

module.exports = compress;
