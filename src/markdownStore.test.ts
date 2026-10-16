import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

class FakeFile {
  stat = { mtime: 1 };
  path: string;
  constructor(path: string) { this.path = path; }
}
class FakeFolder { path: string;
  constructor(path: string) { this.path = path; } }

const storeClass = build({
  entryPoints: [fileURLToPath(new URL("./markdownStore.ts", import.meta.url))],
  bundle: true, write: false, platform: "node", format: "cjs", external: ["obsidian"],
}).then(result => {
  const module = { exports: {} as any };
  vm.runInNewContext(result.outputFiles![0].text, {
    module, exports: module.exports,
    require: (name: string) => {
      assert.equal(name, "obsidian");
      return { TFile: FakeFile, TFolder: FakeFolder, normalizePath: (s: string) => s,
        parseYaml: JSON.parse, stringifyYaml: JSON.stringify };
    },
  });
  return module.exports.MarkdownPlannerStore;
});

async function fixture() {
  const Store = await storeClass;
  const files = new Map<string, FakeFile | FakeFolder>();
  const contents = new Map<string, string>();
  const observations: boolean[] = [];
  let store: any;
  const vault = {
    getAbstractFileByPath: (path: string) => files.get(path) ?? null,
    cachedRead: async (file: FakeFile) => contents.get(file.path),
    createFolder: async (path: string) => {
      files.set(path, new FakeFolder(path));
      observations.push(await store.isSelfAuthoredChange(path));
    },
    create: async (path: string, text: string) => {
      const file = new FakeFile(path);
      files.set(path, file); contents.set(path, text);
      observations.push(await store.isSelfAuthoredChange(file));
      return file;
    },
    modify: async (file: FakeFile, text: string) => {
      contents.set(file.path, text); file.stat.mtime++;
      observations.push(await store.isSelfAuthoredChange(file));
    },
  };
  store = new Store({ vault, metadataCache: {} });
  return { store, files, contents, observations };
}

test("new card and folder events are recognized before writes resolve", async () => {
  const f = await fixture();
  await f.store.createCardFile({ id: "ben_focus_test", title: "synthetic", type: "voucher" });
  assert.ok(f.observations.length > 1);
  assert.ok(f.observations.every(Boolean));
});

test("new schedule events are recognized before writes resolve", async () => {
  const f = await fixture();
  await f.store.createEventFile({ id: "sch_focus_test", date: "2026-10-12" },
    { id: "ben_focus_test", title: "synthetic", type: "voucher", markdownPath: "synthetic.md" });
  assert.ok(f.observations.every(Boolean));
});

test("editing and rollback events retain self-write classification", async () => {
  const f = await fixture();
  const file = new FakeFile("synthetic.md");
  f.files.set(file.path, file); f.contents.set(file.path, "# original\n");
  const backups = new Map<string, string>();
  await f.store.modifyMarkdown(file.path, backups, (frontmatter: any) => ({ frontmatter, body: "# edited\n" }));
  await f.store.rollback(backups, []);
  assert.deepEqual(f.observations, [true, true]);
  assert.equal(f.contents.get(file.path), "# original\n");
});

test("failed writes remove their token and still reject", async () => {
  const f = await fixture();
  await assert.rejects(f.store.selfAuthoredWrite("failed.md", "data", async () => {
    assert.equal(await f.store.isSelfAuthoredChange("failed.md"), true);
    throw new Error("synthetic failure");
  }), /synthetic failure/);
  assert.equal(await f.store.isSelfAuthoredChange("failed.md"), false);
});

test("external content changes are not suppressed by a live self-write token", async () => {
  const f = await fixture();
  const created = await f.store.createCardFile({ id: "ben_focus_test", title: "synthetic", type: "voucher" });
  f.contents.set(created.path, "external edit");
  assert.equal(await f.store.isSelfAuthoredChange(f.files.get(created.path)), false);
});


test("unknown-time flags survive creation and explicit time edits clear them", async () => {
  const f = await fixture();
  const event = { id: "sch_unknown", date: "2026-10-06", start: "", end: "", timeUnknown: true };
  const file = await f.store.createEventFile(event,
    { id: "ben_unknown", type: "voucher", title: "synthetic", markdownPath: "synthetic.md" });
  const read = () => JSON.parse(f.contents.get(file.path)!.split("---\n")[1]);
  assert.equal(read().timeUnknown, true);
  await f.store.updateEventFile(file.path, {...event, start:"10:00",end:"11:00",timeUnknown:false}, new Map());
  assert.equal(read().timeUnknown, false);
  assert.equal(read().start, "10:00");
  assert.equal(read().end, "11:00");
});
