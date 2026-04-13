import { open } from "fs/promises"

export type VideoMagicValidation =
  | { ok: true }
  | { ok: false; reason: string }

const MIN_BYTES = 12

/**
 * Lightweight container sniffing (not a full demux). Rejects obvious non-video uploads
 * that slip past mimetype/extension. Extend with more signatures or AV hooks as needed.
 */
export async function validateUploadedVideoMagicBytes(
  filePath: string
): Promise<VideoMagicValidation> {
  let fh
  try {
    fh = await open(filePath, "r")
    const buf = Buffer.alloc(64)
    const { bytesRead } = await fh.read(buf, 0, 64, 0)
    if (bytesRead < MIN_BYTES) {
      return { ok: false, reason: "Uploaded file is too small to be a valid video." }
    }

    // WebM / Matroska (EBML)
    if (
      buf[0] === 0x1a &&
      buf[1] === 0x45 &&
      buf[2] === 0xdf &&
      buf[3] === 0xa3
    ) {
      return { ok: true }
    }

    // AVI: RIFF....AVI
    if (
      buf.toString("ascii", 0, 4) === "RIFF" &&
      bytesRead >= 12 &&
      buf.toString("ascii", 8, 12) === "AVI "
    ) {
      return { ok: true }
    }

    // ISO BMFF (mp4 / mov / m4v / many phone outputs): ....'ftyp' at offset 4
    if (bytesRead >= 8 && buf.toString("ascii", 4, 8) === "ftyp") {
      return { ok: true }
    }

    // Some writers delay `ftyp` slightly — scan the first chunk
    const scan = buf.subarray(0, bytesRead)
    for (let i = 0; i <= scan.length - 4; i++) {
      if (scan.toString("ascii", i, i + 4) === "ftyp") {
        return { ok: true }
      }
    }

    // MPEG program stream (occasional .mpg)
    if (buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0x01 && buf[3] === 0xba) {
      return { ok: true }
    }

    return {
      ok: false,
      reason:
        "File is not a recognized video container (e.g. MP4, MOV, WebM, MKV, AVI). Re-encode or export as MP4.",
    }
  } catch {
    return { ok: false, reason: "Could not read uploaded file for validation." }
  } finally {
    if (fh) await fh.close().catch(() => {})
  }
}
