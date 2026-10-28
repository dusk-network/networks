import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { versionProblem } from "../scripts/check-versions.js";
import { releaseNotes } from "../scripts/release-notes.js";

describe("check-versions", () => {
  it("passes one version on both registries, and its tag", () => {
    assert.equal(versionProblem({ jsr: "0.1.0", npm: "0.1.0" }), null);
    assert.equal(versionProblem({ jsr: "0.1.0", npm: "0.1.0", tag: "v0.1.0" }), null);
  });

  it("says when the registries' versions differ, or the tag names another", () => {
    assert.equal(versionProblem({ jsr: "0.1.1", npm: "0.1.0" }), "package.json has 0.1.0, jsr.json has 0.1.1");
    for (const tag of ["v0.1.1", "0.1.0", "v0.1.0-rc.1", ""]) {
      assert.equal(versionProblem({ jsr: "0.1.0", npm: "0.1.0", tag }), `the tag is ${tag}, the version 0.1.0`, tag);
    }
  });

  it("holds for the repo's own package.json and jsr.json", () => {
    const version = (/** @type {string} */ file) =>
      JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), "utf8")).version;

    assert.equal(versionProblem({ jsr: version("jsr.json"), npm: version("package.json") }), null);
  });
});

describe("release-notes", () => {
  const changelog = [
    "# Changelog",
    "",
    "## [0.2.0] - 2026-11-02",
    "",
    "### Fixed",
    "",
    "- A thing",
    "",
    "## [0.1.10]",
    "",
    "- Ten",
    "",
    "## [0.1.1]",
    "",
    "## [0.1.0]",
    "",
    "### Added",
    "",
    "- The first",
    "",
  ].join("\n");

  it("takes the version's section, up to the next one", () => {
    assert.equal(releaseNotes(changelog, "0.2.0"), "### Fixed\n\n- A thing");
    assert.equal(releaseNotes(changelog, "0.1.0"), "### Added\n\n- The first");
    assert.equal(releaseNotes(changelog, "0.1.10"), "- Ten");
  });

  it("has none for a version without a section, or with an empty one", () => {
    assert.equal(releaseNotes(changelog, "0.3.0"), null);
    assert.equal(releaseNotes(changelog, "0.1.1"), null);
    assert.equal(releaseNotes(changelog, "0.1"), null);
  });

  it("finds the section for the repo's own version", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    const notes = releaseNotes(readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8"), pkg.version);

    assert.match(String(notes), /^### Added/);
  });
});
