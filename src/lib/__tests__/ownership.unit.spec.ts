import { startOfDayIn } from "../date-range"
import {
  classifyPayment,
  environmentOfPayment,
  type OwnershipContext,
  referenceFor,
  sessionIdFromReference,
} from "../ownership"

const live: OwnershipContext = { storeId: "store_01HK", keyEnvironment: "production", ignoreBefore: null }
const test: OwnershipContext = { ...live, keyEnvironment: "sandbox" }
const ours = (over: Record<string, unknown> = {}) => ({
  reference: "HK-payses_01ABC",
  environment: "live",
  created_at: "2026-10-26T10:00:00Z",
  metadata: { medusa_store_id: "store_01HK", medusa_payment_session_id: "payses_01ABC" },
  ...over,
})

describe("classifyPayment", () => {
  it("a payment carrying this store's marker is ours", () => {
    expect(classifyPayment(ours(), live)).toEqual({ ours: true })
  })

  it("another app's payment on the same key (AZPOR-…, no marker) is ignored", () => {
    expect(classifyPayment({ reference: "AZPOR-20261026-0042", environment: "live", metadata: null }, live)).toEqual({
      ours: false,
      reason: "unmarked",
    })
    expect(classifyPayment({ reference: "INV/PORTAL", environment: "live", metadata: { order: "x" } }, live)).toEqual({
      ours: false,
      reason: "unmarked",
    })
  })

  it("another Medusa store on the same key (e.g. staging) is ignored", () => {
    expect(classifyPayment(ours({ metadata: { medusa_store_id: "store_STAGING" } }), live)).toEqual({
      ours: false,
      reason: "other_store",
    })
  })

  it("a test payment while a live key is in use is ignored, and the other way round", () => {
    expect(classifyPayment(ours({ environment: "test" }), live)).toEqual({ ours: false, reason: "environment" })
    expect(classifyPayment(ours({ environment: "sandbox" }), live)).toEqual({ ours: false, reason: "environment" })
    expect(classifyPayment(ours({ environment: "live" }), test)).toEqual({ ours: false, reason: "environment" })
    expect(classifyPayment(ours({ environment: "test" }), test)).toEqual({ ours: true })
    // environment unknown → not decided by mode
    expect(classifyPayment(ours({ environment: undefined }), live)).toEqual({ ours: true })
  })

  it("payments created before the cutoff are ignored", () => {
    const ctx = { ...live, ignoreBefore: new Date("2026-10-26T00:00:00Z") }
    expect(classifyPayment(ours({ created_at: "2026-10-25T23:59:59Z" }), ctx)).toEqual({ ours: false, reason: "before_cutoff" })
    expect(classifyPayment(ours({ created_at: "2026-10-26T00:00:00Z" }), ctx)).toEqual({ ours: true })
  })

  it("payments of plugin 0.1.0/0.1.1 (session id, no marker) need their session checked", () => {
    expect(classifyPayment({ reference: "payses_OLD1", environment: "live", metadata: { medusa_payment_session_id: "payses_OLD1" } }, live)).toEqual({
      ours: "legacy",
      sessionId: "payses_OLD1",
    })
    expect(classifyPayment({ reference: "payses_OLD2", environment: "live" }, live)).toEqual({ ours: "legacy", sessionId: "payses_OLD2" })
  })

  it("mode and cutoff are checked before the marker", () => {
    expect(classifyPayment({ reference: "AZPOR-1", environment: "test" }, live)).toEqual({ ours: false, reason: "environment" })
  })
})

describe("references", () => {
  it("prefix + session id, and the session id is found with any prefix", () => {
    expect(referenceFor("payses_01ABC", "HK-")).toBe("HK-payses_01ABC")
    expect(referenceFor("payses_01ABC")).toBe("payses_01ABC")
    expect(sessionIdFromReference("HK-payses_01ABC")).toBe("payses_01ABC")
    expect(sessionIdFromReference("payses_01ABC")).toBe("payses_01ABC")
    expect(sessionIdFromReference("AZPOR-123")).toBeNull()
    expect(sessionIdFromReference(undefined)).toBeNull()
  })

  it("maps doit.id environments to key modes", () => {
    expect(environmentOfPayment("test")).toBe("sandbox")
    expect(environmentOfPayment("live")).toBe("production")
    expect(environmentOfPayment("weird")).toBeNull()
  })
})

describe("startOfDayIn", () => {
  it("00:00 of a calendar date in the dashboard time zone", () => {
    expect(startOfDayIn("2026-10-26", "Asia/Jakarta").toISOString()).toBe("2026-10-25T17:00:00.000Z")
    expect(startOfDayIn("2026-10-26", "UTC").toISOString()).toBe("2026-10-26T00:00:00.000Z")
    // across a DST change (Europe/Berlin goes back on 25 Oct 2026)
    expect(startOfDayIn("2026-10-25", "Europe/Berlin").toISOString()).toBe("2026-10-24T22:00:00.000Z")
    expect(startOfDayIn("2026-10-26", "Europe/Berlin").toISOString()).toBe("2026-10-25T23:00:00.000Z")
  })
})
