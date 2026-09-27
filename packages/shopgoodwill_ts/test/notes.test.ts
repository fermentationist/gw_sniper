import { test } from "node:test";
import assert from "node:assert/strict";

import { jsonNoteCodec, stringNoteCodec } from "../src/notes.js";

test("jsonNoteCodec parses valid JSON", () => {
  const codec = jsonNoteCodec<{ maxBid: number }>();
  const parsed = codec.parse('{"maxBid": 10.5}');
  assert.deepEqual(parsed, { maxBid: 10.5 });
});

test("jsonNoteCodec returns undefined for free-form text", () => {
  const codec = jsonNoteCodec<{ maxBid: number }>();
  assert.equal(codec.parse("just a note about the item"), undefined);
});

test("jsonNoteCodec returns undefined for empty", () => {
  const codec = jsonNoteCodec<{ maxBid: number }>();
  assert.equal(codec.parse(""), undefined);
  assert.equal(codec.parse("   "), undefined);
});

test("jsonNoteCodec serializes", () => {
  const codec = jsonNoteCodec<{ maxBid: number }>();
  assert.equal(codec.serialize({ maxBid: 12 }), '{"maxBid":12}');
});

test("stringNoteCodec is identity", () => {
  assert.equal(stringNoteCodec.parse("hello"), "hello");
  assert.equal(stringNoteCodec.serialize("hello"), "hello");
});

test("jsonNoteCodec ignores malformed JSON silently", () => {
  const codec = jsonNoteCodec<unknown>();
  assert.equal(codec.parse("{ this: is not json }"), undefined);
});
