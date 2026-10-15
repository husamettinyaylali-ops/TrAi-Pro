import type { GoogleErrorCode } from "./types";

const GOOGLE_ERRORS = [
  "googleUnavailable",
  "googleCancelled",
  "googleFailed",
  "googleUnverified",
  "googleEmailInUse",
  "googleAlreadyLinked",
] as const satisfies readonly GoogleErrorCode[];

export const isGoogleError = (v: unknown): v is GoogleErrorCode =>
  GOOGLE_ERRORS.includes(v as (typeof GOOGLE_ERRORS)[number]);
