import path from "node:path";
import multer from "multer";
import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env";
import { AppError } from "../utils/errors";

const ALLOWED_EXT = new Set([".csv", ".json"]);
const ALLOWED_MIME = new Set([
  "text/csv",
  "application/csv",
  "application/json",
  "text/plain",
  "application/vnd.ms-excel",
  "application/octet-stream",
]);

const uploader = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 1, fields: 10 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXT.has(ext) || !ALLOWED_MIME.has(file.mimetype)) {
      cb(new AppError(415, "UNSUPPORTED_MEDIA_TYPE", "Only .csv and .json files are accepted"));
      return;
    }
    cb(null, true);
  },
});

export const uploadSingle = (field = "file") => uploader.single(field);

/** Magic-byte / content sniffing: reject binary payloads disguised as text. */
export function sniffTextFile(buf: Buffer, format: "CSV" | "JSON") {
  const head = buf.subarray(0, 4096);
  if (head.includes(0)) throw new AppError(415, "UNSUPPORTED_MEDIA_TYPE", "File appears to be binary");
  const signatures = [[0x50, 0x4b], [0x25, 0x50, 0x44, 0x46], [0x4d, 0x5a], [0x7f, 0x45, 0x4c, 0x46], [0x89, 0x50, 0x4e, 0x47], [0xff, 0xd8, 0xff]];
  for (const sig of signatures) {
    if (sig.every((b, i) => head[i] === b)) throw new AppError(415, "UNSUPPORTED_MEDIA_TYPE", "File content does not match a text format");
  }
  if (format === "JSON") {
    const first = buf.toString("utf8").replace(/^\uFEFF/, "").trimStart()[0];
    if (first !== "[" && first !== "{") throw new AppError(415, "UNSUPPORTED_MEDIA_TYPE", "File is not valid JSON");
  }
}

export function requireFile(req: Request, _res: Response, next: NextFunction) {
  if (!req.file) {
    next(new AppError(400, "BAD_REQUEST", "A file is required (multipart field 'file')"));
    return;
  }
  next();
}
