import { computeSignature, parseSignatureHeader, toRawBody, verifySignature } from "../signature"

const SECRET = "whsec_test_FAKE_Zx81Lq0pRt5uYv3N"
const BODY = '{"id":"evt_1","type":"payment.paid","data":{"id":"pay_1"}}'
const NOW = 1_760_000_000_000
const T = String(NOW / 1000)

function header(t = T, body: string | Buffer = BODY, secret = SECRET) {
  return `t=${t},v1=${computeSignature(secret, t, body)}`
}

describe("parseSignatureHeader", () => {
  it("reads t and every v1", () => {
    expect(parseSignatureHeader("t=1,v1=aa,v1=bb")).toEqual({ t: "1", v1: ["aa", "bb"] })
    expect(parseSignatureHeader(" t=1 , v1=aa ")).toEqual({ t: "1", v1: ["aa"] })
  })

  it("rejects missing or non-numeric parts", () => {
    expect(parseSignatureHeader("v1=aa")).toBeNull()
    expect(parseSignatureHeader("t=1")).toBeNull()
    expect(parseSignatureHeader("t=abc,v1=aa")).toBeNull()
    expect(parseSignatureHeader("garbage")).toBeNull()
  })
})

describe("verifySignature", () => {
  it("accepts a valid signature (string and Buffer body)", () => {
    expect(verifySignature({ rawBody: BODY, header: header(), secret: SECRET, now: NOW })).toEqual({
      valid: true,
      timestamp: NOW / 1000,
    })
    expect(
      verifySignature({ rawBody: Buffer.from(BODY), header: header(), secret: SECRET, now: NOW }).valid
    ).toBe(true)
  })

  it("accepts a body that went through the Redis event bus", () => {
    const serialized = JSON.parse(JSON.stringify(Buffer.from(BODY)))
    expect(verifySignature({ rawBody: serialized, header: header(), secret: SECRET, now: NOW }).valid).toBe(true)
  })

  it("accepts when any of several v1 values matches (secret rotation)", () => {
    const h = `t=${T},v1=${"0".repeat(64)},v1=${computeSignature(SECRET, T, BODY)}`
    expect(verifySignature({ rawBody: BODY, header: h, secret: SECRET, now: NOW }).valid).toBe(true)
  })

  it("rejects a wrong secret or a modified body", () => {
    expect(
      verifySignature({ rawBody: BODY, header: header(T, BODY, "other"), secret: SECRET, now: NOW })
    ).toEqual({ valid: false, reason: "mismatch" })
    expect(
      verifySignature({ rawBody: BODY.replace("pay_1", "pay_2"), header: header(), secret: SECRET, now: NOW })
    ).toEqual({ valid: false, reason: "mismatch" })
  })

  it("rejects a re-serialised body (whitespace differs)", () => {
    const pretty = JSON.stringify(JSON.parse(BODY), null, 2)
    expect(verifySignature({ rawBody: pretty, header: header(), secret: SECRET, now: NOW }).valid).toBe(false)
  })

  it("rejects timestamps more than 300 s away, both directions", () => {
    const old = String(NOW / 1000 - 301)
    const future = String(NOW / 1000 + 301)
    expect(verifySignature({ rawBody: BODY, header: header(old), secret: SECRET, now: NOW })).toEqual({
      valid: false,
      reason: "timestamp_out_of_range",
    })
    expect(verifySignature({ rawBody: BODY, header: header(future), secret: SECRET, now: NOW }).valid).toBe(false)
    const edge = String(NOW / 1000 - 300)
    expect(verifySignature({ rawBody: BODY, header: header(edge), secret: SECRET, now: NOW }).valid).toBe(true)
  })

  it("skips the timestamp check when toleranceSeconds is 0", () => {
    const old = String(NOW / 1000 - 86_400)
    expect(
      verifySignature({ rawBody: BODY, header: header(old), secret: SECRET, now: NOW, toleranceSeconds: 0 }).valid
    ).toBe(true)
  })

  it("rejects missing or broken headers and bodies", () => {
    expect(verifySignature({ rawBody: BODY, header: undefined, secret: SECRET, now: NOW })).toEqual({
      valid: false,
      reason: "missing_header",
    })
    expect(verifySignature({ rawBody: BODY, header: "nonsense", secret: SECRET, now: NOW })).toEqual({
      valid: false,
      reason: "malformed_header",
    })
    expect(verifySignature({ rawBody: undefined, header: header(), secret: SECRET, now: NOW })).toEqual({
      valid: false,
      reason: "missing_body",
    })
  })

  it("rejects digests of a different length or non-hex without throwing", () => {
    const sig = computeSignature(SECRET, T, BODY)
    for (const v1 of [sig.slice(0, 32), sig + "00", "zz".repeat(32), ""]) {
      expect(verifySignature({ rawBody: BODY, header: `t=${T},v1=${v1}`, secret: SECRET, now: NOW }).valid).toBe(false)
    }
  })

  it("uses the first header when several are sent", () => {
    expect(verifySignature({ rawBody: BODY, header: [header(), "bad"], secret: SECRET, now: NOW }).valid).toBe(true)
  })
})

describe("toRawBody", () => {
  it("normalises the shapes Medusa can hand over", () => {
    expect(toRawBody("a")?.toString()).toBe("a")
    expect(toRawBody(Buffer.from("b"))?.toString()).toBe("b")
    expect(toRawBody({ type: "Buffer", data: [99] })?.toString()).toBe("c")
    expect(toRawBody(undefined)).toBeNull()
    expect(toRawBody({ foo: 1 })).toBeNull()
  })
})
