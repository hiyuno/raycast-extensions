import { Toast, getPreferenceValues, showToast, open } from "@raycast/api";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { cleanDesktop } from "./lib/desktop-cleaner";

const execFileAsync = promisify(execFile);

type DesktopSortOption =
  | "name"
  | "kind"
  | "dateLastOpened"
  | "dateAdded"
  | "dateModified"
  | "dateCreated"
  | "size"
  | "tags";

const SORT_BY_APPLESCRIPT_VALUE: Record<DesktopSortOption, string> = {
  name: "name",
  kind: "kind",
  dateLastOpened: "date last opened",
  dateAdded: "date added",
  dateModified: "date modified",
  dateCreated: "date created",
  size: "size",
  tags: "label",
};

interface MountedInstallerVolume {
  imagePath: string;
  device: string;
  mountPoint?: string;
}

interface EjectResult {
  ejected: MountedInstallerVolume[];
  failed: Array<{ volume: MountedInstallerVolume; reason: string }>;
}

function expandUserPath(inputPath: string): string {
  const trimmed = inputPath.trim();
  if (!trimmed) {
    return path.join(os.homedir(), "Desktop");
  }

  if (trimmed === "~") {
    return os.homedir();
  }

  if (trimmed.startsWith("~/")) {
    return path.join(os.homedir(), trimmed.slice(2));
  }

  return trimmed;
}

function parsePreferenceBoolean(value: boolean | string | undefined): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return value.toLowerCase() === "true";
  }

  return false;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function parseInactiveDays(value: string | undefined): number {
  const parsed = Number.parseInt((value ?? "").trim(), 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return 30;
  }

  return parsed;
}

function parseDesktopSortOption(value: string | undefined): DesktopSortOption {
  const allowedOptions = new Set<DesktopSortOption>([
    "name",
    "kind",
    "dateLastOpened",
    "dateAdded",
    "dateModified",
    "dateCreated",
    "size",
    "tags",
  ]);

  if (value && allowedOptions.has(value as DesktopSortOption)) {
    return value as DesktopSortOption;
  }

  return "name";
}

async function applyDesktopSort(sortBy: DesktopSortOption): Promise<void> {
  const arrangementValue = SORT_BY_APPLESCRIPT_VALUE[sortBy];
  const script = `
tell application "Finder"
  set arrangement of desktop to arranged by ${arrangementValue}
end tell
`;

  await execFileAsync("osascript", ["-e", script]);
}

function extractStringValue(
  dictContent: string,
  keyName: string,
): string | undefined {
  const escapedKeyName = keyName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `<key>${escapedKeyName}<\\/key>\\s*<string>([^<]+)<\\/string>`,
  );
  const match = dictContent.match(pattern);
  return match?.[1];
}

function normalizeBaseDevice(devEntry: string): string {
  const match = devEntry.match(/^\/dev\/disk\d+/);
  return match?.[0] ?? devEntry;
}

async function listMountedInstallerVolumes(): Promise<
  MountedInstallerVolume[]
> {
  const { stdout } = await execFileAsync("hdiutil", ["info", "-plist"]);
  const imageDicts = stdout.match(/<dict>[\s\S]*?<\/dict>/g) ?? [];
  const volumes: MountedInstallerVolume[] = [];
  const seenDevices = new Set<string>();

  for (const imageDict of imageDicts) {
    const imagePath = extractStringValue(imageDict, "image-path");
    if (!imagePath || !imagePath.toLowerCase().endsWith(".dmg")) {
      continue;
    }

    const entityDicts = imageDict.match(/<dict>[\s\S]*?<\/dict>/g) ?? [];
    const preferredEntity = entityDicts.find((entity) => {
      const devEntry = extractStringValue(entity, "dev-entry");
      return typeof devEntry === "string" && /^\/dev\/disk\d+$/.test(devEntry);
    });
    const fallbackEntity = entityDicts.find((entity) =>
      extractStringValue(entity, "dev-entry"),
    );
    const selectedEntity = preferredEntity ?? fallbackEntity;

    if (!selectedEntity) {
      continue;
    }

    const devEntry = extractStringValue(selectedEntity, "dev-entry");
    if (!devEntry) {
      continue;
    }

    const baseDevice = normalizeBaseDevice(devEntry);
    if (seenDevices.has(baseDevice)) {
      continue;
    }

    seenDevices.add(baseDevice);
    volumes.push({
      imagePath,
      device: baseDevice,
      mountPoint: extractStringValue(selectedEntity, "mount-point"),
    });
  }

  return volumes;
}

async function ejectMountedInstallerVolumes(): Promise<EjectResult> {
  const volumes = await listMountedInstallerVolumes();
  const result: EjectResult = { ejected: [], failed: [] };

  for (const volume of volumes) {
    try {
      await execFileAsync("diskutil", ["eject", volume.device]);
      result.ejected.push(volume);
      continue;
    } catch (diskutilError) {
      try {
        await execFileAsync("hdiutil", ["detach", volume.device, "-force"]);
        result.ejected.push(volume);
      } catch (detachError) {
        result.failed.push({
          volume,
          reason: `${errorMessage(diskutilError)} | ${errorMessage(detachError)}`,
        });
      }
    }
  }

  return result;
}

export default async function Command() {
  const desktopDir = path.join(os.homedir(), "Desktop");
  const preferences = getPreferenceValues<Preferences.CleanDesktop>();
  const destinationFolderName =
    preferences.destinationFolderName?.trim() || "Desk";
  const destinationParentDir = expandUserPath(
    preferences.destinationParentPath,
  );
  const moveInactiveFiles = parsePreferenceBoolean(
    preferences.moveInactiveFiles,
  );
  const inactiveDays = parseInactiveDays(preferences.inactiveDays);
  const openDestinationAfterClean = parsePreferenceBoolean(
    preferences.openDestinationAfterClean ?? true,
  );
  const desktopSortBy = parseDesktopSortOption(preferences.desktopSortBy);
  const ejectInstallerVolumesAfterClean = parsePreferenceBoolean(
    preferences.ejectInstallerVolumesAfterClean,
  );

  const loadingToast = await showToast({
    style: Toast.Style.Animated,
    title: `Cleaning Desktop into ${destinationFolderName}...`,
  });

  try {
    const result = await cleanDesktop({
      desktopDir,
      destinationParentDir,
      destinationFolderName,
      moveInactiveFiles,
      inactiveDays,
      overwrite: true,
      openAfter: openDestinationAfterClean,
    });

    const totalFailures =
      result.failedItems.length + result.organizationFailures.length;
    const totalChanges = result.movedCount + result.organizedCount;
    try {
      await applyDesktopSort(desktopSortBy);
    } catch {
      // Ignore Finder sort errors: cleaning should still be reported as success.
    }

    let ejectMessage: string | null = null;
    if (ejectInstallerVolumesAfterClean) {
      try {
        const ejectResult = await ejectMountedInstallerVolumes();
        if (ejectResult.failed.length > 0) {
          ejectMessage = `Eject failed for ${ejectResult.failed.length} installer volume(s)`;
        } else if (ejectResult.ejected.length > 0) {
          ejectMessage = `Ejected ${ejectResult.ejected.length} installer volume(s)`;
        }
      } catch {
        ejectMessage = "Could not check mounted installer volumes";
      }
    }

    if (totalChanges === 0 && totalFailures === 0) {
      loadingToast.style = Toast.Style.Success;
      loadingToast.title = "Desktop already clean";
      if (ejectMessage) {
        loadingToast.message = ejectMessage;
      }
      return;
    }

    if (totalFailures === 0) {
      loadingToast.style = Toast.Style.Success;
      loadingToast.title = `Moved ${result.movedCount} and organized ${result.organizedCount} items`;
      if (ejectMessage) {
        loadingToast.message = ejectMessage;
      }
      if (totalChanges > 0 && openDestinationAfterClean) {
        await open(result.deskDir);
      }
      return;
    }

    loadingToast.style = Toast.Style.Failure;
    loadingToast.title = `Moved ${result.movedCount}, organized ${result.organizedCount}, ${totalFailures} failed`;
    loadingToast.message = [
      ...result.failedItems,
      ...result.organizationFailures,
    ]
      .slice(0, 3)
      .map((item) => item.name)
      .join(", ");
    if (ejectMessage) {
      loadingToast.message = [loadingToast.message, ejectMessage]
        .filter(Boolean)
        .join(" | ");
    }

    if (totalChanges > 0 && openDestinationAfterClean) {
      await open(result.deskDir);
    }
  } catch (error) {
    loadingToast.style = Toast.Style.Failure;
    loadingToast.title = "Could not clean Desktop";
    loadingToast.message =
      error instanceof Error ? error.message : String(error);
  }
}
