import { beforeEach, describe, expect, it, vi } from "vitest";

// The seam under test is the package's public contract: addUnlockTime must
// dispatch to the correct native implementation, validate inputs, and pass
// through the structured result (added / duplicate / typed failures) without
// the tests reaching into native internals. The native module is mocked at
// the requireNativeModule boundary - the same place the real bridge sits.
const h = vi.hoisted(() => ({
  platform: "android" as string,
  native: {} as Record<string, ReturnType<typeof vi.fn>>,
}));

vi.mock("react-native", () => ({
  Platform: {
    get OS() {
      return h.platform;
    },
  },
}));

vi.mock("expo-modules-core", () => ({
  requireNativeModule: () => h.native,
  requireNativeViewManager: () => {
    throw new Error("no view manager in test");
  },
  EventEmitter: class {
    addListener() {
      return { remove() {} };
    }
  },
}));

vi.mock("react", () => ({ default: { createElement: () => null } }));

import { addUnlockTime, temporaryUnlock } from "../src/index";

function stubNative(name: string, result: unknown) {
  const fn = vi.fn().mockResolvedValue(result);
  h.native[name] = fn;
  return fn;
}

beforeEach(() => {
  for (const key of Object.keys(h.native)) delete h.native[key];
  h.platform = "android";
});

describe("addUnlockTime - Android dispatch", () => {
  it("adds the duration to the remaining budget via addUnlockTimeAndroid", async () => {
    const spy = stubNative("addUnlockTimeAndroid", {
      ok: true,
      status: "added",
      remainingSeconds: 300,
    });

    const result = await addUnlockTime(5, "batch-1");

    expect(spy).toHaveBeenCalledWith(5, "batch-1");
    expect(result).toMatchObject({ ok: true, status: "added", remainingSeconds: 300 });
  });

  it("reports a repeated requestId as a duplicate success, not a second grant", async () => {
    stubNative("addUnlockTimeAndroid", {
      ok: true,
      status: "duplicate",
      remainingSeconds: 300,
    });

    const result = await addUnlockTime(5, "batch-1");

    // The retry is satisfied by the original grant - still ok, but the caller
    // can see no additional time was added.
    expect(result).toMatchObject({ ok: true, status: "duplicate", remainingSeconds: 300 });
  });

  it.each([
    "not_authorized",
    "no_blocked_apps",
    "blocking_inactive",
    "native_error",
  ] as const)("passes through the %s failure", async (status) => {
    stubNative("addUnlockTimeAndroid", { ok: false, status, remainingSeconds: 0 });

    const result = await addUnlockTime(5, "batch-1");

    expect(result).toMatchObject({ ok: false, status });
  });
});

describe("addUnlockTime - iOS dispatch", () => {
  it("calls the iOS addUnlockTime with the same contract", async () => {
    h.platform = "ios";
    const spy = stubNative("addUnlockTime", {
      ok: true,
      status: "added",
      remainingSeconds: 300,
    });

    const result = await addUnlockTime(5, "batch-1");

    expect(spy).toHaveBeenCalledWith(5, "batch-1");
    expect(result).toMatchObject({ ok: true, status: "added", remainingSeconds: 300 });
  });
});

describe("addUnlockTime - validation and failure normalization", () => {
  it.each([0, -5, NaN, Infinity])(
    "returns invalid_request for duration %s without calling native",
    async (duration) => {
      const spy = stubNative("addUnlockTimeAndroid", {
        ok: true,
        status: "added",
        remainingSeconds: 300,
      });

      const result = await addUnlockTime(duration, "batch-1");

      expect(spy).not.toHaveBeenCalled();
      expect(result).toMatchObject({ ok: false, status: "invalid_request" });
    },
  );

  it.each(["", "   "])(
    "returns invalid_request for requestId %j without calling native",
    async (requestId) => {
      const spy = stubNative("addUnlockTimeAndroid", {
        ok: true,
        status: "added",
        remainingSeconds: 300,
      });

      const result = await addUnlockTime(5, requestId);

      expect(spy).not.toHaveBeenCalled();
      expect(result).toMatchObject({ ok: false, status: "invalid_request" });
    },
  );

  it("returns a structured native_error instead of rejecting when the native call throws", async () => {
    h.native.addUnlockTimeAndroid = vi.fn().mockRejectedValue(new Error("boom"));

    const result = await addUnlockTime(5, "batch-1");

    expect(result).toMatchObject({ ok: false, status: "native_error" });
  });

  it("normalizes a missing native implementation to native_error", async () => {
    // Native binary predates the additive API - the function is absent.
    const result = await addUnlockTime(5, "batch-1");

    expect(result).toMatchObject({ ok: false, status: "native_error" });
  });
});

describe("existing replacement operation", () => {
  it("temporaryUnlock still dispatches to the platform implementation unchanged", async () => {
    const spy = stubNative("temporaryUnlockAndroid", undefined);

    const result = await temporaryUnlock(15);

    expect(spy).toHaveBeenCalledWith(15);
    expect(result).toMatchObject({ unlocked: true });
  });
});
