import assert from "node:assert/strict"
import test from "node:test"

import { assistantMessageBodyToText } from "../../lib/openai-assistant-content"

test("assistantMessageBodyToText: plain string", () => {
  assert.equal(
    assistantMessageBodyToText({ content: "  hello  " }),
    "  hello  "
  )
})

test("assistantMessageBodyToText: array of text parts", () => {
  assert.equal(
    assistantMessageBodyToText({
      content: [
        { type: "text", text: '{"hook":' },
        { type: "text", text: '"hi"}' },
      ],
    }),
    '{"hook":"hi"}'
  )
})

test("assistantMessageBodyToText: top-level refusal throws", () => {
  assert.throws(
    () =>
      assistantMessageBodyToText({
        content: null,
        refusal: "nope",
      }),
    /LLM refusal: nope/
  )
})

test("assistantMessageBodyToText: refusal part throws", () => {
  assert.throws(
    () =>
      assistantMessageBodyToText({
        content: [{ type: "refusal", refusal: "policy" }],
      }),
    /LLM refusal: policy/
  )
})
