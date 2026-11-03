// Tests for the Hub client.
//
// The transport is faked, so each test says exactly what the Hub would have answered. These
// cover the parts that decide what the household sees: which headers go out, how a refusal is
// put into words, and that a damaged answer never crashes the console.
#include "hub.hpp"

#include <cstdio>
#include <string>

#include "test.hpp"

using utv::Hub;
using utv::HttpRequest;
using utv::HttpResponse;
using utv::HttpTransport;
using utv::HubResult;
using utv::PlaybackRequest;
using utv::SavedSession;
using utv::loadSession;
using utv::parseJson;
using utv::saveSession;

namespace {

/** A transport that answers from a list and remembers what it was asked. */
class FakeTransport : public HttpTransport {
 public:
  HttpResponse answer;
  std::vector<HttpRequest> seen;

  HttpResponse send(const HttpRequest& request) override {
    seen.push_back(request);
    return answer;
  }

  /** The value of a header, or an empty string. */
  std::string header(const std::string& name) const {
    if (seen.empty()) return "";
    for (const auto& h : seen.back().headers) {
      if (h.first == name) return h.second;
    }
    return "";
  }
};

HttpResponse answering(int status, const std::string& body) {
  HttpResponse response;
  response.status = status;
  response.body = body;
  return response;
}

}  // namespace

TEST(a_plain_answer_is_ok) {
  FakeTransport transport;
  transport.answer = answering(200, R"({"ok":true})");
  Hub hub(transport);
  hub.setBaseUrl("http://192.168.0.19:8095");
  const HubResult result = hub.health();
  CHECK(result.ok);
  CHECK(result.problem.empty());
  CHECK_EQ(transport.seen.size(), static_cast<size_t>(1));
  CHECK_EQ(transport.seen[0].url, std::string("http://192.168.0.19:8095/api/health"));
}

TEST(the_screen_sends_its_token_and_profile) {
  FakeTransport transport;
  transport.answer = answering(200, "{}");
  Hub hub(transport);
  hub.setBaseUrl("http://hub:8095");
  hub.setDeviceToken("utv_secret");
  hub.setProfileId("kids");
  CHECK(hub.home().ok);
  CHECK_EQ(transport.header("X-Device-Token"), std::string("utv_secret"));
  CHECK_EQ(transport.header("X-Profile"), std::string("kids"));
}

TEST(pairing_needs_no_token_and_keeps_the_one_it_gets) {
  FakeTransport transport;
  transport.answer = answering(200, R"({"token":"utv_new","device":{"id":"d1"}})");
  Hub hub(transport);
  hub.setBaseUrl("http://hub:8095");
  const HubResult result = hub.pairScreen("PlayStation 5");
  CHECK(result.ok);
  CHECK_EQ(hub.deviceToken(), std::string("utv_new"));
  // The request that asks to pair must not carry a token it doesn't have yet.
  CHECK_EQ(transport.header("X-Device-Token"), std::string(""));
  const std::string& body = transport.seen[0].body;
  CHECK(body.find(R"("name":"PlayStation 5")") != std::string::npos);
}

TEST(a_dropped_connection_is_put_into_words) {
  FakeTransport transport;
  HttpResponse timeout;
  timeout.error = "timed out";
  transport.answer = timeout;
  Hub hub(transport);
  const HubResult result = hub.health();
  CHECK(!result.ok);
  CHECK_EQ(result.problem, std::string("The Hub didn't answer. Is it switched on?"));
  CHECK(Hub::unreachable(result));
}

TEST(a_refusal_takes_the_hubs_own_words) {
  FakeTransport transport;
  transport.answer = answering(403, R"({"error":"Pair this screen again."})");
  Hub hub(transport);
  const HubResult result = hub.home();
  CHECK(!result.ok);
  CHECK_EQ(result.problem, std::string("Pair this screen again."));
  // A refusal is not "unreachable": retrying won't help until it pairs again.
  CHECK(!Hub::unreachable(result));
}

TEST(a_refusal_without_words_still_says_something_useful) {
  FakeTransport transport;
  transport.answer = answering(401, "{}");
  Hub hub(transport);
  CHECK(!hub.home().ok);
  CHECK_EQ(hub.home().problem, std::string("The Hub turned that down. Pair this console again."));

  transport.answer = answering(500, "{}");
  CHECK_EQ(hub.home().problem, std::string("The Hub had a problem with that. Try again."));

  transport.answer = answering(418, "{}");
  CHECK_EQ(hub.home().problem, std::string("The Hub answered 418."));
}

TEST(an_html_error_page_is_not_a_crash) {
  FakeTransport transport;
  transport.answer = answering(502, "<html><body>502 Bad Gateway</body></html>");
  Hub hub(transport);
  const HubResult result = hub.home();
  CHECK(!result.ok);
  // The status is still a 5xx, so the household is told to try again rather than shown HTML.
  CHECK_EQ(result.problem, std::string("The Hub had a problem with that. Try again."));
}

TEST(a_healthy_hub_that_says_it_isnt_well_is_a_problem) {
  FakeTransport transport;
  transport.answer = answering(200, R"({"ok":false,"status":"The disk is full"})");
  Hub hub(transport);
  const HubResult result = hub.health();
  CHECK(!result.ok);
  CHECK_EQ(result.problem, std::string("The disk is full"));
}

TEST(a_trailing_slash_in_the_address_is_tidied_away) {
  FakeTransport transport;
  transport.answer = answering(200, "{}");
  Hub hub(transport);
  hub.setBaseUrl("http://192.168.0.19:8095/");
  CHECK(hub.health().ok);
  CHECK_EQ(transport.seen[0].url, std::string("http://192.168.0.19:8095/api/health"));
}

TEST(the_guide_asks_for_the_window_it_needs) {
  FakeTransport transport;
  transport.answer = answering(200, R"({"from":1000,"to":2000,"channels":[],"programmes":{}})");
  Hub hub(transport);
  hub.setBaseUrl("http://hub:8095");
  CHECK(hub.guide(1000, 2000).ok);
  CHECK_EQ(transport.seen[0].url, std::string("http://hub:8095/api/guide?from=1000&to=2000"));
}

TEST(playing_a_title_sends_the_title_and_where_to_start) {
  FakeTransport transport;
  transport.answer = answering(200, R"({"url":"http://x/y.ts","title":"Copper Sky","live":false})");
  Hub hub(transport);
  hub.setBaseUrl("http://hub:8095");
  hub.setDeviceToken("utv_t");
  PlaybackRequest request;
  request.kind = "title";
  request.id = "demo:movie:copper-sky";
  request.start = 2880000;
  const HubResult result = hub.play(request);
  CHECK(result.ok);
  CHECK_EQ(transport.seen[0].method, std::string("POST"));
  CHECK_EQ(transport.seen[0].url, std::string("http://hub:8095/api/play"));
  CHECK(transport.seen[0].body.find("\"start\":2880000") != std::string::npos);
}

TEST(progress_goes_to_the_progress_route) {
  FakeTransport transport;
  transport.answer = answering(200, R"({"ok":true})");
  Hub hub(transport);
  hub.setBaseUrl("http://hub:8095");
  CHECK(hub.progress("title:x", 1000, 2000, "X", "progress", 42).ok);
  CHECK_EQ(transport.seen[0].url, std::string("http://hub:8095/api/progress"));
  CHECK(transport.seen[0].body.find("\"positionMs\":1000") != std::string::npos);
}

TEST(the_session_survives_a_restart) {
  const std::string path = ".hosttest/session-roundtrip.txt";
  SavedSession written;
  written.baseUrl = "http://192.168.0.19:8095";
  written.deviceToken = "utv_secret";
  written.profileId = "family";
  CHECK(saveSession(path, written));
  const SavedSession read = loadSession(path);
  CHECK_EQ(read.baseUrl, written.baseUrl);
  CHECK_EQ(read.deviceToken, written.deviceToken);
  CHECK_EQ(read.profileId, written.profileId);
  std::remove(path.c_str());
}

TEST(a_missing_or_damaged_session_file_is_empty_not_a_crash) {
  const SavedSession missing = loadSession(".hosttest/definitely-not-here.txt");
  CHECK(missing.baseUrl.empty());
  CHECK(missing.deviceToken.empty());

  const std::string path = ".hosttest/session-damaged.txt";
  std::FILE* file = std::fopen(path.c_str(), "wb");
  CHECK(file != nullptr);
  if (file) {
    const char* junk = "{not json";
    std::fwrite(junk, 1, 9, file);
    std::fclose(file);
  }
  const SavedSession damaged = loadSession(path);
  CHECK(damaged.baseUrl.empty());
  std::remove(path.c_str());
}

TEST(a_session_that_cannot_be_written_says_so) {
  SavedSession session;
  session.baseUrl = "http://hub:8095";
  // A directory that doesn't exist: the console's own place exists, but a wrong path must not
  // be reported as saved.
  CHECK(!saveSession(".hosttest/no-such-dir/session.txt", session));
}

int main() { return utvtest::run(); }
