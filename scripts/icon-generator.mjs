import { MODULE, LETTERS, log } from './const.mjs';
import { Settings } from './settings.mjs';

const { FilePicker } = foundry.applications.apps;

const ICON_SIZE = 100;
const FILE_EXT = 'webp';
const ACTIVE_SOURCE = 'data';

/**
 * Generates and manages letter icon images for token tags.
 * Draws a colored rounded-rect background with a centered letter.
 */
export class IconGenerator {

  /** Cache-buster counter to force browsers to reload updated icons. */
  static _cacheBuster = Date.now();

  /** Map of letter → actual uploaded file path returned by FilePicker. */
  static _uploadedPaths = new Map();

  /**
   * Bump the cache-buster so that icon URLs are refreshed.
   */
  static refreshImages() {
    this._cacheBuster = Date.now();
  }

  /**
   * Get the directory path where icons are stored in the Foundry data folder.
   * Reads from the iconDirectory setting.
   * @returns {string}
   */
  static getDirectoryPath() {
    return Settings.getIconDirectory();
  }

  /**
   * Get the file name for a letter icon.
   * @param {string} letter
   * @returns {string}
   */
  static getFileName(letter) {
    return `${letter}.${FILE_EXT}`;
  }

  /**
   * Get the full file path (relative to data root) for a letter icon.
   * @param {string} letter
   * @returns {string}
   */
  static getFilePath(letter) {
    return `${this.getDirectoryPath()}/${this.getFileName(letter)}`;
  }

  /**
   * Get the image path for display in img tags (includes cache buster).
   * Uses the actual path returned by FilePicker.upload if available.
   * @param {string} letter
   * @returns {string}
   */
  static getImagePath(letter) {
    const path = this._uploadedPaths.get(letter) ?? this.getFilePath(letter);
    return `${path}?v=${this._cacheBuster}`;
  }

  /**
   * Get the clean file path for use in stored document references (e.g. ActiveEffect.img).
   * No cache buster — returns the raw path suitable for database storage.
   * @param {string} letter
   * @returns {string}
   */
  static getEffectIconPath(letter) {
    return this._uploadedPaths.get(letter) ?? this.getFilePath(letter);
  }

  /**
   * Generate a data URL for a letter icon (for inline display in config UI).
   * Does not require file upload — rendered entirely client-side.
   * @param {string} letter
   * @param {{ bg: string, text: string }} colors
   * @returns {string} data URL
   */
  static generateDataUrl(letter, colors) {
    const iconCanvas = document.createElement('canvas');
    iconCanvas.width = ICON_SIZE;
    iconCanvas.height = ICON_SIZE;
    const ctx = iconCanvas.getContext('2d');
    this._drawRoundedRect(ctx, 10, 10, 80, 80, 30, colors.bg);
    this._drawLetter(ctx, letter, colors.text);
    return iconCanvas.toDataURL('image/png');
  }

  /**
   * Ensure the icon storage directory exists, creating parent directories as needed.
   */
  static async createDirectory() {
    const fullPath = this.getDirectoryPath();
    const segments = fullPath.split('/').filter(Boolean);

    // Create each directory segment in order (e.g. "assets" then "assets/niks-token-tags")
    let currentPath = '';
    for (const segment of segments) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      try {
        await FilePicker.createDirectory(ACTIVE_SOURCE, currentPath);
        log(`Created directory: ${currentPath}`);
      } catch (error) {
        const msg = error.toString();
        if (msg.includes('EEXIST') || msg.includes('already exists') || msg.includes('The S3 key')) {
          // Already exists — fine
        } else {
          throw error;
        }
      }
    }
  }

  /**
   * Generate and save the icon image for a given letter.
   * @param {string} letter - Single uppercase letter
   * @param {{ bg: string, text: string }} colors - Background and text colors
   * @param {boolean} [overwrite=true] - Whether to overwrite existing icons
   */
  static async saveLetterIcon(letter, colors, overwrite = true) {
    if (!overwrite) {
      try {
        const directory = await FilePicker.browse(ACTIVE_SOURCE, this.getDirectoryPath());
        const exists = directory.files.some(f => f.endsWith(`/${this.getFileName(letter)}`) || f === this.getFilePath(letter));
        if (exists) {
          // File already exists — store its path for reference
          const existingPath = directory.files.find(f => f.endsWith(`/${this.getFileName(letter)}`) || f === this.getFilePath(letter));
          if (existingPath) this._uploadedPaths.set(letter, existingPath);
          return;
        }
      } catch (e) {
        // Directory doesn't exist yet — continue to create the icon
      }
    }

    const iconCanvas = document.createElement('canvas');
    iconCanvas.width = ICON_SIZE;
    iconCanvas.height = ICON_SIZE;
    const ctx = iconCanvas.getContext('2d');

    // Draw rounded rectangle background
    this._drawRoundedRect(ctx, 10, 10, 80, 80, 30, colors.bg);

    // Draw letter text
    this._drawLetter(ctx, letter, colors.text);

    // Export and upload
    await this._uploadFromCanvas(iconCanvas, letter);
  }

  /**
   * Generate and save icons for all 26 letters using current settings.
   * @param {boolean} [overwrite=false]
   */
  static async generateAllIcons(overwrite = false) {
    await this.createDirectory();
    const colors = Settings.getColors();
    for (const letter of LETTERS) {
      const letterColors = colors[letter] ?? { bg: '#757575', text: '#FFFFFF' };
      await this.saveLetterIcon(letter, letterColors, overwrite);
    }
    this.refreshImages();

    // Verify uploads by browsing the directory
    try {
      const directory = await FilePicker.browse(ACTIVE_SOURCE, this.getDirectoryPath());
      log(`Icon directory contains ${directory.files.length} files:`, directory.files);
    } catch (e) {
      console.warn(`${MODULE} | Could not browse icon directory after generation:`, e);
    }

    log('All letter icons generated.');
  }

  /**
   * Draw a filled rounded rectangle.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} x
   * @param {number} y
   * @param {number} w
   * @param {number} h
   * @param {number} radius
   * @param {string} fillColor
   */
  static _drawRoundedRect(ctx, x, y, w, h, radius, fillColor) {
    const r = x + w;
    const b = y + h;
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(r - radius, y);
    ctx.quadraticCurveTo(r, y, r, y + radius);
    ctx.lineTo(r, b - radius);
    ctx.quadraticCurveTo(r, b, r - radius, b);
    ctx.lineTo(x + radius, b);
    ctx.quadraticCurveTo(x, b, x, b - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.fillStyle = fillColor;
    ctx.fill();
  }

  /**
   * Draw a centered letter on the canvas.
   * @param {CanvasRenderingContext2D} ctx
   * @param {string} letter
   * @param {string} color
   */
  static _drawLetter(ctx, letter, color) {
    ctx.fillStyle = color;
    const fontName = 'Arial, Helvetica, sans-serif';
    let fontSize = 70;

    // Shrink font until it fits within the icon bounds
    do {
      ctx.font = `bold ${fontSize}px ${fontName}`;
      fontSize--;
    } while (ctx.measureText(letter).width > 70);

    const measure = ctx.measureText(letter);
    const xPos = (ICON_SIZE / 2) + ((measure.actualBoundingBoxLeft - measure.actualBoundingBoxRight) / 2);
    const yPos = (ICON_SIZE / 2) + ((measure.actualBoundingBoxAscent - measure.actualBoundingBoxDescent) / 2);
    ctx.fillText(letter, xPos, yPos);
  }

  /**
   * Convert canvas to blob and upload via FilePicker.
   * Stores the result path for later use.
   * @param {HTMLCanvasElement} iconCanvas
   * @param {string} letter
   */
  static async _uploadFromCanvas(iconCanvas, letter) {
    return new Promise((resolve, reject) => {
      iconCanvas.toBlob(async (blob) => {
        try {
          if (!blob) {
            reject(new Error(`Failed to create blob for letter "${letter}"`));
            return;
          }
          const file = new File([blob], this.getFileName(letter), { type: blob.type });
          const result = await FilePicker.upload(ACTIVE_SOURCE, this.getDirectoryPath(), file, {}, { notify: false });

          // Store the actual path returned by Foundry
          const resultPath = result?.path;
          if (resultPath) {
            this._uploadedPaths.set(letter, resultPath);
            log(`Uploaded icon for letter "${letter}" → path: "${resultPath}"`);
          } else {
            log(`Uploaded icon for letter "${letter}" (no path in result)`);
          }
          resolve();
        } catch (error) {
          console.error(`${MODULE} | Failed to upload icon for letter "${letter}":`, error);
          reject(error);
        }
      }, `image/${FILE_EXT}`);
    });
  }
}
