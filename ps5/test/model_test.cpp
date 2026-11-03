// Tests for reading the Hub's answers.
//
// The JSON here is copied from what a real Hub sends (`GET /api/home`, `/api/guide`,
// `/api/play`), so a change on the Hub's side shows up as a failure here rather than as a
// blank screen on the console. Every reader must also survive a Hub that sends less than
// this: a field going missing is a default, never a crash.
#include "model.hpp"

#include <string>

#include "test.hpp"

using utv::Channel;
using utv::GuideWindow;
using utv::HomeScreen;
using utv::PlaybackInfo;
using utv::PlaybackRequest;
using utv::Programme;
using utv::TitleRef;
using utv::guideFromJson;
using utv::homeFromJson;
using utv::parseJson;
using utv::playbackFromJson;
using utv::playbackRequestBody;
using utv::profileFromJson;
using utv::profilesFromJson;
using utv::progressRequestBody;

namespace {

utv::Json mustParse(const char* text) {
  utv::Json value;
  std::string problem;
  const bool ok = parseJson(text, value, &problem);
  CHECK_MESSAGE(ok, "the sample JSON didn't parse: " + problem);
  return value;
}

}  // namespace

TEST(a_profile_carries_its_kind_and_pin) {
  const utv::Json one = mustParse(R"({"id":"kids","name":"Kids","kind":"kids","colour":"#ff0000","hasPin":true})");
  const auto p = profileFromJson(one);
  CHECK_EQ(p.id, std::string("kids"));
  CHECK_EQ(p.name, std::string("Kids"));
  CHECK_EQ(p.kind, std::string("kids"));
  CHECK_EQ(p.colour, std::string("#ff0000"));
  CHECK(p.hasPin);
  CHECK(p.isKids());
}

TEST(a_profile_without_a_kind_is_an_adult) {
  const auto p = profileFromJson(mustParse(R"({"id":"family","name":"Family"})"));
  CHECK_EQ(p.kind, std::string("adult"));
  CHECK(!p.hasPin);
  CHECK(!p.isKids());
}

TEST(the_profile_list_can_be_locked) {
  const auto view = profilesFromJson(mustParse(
      R"({"profiles":[{"id":"family","name":"Family"},{"id":"kids","name":"Kids","kind":"kids"}],"locked":true})"));
  CHECK(view.locked);
  CHECK_EQ(view.profiles.size(), static_cast<size_t>(2));
  CHECK_EQ(view.profiles[1].name, std::string("Kids"));
  CHECK(view.profiles[1].isKids());
}

TEST(a_title_ref_reads_its_progress) {
  const auto t = titleFromJson(mustParse(
      R"({"id":"demo:movie:copper-sky","kind":"movie","name":"Copper Sky","year":2024,"progress":0.375,"poster":"/p.jpg","backdrop":"/b.jpg","subtitle":"2024"})"));
  CHECK_EQ(t.name, std::string("Copper Sky"));
  CHECK_EQ(t.year, static_cast<long>(2024));
  CHECK_EQ(t.poster, std::string("/p.jpg"));
  CHECK_NEAR(t.progress, 0.375, 0.0001);
}

TEST(a_title_without_progress_has_a_negative_one) {
  const auto t = titleFromJson(mustParse(R"({"id":"x","kind":"movie","name":"A Film"})"));
  CHECK(t.progress < 0);
  CHECK_EQ(t.year, static_cast<long>(0));
}

TEST(home_reads_the_hero_and_the_rails) {
  const auto home = homeFromJson(mustParse(R"({
    "hero": {"id":"demo:movie:copper-sky","kind":"movie","name":"Copper Sky","year":2024,
             "progress":0.375,"overview":"A courier with a secret.","action":"resume"},
    "rails": [
      {"id":"continue","title":"Continue watching","kind":"titles",
       "items":[{"id":"a","kind":"movie","name":"A"},{"id":"b","kind":"episode","name":"B"}]},
      {"id":"live","title":"Live now","kind":"channels",
       "items":[],"channels":[{"id":"bbc1","number":101,"name":"BBC One"}]}
    ]})"));
  CHECK(home.hasHero);
  CHECK_EQ(home.hero.name, std::string("Copper Sky"));
  CHECK_EQ(home.heroAction, std::string("resume"));
  CHECK_EQ(home.heroOverview, std::string("A courier with a secret."));
  CHECK_EQ(home.rails.size(), static_cast<size_t>(2));
  CHECK_EQ(home.rails[0].kind, std::string("titles"));
  CHECK_EQ(home.rails[0].titles.size(), static_cast<size_t>(2));
  CHECK_EQ(home.rails[0].titles[1].name, std::string("B"));
  CHECK_EQ(home.rails[1].channels.size(), static_cast<size_t>(1));
  CHECK_EQ(home.rails[1].channels[0].number, static_cast<long>(101));
}

TEST(home_with_no_hero_is_still_usable) {
  const auto home = homeFromJson(mustParse(R"({"rails":[]})"));
  CHECK(!home.hasHero);
  CHECK(home.rails.empty());
}

TEST(the_guide_groups_programmes_under_their_channel) {
  const auto guide = guideFromJson(mustParse(R"({
    "from":1000,"to":2000,
    "channels":[{"id":"bbc1","number":101,"name":"BBC One"},{"id":"film4","number":301,"name":"Film4"}],
    "programmes":{
      "bbc1":[{"id":"p1","channelId":"bbc1","title":"The One Night","start":1000,"end":2000,"isFilm":false}],
      "film4":[{"id":"p2","channelId":"film4","title":"Starfall","start":1000,"end":2000,"isFilm":true}]
    }})"));
  CHECK_EQ(guide.rows.size(), static_cast<size_t>(2));
  CHECK_EQ(guide.rows[0].channel.name, std::string("BBC One"));
  CHECK_EQ(guide.rows[0].programmes.size(), static_cast<size_t>(1));
  CHECK_EQ(guide.rows[0].programmes[0].title, std::string("The One Night"));
  CHECK(!guide.rows[0].programmes[0].isFilm);
  CHECK(guide.rows[1].programmes[0].isFilm);
}

TEST(a_channel_with_nothing_in_this_window_still_gets_a_row) {
  const auto guide = guideFromJson(mustParse(R"({
    "from":1000,"to":2000,
    "channels":[{"id":"bbc1","number":101,"name":"BBC One"}],
    "programmes":{}})"));
  CHECK_EQ(guide.rows.size(), static_cast<size_t>(1));
  CHECK(guide.rows[0].programmes.empty());
  CHECK_EQ(guide.rows[0].channel.number, static_cast<long>(101));
}

TEST(the_guide_opens_on_the_first_channel_with_something_on_now) {
  auto guide = guideFromJson(mustParse(R"({
    "from":1000,"to":4000,
    "channels":[{"id":"a","number":101,"name":"A"},{"id":"b","number":102,"name":"B"}],
    "programmes":{
      "a":[{"id":"p1","channelId":"a","title":"Later","start":3000,"end":4000}],
      "b":[{"id":"p2","channelId":"b","title":"Now","start":1500,"end":2500}]
    }})"));
  CHECK_EQ(guide.pickNow(2000), static_cast<size_t>(1));
}

TEST(the_guide_falls_back_to_the_first_row) {
  const auto guide = guideFromJson(mustParse(R"({
    "from":1000,"to":4000,
    "channels":[{"id":"a","number":101,"name":"A"}],
    "programmes":{"a":[{"id":"p1","channelId":"a","title":"Later","start":3000,"end":4000}]}})"));
  CHECK_EQ(guide.pickNow(1000), static_cast<size_t>(0));
}

TEST(a_play_answer_reads_what_the_player_needs) {
  const auto info = playbackFromJson(mustParse(R"({
    "url":"http://192.168.0.19:8095/stream/abc.ts","title":"Copper Sky","subtitle":"2024",
    "live":false,"startMs":2880000,"durationMs":7680000,"progressKey":"title:demo:movie:copper-sky"})"));
  CHECK_EQ(info.url, std::string("http://192.168.0.19:8095/stream/abc.ts"));
  CHECK_EQ(info.title, std::string("Copper Sky"));
  CHECK(!info.live);
  CHECK_EQ(info.startMs, static_cast<long>(2880000));
  CHECK_EQ(info.durationMs, static_cast<long>(7680000));
  CHECK_EQ(info.progressKey, std::string("title:demo:movie:copper-sky"));
}

TEST(a_channel_answer_is_live) {
  const auto info = playbackFromJson(mustParse(R"({"url":"http://x/y.ts","title":"Quiz Night Live","live":true})"));
  CHECK(info.live);
  CHECK_EQ(info.durationMs, static_cast<long>(0));
}

TEST(the_play_request_body_says_what_to_play) {
  PlaybackRequest req;
  req.kind = "title";
  req.id = "demo:movie:copper-sky";
  req.start = 2880000;
  const std::string body = playbackRequestBody(req);
  CHECK(body.find("\"kind\":\"title\"") != std::string::npos);
  CHECK(body.find("\"id\":\"demo:movie:copper-sky\"") != std::string::npos);
  CHECK(body.find("\"start\":2880000") != std::string::npos);

  PlaybackRequest channel;
  channel.id = "bbc1";
  const std::string live = playbackRequestBody(channel);
  CHECK(live.find("\"kind\":\"channel\"") != std::string::npos);
  // A live channel has no place to start from, and sending start 0 would ask the Hub to seek.
  CHECK(live.find("start") == std::string::npos);
}

TEST(a_progress_report_carries_the_position_and_the_moment) {
  const std::string body =
      progressRequestBody("title:demo:movie:copper-sky", 2880000, 7680000, "Copper Sky", "progress", 1700000000000L);
  CHECK(body.find("\"key\":\"title:demo:movie:copper-sky\"") != std::string::npos);
  CHECK(body.find("\"positionMs\":2880000") != std::string::npos);
  CHECK(body.find("\"durationMs\":7680000") != std::string::npos);
  CHECK(body.find("\"event\":\"progress\"") != std::string::npos);
  CHECK(body.find("\"at\":1700000000000") != std::string::npos);
  CHECK(body.find("\"name\":\"Copper Sky\"") != std::string::npos);
}

TEST(a_bare_progress_report_has_no_event) {
  const std::string body = progressRequestBody("k", 1000, 0, "", "", 0);
  CHECK(body.find("\"positionMs\":1000") != std::string::npos);
  CHECK(body.find("event") == std::string::npos);
  // A report with no duration must not claim one: the Hub would overwrite a real length.
  CHECK(body.find("durationMs") == std::string::npos);
}

int main() { return utvtest::run(); }
