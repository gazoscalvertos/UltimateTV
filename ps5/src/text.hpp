// Times and dates on the console.
//
// The Hub sends milliseconds since the epoch and the console draws them. These are the same
// rules the TV app uses (`shared/src/text.ts`), so a programme is called the same thing on
// both: 24-hour clock, "Today"/"Tomorrow", and a short weekday beyond that.
#ifndef UTV_TEXT_HPP
#define UTV_TEXT_HPP

#include <string>

namespace utv {

/** "21:05" — the 24-hour clock the whole app uses. */
std::string clockTime(long ms);
/** "Today", "Tomorrow", "Yesterday", "Sat 26 Oct". */
std::string dayLabel(long ms, long now);
/** "S3 E4", or empty when either is missing. */
std::string seasonEpisode(int season, int episode);
/** "1 h 2 min", "21 min", "45 s" — a length of time in plain words. */
std::string durationText(long ms);
/** "48:02" / "1:02:33" — a position in a film, as the player's on-screen time. */
std::string playTime(long ms);
/** Trims to `max` bytes on a character boundary and adds an ellipsis (a UTF-8 "…"). */
std::string shorten(const std::string& text, size_t max);

}  // namespace utv

#endif  // UTV_TEXT_HPP
