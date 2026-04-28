"use strict";

// All times in this app are interpreted and displayed in South African
// Standard Time (Africa/Johannesburg). SAST is fixed UTC+02:00 with no
// daylight saving, so the conversion is a simple constant offset.
const SAST_TIMEZONE = "Africa/Johannesburg";
const SAST_OFFSET_MINUTES = 120;

const sastFormatter = new Intl.DateTimeFormat("en-ZA", {
  timeZone: SAST_TIMEZONE,
  weekday: "short",
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
});

const sastShortDateFormatter = new Intl.DateTimeFormat("en-ZA", {
  timeZone: SAST_TIMEZONE,
  day: "2-digit",
  month: "short",
  year: "numeric"
});

const sastTimeFormatter = new Intl.DateTimeFormat("en-ZA", {
  timeZone: SAST_TIMEZONE,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
});

function isValidDate(value) {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function toDate(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (value instanceof Date) {
    return isValidDate(value) ? value : null;
  }
  const parsed = new Date(value);
  return isValidDate(parsed) ? parsed : null;
}

// Parse a datetime-local form value (e.g. "2026-04-28T19:07" or
// "2026-04-28T19:07:30") as a SAST wall-clock time, returning a UTC
// Date instance.
function parseSastInputToUtc(value) {
  if (!value) {
    return null;
  }
  const trimmed = String(value).trim();
  const match = trimmed.match(
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/
  );
  if (!match) {
    const fallback = new Date(trimmed);
    return isValidDate(fallback) ? fallback : null;
  }
  const [, y, mo, d, h, mi, s, tz] = match;
  if (tz) {
    const fallback = new Date(trimmed);
    return isValidDate(fallback) ? fallback : null;
  }
  // Treat as SAST wall-clock: subtract SAST offset to land on UTC.
  const utcMs = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    s ? Number(s) : 0
  ) - SAST_OFFSET_MINUTES * 60 * 1000;
  return new Date(utcMs);
}

// Build the parts of a SAST wall-clock time for a UTC Date instance.
function getSastParts(date) {
  const value = toDate(date);
  if (!value) {
    return null;
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SAST_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(value);

  const result = {};
  for (const part of parts) {
    if (part.type !== "literal") {
      result[part.type] = part.value;
    }
  }
  if (result.hour === "24") {
    result.hour = "00";
  }
  return result;
}

// Format a SAST wall-clock string of the form "YYYY-MM-DDTHH:mm",
// suitable for prefilling <input type="datetime-local">.
function formatForDatetimeLocalInput(date) {
  const parts = getSastParts(date);
  if (!parts) {
    return "";
  }
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function formatSastDateTime(date) {
  const value = toDate(date);
  if (!value) {
    return "";
  }
  return sastFormatter.format(value);
}

function formatSastShortDate(date) {
  const value = toDate(date);
  if (!value) {
    return "";
  }
  return sastShortDateFormatter.format(value);
}

function formatSastTime(date) {
  const value = toDate(date);
  if (!value) {
    return "";
  }
  return sastTimeFormatter.format(value);
}

function nowUtc() {
  return new Date();
}

module.exports = {
  SAST_TIMEZONE,
  SAST_OFFSET_MINUTES,
  isValidDate,
  parseSastInputToUtc,
  formatSastDateTime,
  formatSastShortDate,
  formatSastTime,
  formatForDatetimeLocalInput,
  nowUtc
};
