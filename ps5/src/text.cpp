#include "text.hpp"

#include <cstdio>
#include <ctime>

namespace utv {

namespace {

const char* const WEEKDAYS[] = {"Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"};
const char* const MONTHS[] = {"Jan", "Feb", "Mar", "Apr", "May", "Jun",
                              "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"};

struct Parts {
  int year = 1970;
  int month = 0;
  int day = 1;
  int weekday = 0;
  int hour = 0;
  int minute = 0;
};

/** A local-time breakdown. `gmtime_r` is what the console and the build machine both have. */
Parts partsOf(long ms) {
  Parts parts;
  const std::time_t seconds = static_cast<std::time_t>(ms / 1000);
  std::tm tm {};
  if (::gmtime_r(&seconds, &tm)) {
    parts.year = tm.tm_year + 1900;
    parts.month = tm.tm_mon;
    parts.day = tm.tm_mday;
    parts.weekday = tm.tm_wday;
    parts.hour = tm.tm_hour;
    parts.minute = tm.tm_min;
  }
  return parts;
}

/**
 * Days since the epoch for a calendar date (Howard Hinnant's algorithm).
 *
 * The month is 0-based here (`Parts` carries `tm_mon`), and the algorithm wants a 1-based one,
 * so the +1 is the whole point of the local.
 */
long toDays(long y, long month0, long d) {
  const long m = month0 + 1;
  y -= m <= 2 ? 1 : 0;
  const long era = (y >= 0 ? y : y - 399) / 400;
  const long yoe = y - era * 400;
  const long doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;
  const long doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  // Days from 1970-01-01. Only differences are used, but keeping the real origin means this
  // can be checked against a timestamp by hand.
  return era * 146097 + doe - 719468;
}

/** Whole days from `b` (the reference, "now") to `a` (the moment being labelled). */
long daysBetween(const Parts& a, const Parts& b) {
  return toDays(a.year, a.month, a.day) - toDays(b.year, b.month, b.day);
}

}  // namespace

std::string clockTime(long ms) {
  const Parts parts = partsOf(ms);
  char buf[8];
  std::snprintf(buf, sizeof buf, "%02d:%02d", parts.hour, parts.minute);
  return buf;
}

std::string dayLabel(long ms, long now) {
  const Parts a = partsOf(ms);
  const Parts b = partsOf(now);
  const long days = daysBetween(a, b);
  if (days == 0) return "Today";
  if (days == 1) return "Tomorrow";
  if (days == -1) return "Yesterday";
  char buf[24];
  std::snprintf(buf, sizeof buf, "%s %d %s", WEEKDAYS[a.weekday % 7], a.day, MONTHS[a.month % 12]);
  return buf;
}

std::string seasonEpisode(int season, int episode) {
  if (season <= 0 || episode <= 0) return "";
  char buf[24];
  std::snprintf(buf, sizeof buf, "S%d E%d", season, episode);
  return buf;
}

std::string durationText(long ms) {
  if (ms <= 0) return "";
  const long seconds = (ms + 500) / 1000;
  if (seconds < 60) return std::to_string(seconds) + " s";
  const long minutes = seconds < 60 ? 0 : (seconds + 30) / 60;
  if (minutes < 60) return std::to_string(minutes) + " min";
  const long hours = minutes / 60;
  const long rest = minutes % 60;
  if (rest == 0) return std::to_string(hours) + " h";
  return std::to_string(hours) + " h " + std::to_string(rest) + " min";
}

std::string playTime(long ms) {
  if (ms < 0) ms = 0;
  const long total = ms / 1000;
  const long hours = total / 3600;
  const long minutes = (total % 3600) / 60;
  const long seconds = total % 60;
  // Long enough for the widest a `long` can print plus the colons: GCC can see the size
  // and refuses a buffer it thinks could truncate.
  char buf[48];
  if (hours > 0) {
    std::snprintf(buf, sizeof buf, "%ld:%02ld:%02ld", hours, minutes, seconds);
  } else {
    std::snprintf(buf, sizeof buf, "%ld:%02ld", minutes, seconds);
  }
  return buf;
}

std::string shorten(const std::string& text, size_t max) {
  if (text.size() <= max) return text;
  // The ellipsis itself is three bytes, so it comes out of the budget: the answer is never
  // longer than `max` bytes, which is what the drawing code reserves room for.
  constexpr size_t ELLIPSIS = 3;
  if (max < ELLIPSIS) return std::string();
  size_t cut = max - ELLIPSIS;
  // Never cut in the middle of a UTF-8 character, or the console draws a box.
  while (cut > 0 && (static_cast<unsigned char>(text[cut]) & 0xc0) == 0x80) --cut;
  return text.substr(0, cut) + "\xe2\x80\xa6";
}

}  // namespace utv
