import { describe, it, expect, vi } from "vitest";
import { upload, setCSRF } from "@/lib/api";

class UploadXHR {
  static instances: UploadXHR[] = [];
  upload = { onprogress: null as null | ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) };
  open = vi.fn();
  setRequestHeader = vi.fn();
  withCredentials = false;
  status = 201;
  responseText = "Created";
  onload = () => {};
  onerror = () => {};
  onabort = () => {};
  send = vi.fn();
  abort = vi.fn(() => this.onabort());
  constructor() { UploadXHR.instances.push(this); }
}
function xhr() { return UploadXHR.instances.at(-1)!; }

describe("upload multipart contract", () => {
  it("puts the collection array before one file and keeps progress, CSRF and credentials", async () => {
    vi.stubGlobal("XMLHttpRequest", UploadXHR);
    setCSRF("upload-csrf");
    const progress = vi.fn();
    const file = new File(["hello"], "file.txt");
    const result = upload(file, ["one", "two", "one"], progress, new AbortController().signal);
    expect(xhr().open).toHaveBeenCalledWith("POST", "/api/v2/files/upload");
    expect(xhr().withCredentials).toBe(true);
    expect(xhr().setRequestHeader).toHaveBeenCalledWith("X-CSRF-Token", "upload-csrf");
    const form = xhr().send.mock.calls[0][0] as FormData;
    expect(Array.from(form.keys())).toEqual(["collectionIds", "files"]);
    expect(form.get("collectionIds")).toBe('["one","two"]');
    expect(form.get("files")).toBe(file);
    xhr().upload.onprogress!({ lengthComputable: true, loaded: 5, total: 10 });
    expect(progress).toHaveBeenCalledWith(50);
    xhr().onload();
    await result;
  });
  it("omits collection metadata for no collections and keeps cancellation", async () => {
    vi.stubGlobal("XMLHttpRequest", UploadXHR);
    const controller = new AbortController();
    const result = upload(new File(["hello"], "file.txt"), [], vi.fn(), controller.signal);
    expect(Array.from((xhr().send.mock.calls[0][0] as FormData).keys())).toEqual(["files"]);
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(xhr().abort).toHaveBeenCalledOnce();
  });
  it("signals session expiration and preserves server errors", async () => {
    vi.stubGlobal("XMLHttpRequest", UploadXHR);
    const expired = vi.fn();
    window.addEventListener("fileshare:session-expired", expired);
    const result = upload(new File(["hello"], "file.txt"), ["one"], vi.fn(), new AbortController().signal);
    xhr().status = 401;
    xhr().responseText = '{"error":"Session expired"}';
    xhr().onload();
    await expect(result).rejects.toThrow("Session expired");
    expect(expired).toHaveBeenCalledOnce();
    window.removeEventListener("fileshare:session-expired", expired);
  });
});
