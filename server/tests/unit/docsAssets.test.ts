import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../../..');
const DOCS_DIR = path.resolve(REPO_ROOT, 'docs');
const GUIDE_PATH = path.resolve(DOCS_DIR, 'settlement_notification_cadence_guide.md');

export const REQUIRED_SCREENSHOTS = [
  '01_cadence_timeline_stage_builder.png',
  '02_batch_throttling_settings.png',
  '03_eligibility_suppression_preview.png',
  '04_live_wave_telemetry_controls.png'
];

export const REQUIRED_TUTORIAL_VIDEOS = [
  '05_rolling_cadence_and_throttling_designer.mp4',
  '06_live_wave_telemetry_and_controls.mp4'
];

export const REQUIRED_TUTORIAL_POSTERS = [
  '05_rolling_cadence_and_throttling_designer.jpg',
  '06_live_wave_telemetry_and_controls.jpg'
];

export interface ExtractedMediaReference {
  raw: string;
  cleanPath: string;
  resolvedPath: string;
  sourceFile: string;
  tagType: 'markdown_image' | 'html_img' | 'html_video';
}

/**
 * Extracts all media references (markdown images, HTML img, and video/source tags)
 * from a given markdown file.
 */
export function extractMediaFromMarkdown(filePath: string): ExtractedMediaReference[] {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf-8');
  const baseDir = path.dirname(filePath);
  const references: ExtractedMediaReference[] = [];

  // 1. Standard markdown image: ![alt](path "optional title")
  const mdImgRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = mdImgRegex.exec(content)) !== null) {
    const raw = match[2].trim();
    const clean = raw.split(/\s+/)[0].replace(/^<|>$/g, '').split('?')[0].split('#')[0];
    if (/^(https?:|\/\/|data:)/i.test(clean)) continue;
    const resolvedPath = path.resolve(baseDir, clean.replace(/^file:\/\//, ''));
    references.push({
      raw,
      cleanPath: clean,
      resolvedPath,
      sourceFile: filePath,
      tagType: 'markdown_image'
    });
  }

  // 2. HTML <img> tags: <img ... src="..." ...>
  const htmlImgRegex = /<img\s+[^>]*?src=["']([^"']+)["'][^>]*?>/gi;
  while ((match = htmlImgRegex.exec(content)) !== null) {
    const raw = match[1].trim();
    const clean = raw.split('?')[0].split('#')[0];
    if (/^(https?:|\/\/|data:)/i.test(clean)) continue;
    const resolvedPath = path.resolve(baseDir, clean.replace(/^file:\/\//, ''));
    references.push({
      raw,
      cleanPath: clean,
      resolvedPath,
      sourceFile: filePath,
      tagType: 'html_img'
    });
  }

  // 3. HTML <video> or <source> tags
  const htmlVideoRegex = /<(?:video|source)\s+[^>]*?src=["']([^"']+)["'][^>]*?>/gi;
  while ((match = htmlVideoRegex.exec(content)) !== null) {
    const raw = match[1].trim();
    const clean = raw.split('?')[0].split('#')[0];
    if (/^(https?:|\/\/|data:)/i.test(clean)) continue;
    const resolvedPath = path.resolve(baseDir, clean.replace(/^file:\/\//, ''));
    references.push({
      raw,
      cleanPath: clean,
      resolvedPath,
      sourceFile: filePath,
      tagType: 'html_video'
    });
  }

  return references;
}

describe('Milestone 4: Programmatic Media Asset & Documentation Verification', () => {
  describe('1. Operational UX Guide File Integrity', () => {
    it('1.1 verifies settlement_notification_cadence_guide.md exists and is non-empty', () => {
      expect(fs.existsSync(GUIDE_PATH), `Expected ${GUIDE_PATH} to exist`).toBe(true);
      const stat = fs.statSync(GUIDE_PATH);
      expect(stat.isFile()).toBe(true);
      expect(stat.size).toBeGreaterThan(1000); // Robust documentation should exceed 1KB
    });

    it('1.2 verifies guide contains all required operational UX sections', () => {
      const content = fs.readFileSync(GUIDE_PATH, 'utf-8');
      expect(content).toContain('Executive Summary & Architecture Overview');
      expect(content).toContain('Multi-Stage Settlement Cadence Lifecycle');
      expect(content).toContain('State Transition Model & Claimant Journey');
      expect(content).toContain('Rolling Batch Throttling & Sender Reputation Defense');
      expect(content).toContain('Dynamic Pre-Dispatch Filtering & 3-Layer Suppression Engine');
      expect(content).toContain('Administrative Operational Controls');
      expect(content).toContain('Visual Walkthrough & UI Reference');
    });

    it('1.3 verifies guide documents all 5 cadence stages and 4 localized languages', () => {
      const content = fs.readFileSync(GUIDE_PATH, 'utf-8');
      expect(content).toContain('initial_notice');
      expect(content).toContain('reminder_14d');
      expect(content).toContain('urgent_warning_7d');
      expect(content).toContain('final_notice_48h');
      expect(content).toContain('post_deadline_fallback');
      expect(content).toContain('English (EN)');
      expect(content).toContain('Español (ES)');
      expect(content).toContain('中文 (ZH)');
      expect(content).toContain('Tiếng Việt (VI)');
    });
  });

  describe('2. Embedded Media Asset References & Disk Existence', () => {
    it('2.1 parses markdown and HTML media references in the cadence guide', () => {
      const mediaList = extractMediaFromMarkdown(GUIDE_PATH);
      expect(mediaList.length).toBeGreaterThanOrEqual(8);
    });

    it('2.2 asserts 100% of referenced media assets in cadence guide exist on disk', () => {
      const mediaList = extractMediaFromMarkdown(GUIDE_PATH);
      expect(mediaList.length).toBeGreaterThan(0);

      for (const media of mediaList) {
        const fileExists = fs.existsSync(media.resolvedPath);
        expect(
          fileExists,
          `Referenced media asset not found on disk: "${media.cleanPath}" (resolved to: ${media.resolvedPath}) in ${media.sourceFile}`
        ).toBe(true);
      }
    });

    it('2.3 asserts 100% of referenced media assets have strictly non-zero byte size', () => {
      const mediaList = extractMediaFromMarkdown(GUIDE_PATH);
      expect(mediaList.length).toBeGreaterThan(0);

      for (const media of mediaList) {
        const stat = fs.statSync(media.resolvedPath);
        expect(
          stat.size,
          `Media asset is empty (0 bytes): ${media.resolvedPath}`
        ).toBeGreaterThan(0);
      }
    });
  });

  describe('3. Required Milestone 4 Screenshots Specification', () => {
    it('3.1 verifies all 4 required screenshot filenames are referenced in the guide', () => {
      const content = fs.readFileSync(GUIDE_PATH, 'utf-8');
      for (const screenshotName of REQUIRED_SCREENSHOTS) {
        expect(
          content.includes(screenshotName),
          `Documentation guide must reference required screenshot: ${screenshotName}`
        ).toBe(true);
      }
    });

    it('3.2 verifies all 4 required screenshot files exist in docs/images/ with non-zero size', () => {
      const imagesDir = path.resolve(DOCS_DIR, 'images');
      expect(fs.existsSync(imagesDir), `Expected ${imagesDir} to exist`).toBe(true);

      for (const screenshotName of REQUIRED_SCREENSHOTS) {
        const screenshotPath = path.resolve(imagesDir, screenshotName);
        expect(
          fs.existsSync(screenshotPath),
          `Expected screenshot file to exist: ${screenshotPath}`
        ).toBe(true);

        const stat = fs.statSync(screenshotPath);
        expect(
          stat.size,
          `Screenshot file ${screenshotName} must be non-empty (expected > 1024 bytes)`
        ).toBeGreaterThan(1024);
      }
    });
  });

  describe('4. Required Rolling Cadence Tutorial Videos & Posters (Flows 5 & 6)', () => {
    it('4.1 verifies Flow 5 & Flow 6 tutorial videos and posters are referenced in TRAINING_VIDEOS.md and cadence guide', () => {
      const trainingVideosPath = path.resolve(DOCS_DIR, 'TRAINING_VIDEOS.md');
      expect(fs.existsSync(trainingVideosPath)).toBe(true);
      const trainingContent = fs.readFileSync(trainingVideosPath, 'utf-8');
      const guideContent = fs.readFileSync(GUIDE_PATH, 'utf-8');

      for (const videoName of REQUIRED_TUTORIAL_VIDEOS) {
        expect(trainingContent).toContain(videoName);
        expect(guideContent).toContain(videoName);
      }
      for (const posterName of REQUIRED_TUTORIAL_POSTERS) {
        expect(trainingContent).toContain(posterName);
        expect(guideContent).toContain(posterName);
      }
    });

    it('4.2 verifies Flow 5 & Flow 6 MP4 videos and JPG posters exist on disk with non-zero size', () => {
      const videosDir = path.resolve(DOCS_DIR, 'videos');
      const postersDir = path.resolve(videosDir, 'posters');
      expect(fs.existsSync(videosDir)).toBe(true);
      expect(fs.existsSync(postersDir)).toBe(true);

      for (const videoName of REQUIRED_TUTORIAL_VIDEOS) {
        const videoPath = path.resolve(videosDir, videoName);
        expect(fs.existsSync(videoPath), `Expected video ${videoPath} to exist`).toBe(true);
        const stat = fs.statSync(videoPath);
        expect(stat.size).toBeGreaterThan(100_000);
      }

      for (const posterName of REQUIRED_TUTORIAL_POSTERS) {
        const posterPath = path.resolve(postersDir, posterName);
        expect(fs.existsSync(posterPath), `Expected poster ${posterPath} to exist`).toBe(true);
        const stat = fs.statSync(posterPath);
        expect(stat.size).toBeGreaterThan(10_000);
      }
    });
  });
});
