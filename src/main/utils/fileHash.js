/**
 * File Hashing Utilities
 * Streaming SHA256 hash computation for cloud sync comparison.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const BATCH_SIZE = 20;

/**
 * Compute SHA256 hash of a file via streaming.
 * @param {string} filePath - Absolute path to the file
 * @returns {Promise<string>} Hex-encoded SHA256 hash
 */
function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/**
 * Hash a list of files relative to a base directory.
 * Processes in parallel batches of 20 for performance.
 * @param {string} baseDir - The base directory
 * @param {string[]} relativePaths - Array of relative file paths
 * @returns {Promise<Map<string, string>>} Map of relativePath → hex SHA256 hash
 */
async function hashFiles(baseDir, relativePaths) {
  const results = new Map();
  for (let i = 0; i < relativePaths.length; i += BATCH_SIZE) {
    const batch = relativePaths.slice(i, i + BATCH_SIZE);
    const promises = batch.map(async (relPath) => {
      try {
        const absPath = path.join(baseDir, relPath);
        const h = await hashFile(absPath);
        return { relPath, hash: h };
      } catch {
        return { relPath, hash: null };
      }
    });
    const batchResults = await Promise.all(promises);
    for (const { relPath, hash } of batchResults) {
      if (hash) results.set(relPath, hash);
    }
  }
  return results;
}

module.exports = { hashFile, hashFiles };
