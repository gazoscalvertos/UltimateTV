// Tests for the times and dates the console draws.
//
// These must match what the TV app shows for the same moment (`shared/src/text.ts`), because
// a household reads both screens: 24-hour clock, "Today"/"Tomorrow", and a weekday beyond
// that.
#include "text.hpp"

#include <cstdio>
#include <string>

#include "test.hpp"

using utv::clockTime;
using utv::dayLabel;
using utv::durationText;
using utv::playTime;
using utv::seasonEpisode;
using utv::shorten;

namespace {

/** A UTC timestamp, so the tests don't depend on the build machine's time zone. */
long at(int year, int month, int day, int hour, int minute) {
  // Days since the epoch for a calendar date (Howard Hinnant's algorithm, in days). `month`
  // is 1-based here, which is what the algorithm wants.
  const auto toDays = [](long y, long m, long d) {
    y -= m <= 2 ? 1 : 0;
    const long era = (y >= 0 ? y : y - 399) / 400;
    const long yoe = y - era * 400;
    const long doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;
    const long doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    // Days from 1970-01-01, which is what a timestamp counts from.
    return era * 146097 + doe - 719468;
  };
  const long days = toDays(year, month, day);
  return (days * 86400L + hour * 3600L + minute * 60L) * 1000L;
}

}  // namespace

TEST(the_clock_is_24_hour_and_padded) {
  CHECK_EQ(clockTime(at(2026, 11, 3, 21, 5)), std::string("21:05"));
  CHECK_EQ(clockTime(at(2026, 11, 3, 9, 0)), std::string("09:00"));
  CHECK_EQ(clockTime(at(2026, 11, 3, 0, 0)), std::string("00:00"));
  CHECK_EQ(clockTime(at(2026, 11, 3, 23, 59)), std::string("23:59"));
}

TEST(today_tomorrow_and_yesterday_are_named) {
  const long now = at(2026, 11, 3, 20, 0);
  CHECK_EQ(dayLabel(at(2026, 11, 3, 21, 0), now), std::string("Today"));
  CHECK_EQ(dayLabel(at(2026, 11, 4, 21, 0), now), std::string("Tomorrow"));
  CHECK_EQ(dayLabel(at(2026, 11, 2, 21, 0), now), std::string("Yesterday"));
}

TEST(a_programme_further_out_gets_a_weekday_and_date) {
  const long now = at(2026, 11, 3, 20, 0);
  // 2026-11-07 is a Saturday.
  CHECK_EQ(dayLabel(at(2026, 11, 7, 21, 0), now), std::string("Sat 7 Nov"));
  CHECK_EQ(dayLabel(at(2026, 10, 26, 21, 0), now), std::string("Mon 26 Oct"));
}

TEST(a_day_boundary_is_a_day_even_at_a_minute_past_midnight) {
  const long now = at(2026, 11, 3, 23, 59);
  CHECK_EQ(dayLabel(at(2026, 11, 4, 0, 1), now), std::string("Tomorrow"));
}

TEST(season_and_episode_are_short) {
  CHECK_EQ(seasonEpisode(3, 4), std::string("S3 E4"));
  CHECK_EQ(seasonEpisode(1, 12), std::string("S1 E12"));
  // A film has neither, and an empty string is what the screens skip.
  CHECK_EQ(seasonEpisode(0, 0), std::string(""));
  CHECK_EQ(seasonEpisode(3, 0), std::string(""));
  CHECK_EQ(seasonEpisode(-1, -1), std::string(""));
}

TEST(a_length_of_time_is_in_plain_words) {
  CHECK_EQ(durationText(0), std::string(""));
  CHECK_EQ(durationText(45 * 1000L), std::string("45 s"));
  CHECK_EQ(durationText(61 * 1000L), std::string("1 min"));
  CHECK_EQ(durationText(21 * 60000L), std::string("21 min"));
  CHECK_EQ(durationText(62 * 60000L), std::string("1 h 2 min"));
  CHECK_EQ(durationText(120 * 60000L), std::string("2 h"));
  CHECK_EQ(durationText(128 * 60000L), std::string("2 h 8 min"));
}

TEST(a_position_in_a_film_reads_like_a_player) {
  CHECK_EQ(playTime(0), std::string("0:00"));
  CHECK_EQ(playTime(9000), std::string("0:09"));
  CHECK_EQ(playTime(48 * 60000L + 2000), std::string("48:02"));
  CHECK_EQ(playTime(62 * 60000L + 33000), std::string("1:02:33"));
  // A negative position (a player that hasn't started) must not print "0:-1".
  CHECK_EQ(playTime(-5000), std::string("0:00"));
}

TEST(a_long_title_is_shortened_on_a_character_boundary) {
  CHECK_EQ(shorten("Copper Sky", 40), std::string("Copper Sky"));
  // The ellipsis is three bytes and comes out of the budget, so the answer fits in `max`.
  CHECK_EQ(shorten("Copper Sky", 6), std::string("Cop\xe2\x80\xa6"));
  CHECK_EQ(shorten("Copper Sky", 40).size(), static_cast<size_t>(10));
  CHECK_EQ(shorten("Copper Sky", 6).size(), static_cast<size_t>(6));
  // The em dash is three bytes: cutting inside it would draw a box on the TV.
  const std::string storm = "The Storm \xe2\x80\x94 part 2";
  const std::string cut = shorten(storm, 11);
  CHECK_MESSAGE(cut.size() <= 11, "cut is longer than asked");
  CHECK_EQ(cut.substr(cut.size() - 3), std::string("\xe2\x80\xa6"));
  CHECK(cut.find('\xef') == std::string::npos);
}

int main() { return utvtest::run(); }
