import { cp, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

const CATEGORY_NAMES = {
  images: "Images",
  videos: "Videos",
  folders: "Folders",
  screenshots: "Screenshots",
  print3d: "3D Print",
  trash: "Trash",
  others: "Others",
} as const;

type CategoryName = (typeof CATEGORY_NAMES)[keyof typeof CATEGORY_NAMES];
const ALL_CATEGORY_NAMES: CategoryName[] = Object.values(CATEGORY_NAMES);

const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".heic",
  ".gif",
  ".webp",
  ".tif",
  ".tiff",
  ".bmp",
  ".svg",
]);
const VIDEO_EXTENSIONS = new Set([
  ".mp4",
  ".mov",
  ".m4v",
  ".avi",
  ".mkv",
  ".webm",
  ".flv",
  ".wmv",
  ".mpg",
  ".mpeg",
  ".3gp",
  ".mts",
  ".m2ts",
  ".ts",
  ".vob",
  ".ogv",
  ".rm",
  ".rmvb",
  ".f4v",
  ".asf",
  ".divx",
  ".hevc",
  ".h265",
  ".h264",
]);
const PRINT_3D_EXTENSIONS = new Set([
  ".stl",
  ".3mf",
  ".step",
  ".stp",
  ".obj",
  ".gcode",
]);
const SCREENSHOT_PREFIXES = [
  "screen shot ",
  "screenshot ",
  "captura de pantalla ",
];

export interface CleanDesktopOptions {
  desktopDir: string;
  destinationParentDir: string;
  destinationFolderName: string;
  moveInactiveFiles: boolean;
  inactiveDays: number;
  overwrite: boolean;
  openAfter: boolean;
}

export interface FailedItem {
  name: string;
  reason: string;
}

export interface CleanDesktopResult {
  movedCount: number;
  organizedCount: number;
  categoryCounts: Record<CategoryName, number>;
  failedItems: FailedItem[];
  organizationFailures: FailedItem[];
  deskDir: string;
  skippedCount: number;
}

function isCrossDeviceError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "EXDEV"
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

async function moveWithFallback(source: string, target: string): Promise<void> {
  try {
    await rename(source, target);
  } catch (error) {
    if (!isCrossDeviceError(error)) {
      throw error;
    }

    await cp(source, target, { recursive: true, force: true });
    await rm(source, { recursive: true, force: true });
  }
}

function isScreenshotByName(fileName: string): boolean {
  const normalized = fileName.toLowerCase();

  if (normalized.includes("cleanshot")) {
    return true;
  }

  if (
    normalized.includes("screenshot") ||
    normalized.includes("screen shot") ||
    normalized.includes("screenshoot")
  ) {
    return true;
  }

  return SCREENSHOT_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function categorizeFileByRules(fileName: string): CategoryName {
  if (isScreenshotByName(fileName)) {
    return CATEGORY_NAMES.screenshots;
  }

  const extension = path.extname(fileName).toLowerCase();

  if (PRINT_3D_EXTENSIONS.has(extension)) {
    return CATEGORY_NAMES.print3d;
  }

  if (IMAGE_EXTENSIONS.has(extension)) {
    return CATEGORY_NAMES.images;
  }

  if (VIDEO_EXTENSIONS.has(extension)) {
    return CATEGORY_NAMES.videos;
  }

  return CATEGORY_NAMES.others;
}

function createCategoryCounts(): Record<CategoryName, number> {
  return {
    [CATEGORY_NAMES.images]: 0,
    [CATEGORY_NAMES.videos]: 0,
    [CATEGORY_NAMES.folders]: 0,
    [CATEGORY_NAMES.screenshots]: 0,
    [CATEGORY_NAMES.print3d]: 0,
    [CATEGORY_NAMES.trash]: 0,
    [CATEGORY_NAMES.others]: 0,
  };
}

async function isFileInactive(
  filePath: string,
  inactiveDays: number,
): Promise<boolean> {
  if (inactiveDays <= 0) {
    return false;
  }

  const fileStat = await stat(filePath);
  const lastAccessMs =
    Number.isFinite(fileStat.atimeMs) && fileStat.atimeMs > 0
      ? fileStat.atimeMs
      : fileStat.mtimeMs;
  const thresholdMs = inactiveDays * 24 * 60 * 60 * 1000;

  return Date.now() - lastAccessMs >= thresholdMs;
}

async function removeEmptyCategoryFolders(
  deskDir: string,
  categoryNames: CategoryName[],
): Promise<void> {
  for (const categoryName of categoryNames) {
    const categoryDir = path.join(deskDir, categoryName);
    try {
      const entries = await readdir(categoryDir);
      if (entries.length === 0) {
        await rm(categoryDir, { recursive: true, force: true });
      }
    } catch {
      // Ignore missing/inaccessible folders during best-effort cleanup.
    }
  }
}

export async function cleanDesktop(
  options: CleanDesktopOptions,
): Promise<CleanDesktopResult> {
  const deskDir = path.join(
    options.destinationParentDir,
    options.destinationFolderName,
  );
  await mkdir(deskDir, { recursive: true });

  const entries = await readdir(options.desktopDir, { withFileTypes: true });
  const shouldSkipDestinationFolderFromSource =
    path.resolve(options.desktopDir) ===
    path.resolve(options.destinationParentDir);
  const candidates = entries.filter(
    (entry) =>
      entry.name !== "." &&
      entry.name !== ".." &&
      !(
        shouldSkipDestinationFolderFromSource &&
        entry.name === options.destinationFolderName
      ),
  );

  let movedCount = 0;
  let organizedCount = 0;
  let skippedCount = 0;
  const failedItems: FailedItem[] = [];
  const organizationFailures: FailedItem[] = [];
  const categoryCounts = createCategoryCounts();

  for (const entry of candidates) {
    const source = path.join(options.desktopDir, entry.name);
    const target = path.join(deskDir, entry.name);

    try {
      let tempTarget: string | null = null;
      if (options.overwrite) {
        try {
          await stat(target);
          tempTarget = `${target}.raycast-backup-${Date.now()}`;
          await rename(target, tempTarget);
        } catch {
          // Target doesn't exist, no backup needed
        }
      }

      try {
        await moveWithFallback(source, target);
        movedCount += 1;
        if (tempTarget) {
          await rm(tempTarget, { recursive: true, force: true });
        }
      } catch (error) {
        if (tempTarget) {
          await rename(tempTarget, target);
        }
        failedItems.push({
    } catch (error) {
      failedItems.push({
        name: entry.name,
        reason: errorMessage(error),
      });
      skippedCount += 1;
    }
  }

  const categoryFolderSet = new Set<string>(ALL_CATEGORY_NAMES);

  const deskEntries = await readdir(deskDir, { withFileTypes: true });
  const itemsToOrganize = deskEntries.filter(
    (entry) =>
      entry.name !== "." &&
      entry.name !== ".." &&
      !categoryFolderSet.has(entry.name),
  );

  for (const entry of itemsToOrganize) {
    const source = path.join(deskDir, entry.name);
    let category: CategoryName;
    if (entry.isDirectory()) {
      category = CATEGORY_NAMES.folders;
    } else if (
      options.moveInactiveFiles &&
      (await isFileInactive(source, options.inactiveDays))
    ) {
      category = CATEGORY_NAMES.trash;
    } else {
      category = categorizeFileByRules(entry.name);
    }
    const categoryDir = path.join(deskDir, category);
    const target = path.join(categoryDir, entry.name);

    try {
      await mkdir(categoryDir, { recursive: true });

      if (options.overwrite) {
        await rm(target, { recursive: true, force: true });
      }

      await moveWithFallback(source, target);
      organizedCount += 1;
      categoryCounts[category] += 1;
    } catch (error) {
      organizationFailures.push({
        name: entry.name,
        reason: errorMessage(error),
      });
      skippedCount += 1;
    }
  }

  await removeEmptyCategoryFolders(deskDir, ALL_CATEGORY_NAMES);

  if (options.openAfter && movedCount > 0) {
    // `openAfter` is handled by command layer to avoid coupling with Raycast API.
  }

  return {
    movedCount,
    organizedCount,
    categoryCounts,
    failedItems,
    organizationFailures,
    deskDir,
    skippedCount,
  };
}
