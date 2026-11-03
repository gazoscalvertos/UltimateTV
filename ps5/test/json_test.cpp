// Tests for the JSON reader and writer.
//
// The Hub is the only source of JSON the console sees, so the interesting cases are the ones
// a real Hub answer contains: unicode in programme titles, numbers that must not become
// "1.000000", nested objects, and damaged answers that must give a message rather than a
// crash.
#include "json.hpp"

#include "test.hpp"

using utv::Json;
using utv::jsonEscape;
using utv::parseJson;
using utv::writeJson;

TEST(reads_a_hub_home_answer) {
  const std::string text =
      R"({"hero":{"id":"demo:movie:copper-sky","name":"Copper Sky","year":2024,"progress":0.375,
           "action":"resume"},"rails":[{"id":"continue","title":"Continue watching",
           "kind":"titles","items":[{"id":"a","name":"A"}]}]})";
  Json parsed;
  std::string error;
  CHECK(parseJson(text, parsed, &error));
  CHECK_EQ(error, std::string(""));
  CHECK(parsed.isObject());
  const Json* hero = parsed.find("hero");
  CHECK(hero != nullptr);
  CHECK_EQ(hero->str("name"), std::string("Copper Sky"));
  CHECK_EQ(hero->integer("year", 0), 2024L);
  CHECK_NEAR(hero->num("progress"), 0.375, 0.0001);
  CHECK_EQ(hero->str("action"), std::string("resume"));
  const auto& rails = parsed.list("rails");
  CHECK_EQ(rails.size(), static_cast<size_t>(1));
  CHECK_EQ(rails[0].str("kind"), std::string("titles"));
  CHECK_EQ(rails[0].list("items").size(), static_cast<size_t>(1));
}

TEST(reads_unicode_and_escapes) {
  // Programme titles in this house include an apostrophe and an em dash, and the Hub escapes
  // neither, so the reader has to take raw UTF-8 as well as \u escapes.
  const std::string text =
      "{\"title\":\"Lakeside Murders\",\"subtitle\":\"The Storm \\u2014 part 2\",\"note\":\"a \\\"quoted\\\" "
      "word\\nand a tab\\there\",\"smile\":\"\\ud83d\\ude00\"}";
  Json parsed;
  std::string error;
  CHECK_MESSAGE(parseJson(text, parsed, &error), error);
  CHECK_EQ(parsed.str("title"), std::string("Lakeside Murders"));
  CHECK_EQ(parsed.str("subtitle"), std::string("The Storm \xe2\x80\x94 part 2"));
  CHECK_EQ(parsed.str("note"), std::string("a \"quoted\" word\nand a tab\there"));
  // A surrogate pair becomes one four-byte character, not two replacement boxes.
  CHECK_EQ(parsed.str("smile"), std::string("\xf0\x9f\x98\x80"));
}

TEST(reads_every_json_type) {
  Json parsed;
  std::string error;
  CHECK_MESSAGE(
      parseJson(R"({"nil":null,"yes":true,"no":false,"whole":7,"fraction":-1.5,"empty":"",)"
                R"("arr":[1,"two",null],"obj":{"a":{}}})",
                parsed, &error),
      error);
  CHECK(parsed.find("nil")->isNull());
  CHECK_EQ(parsed.flag("yes"), true);
  CHECK_EQ(parsed.flag("no", true), false);
  CHECK_EQ(parsed.integer("whole", 0), 7L);
  CHECK_NEAR(parsed.num("fraction"), -1.5, 0.0001);
  CHECK_EQ(parsed.str("empty"), std::string(""));
  CHECK_EQ(parsed.list("arr").size(), static_cast<size_t>(3));
  CHECK_EQ(parsed.list("arr")[1].text, std::string("two"));
  CHECK(parsed.find("obj")->find("a")->isObject());
  // A key that isn't there is nullptr, never a crash.
  CHECK(parsed.find("missing") == nullptr);
  CHECK_EQ(parsed.str("missing", "fallback"), std::string("fallback"));
}

TEST(damaged_answers_give_a_reason_not_a_crash) {
  const char* const damaged[] = {
      "",
      "{",
      "{\"a\":}",
      "{\"a\" 1}",
      "[1,2",
      "not json at all",
      "{\"a\":\"unterminated}",
      "<html><body>502 Bad Gateway</body></html>",
  };
  for (const char* text : damaged) {
    Json parsed;
    std::string error = "untouched";
    CHECK_MESSAGE(!parseJson(text, parsed, &error), std::string("parsed: ") + text);
    CHECK_MESSAGE(!error.empty(), std::string("no reason for: ") + text);
  }
}

TEST(stops_before_a_stack_overflow) {
  // A Hub answering with thousands of nested arrays must give a message, not blow the stack.
  std::string deep;
  for (int i = 0; i < 5000; ++i) deep += '[';
  Json parsed;
  std::string error;
  CHECK(!parseJson(deep, parsed, &error));
  CHECK_MESSAGE(!error.empty(), "deep nesting gave no reason");
}

TEST(writes_whole_numbers_without_a_decimal_point) {
  // `positionMs` and `year` go to the Hub as JSON: "2024.000000" would be read as a string by
  // some parsers, and "1.2e+06" by others.
  Json body = Json::object();
  body.set("year", Json::of(2024L));
  body.set("positionMs", Json::of(static_cast<double>(1200000)));
  body.set("half", Json::of(0.5));
  CHECK_EQ(writeJson(body), std::string(R"({"year":2024,"positionMs":1200000,"half":0.5})"));
}

TEST(writes_objects_in_the_order_they_were_filled) {
  Json body = Json::object();
  body.set("kind", Json::of("channel"));
  body.set("id", Json::of("bbc1"));
  CHECK_EQ(writeJson(body), std::string(R"({"kind":"channel","id":"bbc1"})"));
}

TEST(writes_arrays_and_nesting) {
  Json list = Json::array();
  list.push(Json::of("a"));
  list.push(Json::of(2L));
  Json body = Json::object();
  body.set("items", std::move(list));
  CHECK_EQ(writeJson(body), std::string(R"({"items":["a",2]})"));
}

TEST(setting_a_member_twice_replaces_it) {
  Json body = Json::object();
  body.set("profile", Json::of("family"));
  body.set("profile", Json::of("kids"));
  CHECK_EQ(writeJson(body), std::string(R"({"profile":"kids"})"));
}

TEST(escapes_text_that_would_break_the_json) {
  CHECK_EQ(jsonEscape("a\"b"), std::string("a\\\"b"));
  CHECK_EQ(jsonEscape("line\nbreak"), std::string("line\\nbreak"));
  CHECK_EQ(jsonEscape("tab\there"), std::string("tab\\there"));
  CHECK_EQ(jsonEscape("back\\slash"), std::string("back\\\\slash"));
  // A title with an em dash is legal UTF-8 JSON and must be left alone.
  CHECK_EQ(jsonEscape("The Storm \xe2\x80\x94 part 2"), std::string("The Storm \xe2\x80\x94 part 2"));
}

TEST(a_round_trip_keeps_everything) {
  const std::string text =
      R"({"title":"Quiz Night Live","n":42,"f":-0.25,"t":true,"nil":null,"list":[1,2],"nested":{"k":"v"}})";
  Json parsed;
  std::string error;
  CHECK_MESSAGE(parseJson(text, parsed, &error), error);
  // Member order is the file's order, so the same text comes back out.
  CHECK_EQ(writeJson(parsed), text);
}

TEST(reads_json_with_whitespace_everywhere) {
  Json parsed;
  std::string error;
  CHECK_MESSAGE(parseJson("  {\n\t\"a\" : [ 1 , 2 ] ,\r\n\"b\" : { }  }  ", parsed, &error), error);
  CHECK_EQ(parsed.list("a").size(), static_cast<size_t>(2));
  CHECK(parsed.find("b")->isObject());
}

int main() { return utvtest::run(); }
