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

test("repro: destinationFolderName path traversal escapes destinationParentDir", async () => {
  await withTempDir(async (root) => {
    const desktopDir = path.join(root, "Desktop");
    const destinationParentDir = path.join(root, "SafeParent");
    const expectedEscapedDir = path.join(root, "Escaped");

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

    assert.equal(result.deskDir, expectedEscapedDir);
    assert.ok(!result.deskDir.startsWith(destinationParentDir + path.sep));
    assert.equal(await readFile(path.join(expectedEscapedDir, "Others", "notes.txt"), "utf8"), "keep me");
  });
});

test("repro: overwrite deletes target before move failure (data loss)", async () => {
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
    await assert.rejects(stat(preexistingTarget), { code: "ENOENT" });
    await access(destinationParentDir);
  });
});
