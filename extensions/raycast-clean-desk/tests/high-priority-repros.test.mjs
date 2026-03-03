import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { cleanDesktop } from "../src/lib/desktop-cleaner.ts";

async function withTempDir(run) {
  const root = await mkdtemp(path.join(tmpdir(), "clean-desk-repro-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("prevents destinationFolderName path traversal escape", async () => {
  await withTempDir(async (root) => {
    const desktopDir = path.join(root, "Desktop");
    const destinationParentDir = path.join(root, "SafeParent");
    const expectedEscapedDir = path.join(root, "Escaped");
    const expectedSafeDir = path.join(destinationParentDir, "Escaped");

    await mkdir(desktopDir, { recursive: true });
    await mkdir(destinationParentDir, { recursive: true });
    await writeFile(path.join(desktopDir, "notes.txt"), "keep me");

    const result = await cleanDesktop({
      desktopDir,
      destinationParentDir,
      destinationFolderName: "../Escaped",
      moveInactiveFiles: false,
      inactiveDays: 30,
      overwrite: true,
      openAfter: false,
    });

    assert.equal(result.deskDir, expectedSafeDir);
    assert.ok(result.deskDir.startsWith(destinationParentDir + path.sep));
    await assert.rejects(stat(expectedEscapedDir), { code: "ENOENT" });
    assert.equal(await readFile(path.join(expectedSafeDir, "Others", "notes.txt"), "utf8"), "keep me");
  });
});

test("preserves previous target when overwrite move fails", async () => {
  await withTempDir(async (root) => {
    const desktopDir = path.join(root, "Desktop");
    const destinationParentDir = path.join(desktopDir, "sub");
    const deskDir = path.join(destinationParentDir, "Desk");
    const preexistingTarget = path.join(deskDir, "sub", "important.txt");

    await mkdir(path.join(deskDir, "sub"), { recursive: true });
    await writeFile(preexistingTarget, "must survive");

    const result = await cleanDesktop({
      desktopDir,
      destinationParentDir,
      destinationFolderName: "Desk",
      moveInactiveFiles: false,
      inactiveDays: 30,
      overwrite: true,
      openAfter: false,
    });

    assert.ok(result.failedItems.some((item) => item.name === "sub"));
    assert.equal(
      await readFile(path.join(deskDir, "Folders", "sub", "important.txt"), "utf8"),
      "must survive",
    );
    await access(destinationParentDir);
  });
});
