import assert from "node:assert/strict";
import test from "node:test";
import { compareCards, matchesExpiry, normalizeSort, cardPlace } from "./cardFilters.ts";
import { extractUiState } from "./markdownAdapter.ts";
test("expiry windows include today and their last day, excluding past and unknown dates", () => {
  for (const end of ["2026-10-22", "2026-10-29"]) assert.equal(matchesExpiry({validTo:end}, "7", "2026-10-22"), true);
  for (const end of ["2026-10-21", "2026-10-30", "", "2026-02-30"]) assert.equal(matchesExpiry({validTo:end}, "7", "2026-10-22"), false);
  assert.equal(matchesExpiry({validTo:"2026-10-21"}, "expired", "2026-10-22"), true);
  assert.equal(matchesExpiry({}, "unknown", "2026-10-22"), true);
});
test("both expiry directions put unknown dates last, place sort groups stores", () => {
  const cards=[{title:"unknown"}, {title:"late",validTo:"2026-11-01"}, {title:"soon",validTo:"2026-10-28"}];
  assert.deepEqual([...cards].sort((a,b)=>compareCards(a,b,"expiryAsc")).map(c=>c.title),["soon","late","unknown"]);
  assert.deepEqual([...cards].sort((a,b)=>compareCards(a,b,"expiryDesc")).map(c=>c.title),["late","soon","unknown"]);
  assert.equal(cardPlace({merchantName:"商家"}), "商家");
  assert.ok(compareCards({location:"盒马",validTo:"2026-10-28"},{location:"盒马",validTo:"2026-11-01"},"place")<0);
  assert.ok(compareCards({}, {location:"盒马"},"place")>0);
});
test("UI preferences survive extraction and legacy UI gets defaults", () => {
  const filters={type:"all",tag:"all",search:"",expiry:"7",place:"盒马",sort:"place"};
  assert.deepEqual(extractUiState({filters}).filters,filters);
  assert.equal(extractUiState({}).filters.sort,"expiryAsc");
  assert.equal(normalizeSort("bad"),"expiryAsc");
});
