#include "json.hpp"

#include <cmath>
#include <cstdio>
#include <cstdlib>

namespace utv {

Json Json::of(bool v) {
  Json j;
  j.type = Type::Bool;
  j.boolean = v;
  return j;
}

Json Json::of(double v) {
  Json j;
  j.type = Type::Number;
  j.number = v;
  return j;
}

Json Json::of(const std::string& v) {
  Json j;
  j.type = Type::String;
  j.text = v;
  return j;
}

Json Json::array() {
  Json j;
  j.type = Type::Array;
  return j;
}

Json Json::object() {
  Json j;
  j.type = Type::Object;
  return j;
}

Json& Json::set(const std::string& key, Json value) {
  if (type != Type::Object) {
    type = Type::Object;
    items.clear();
  }
  for (auto& m : members) {
    if (m.first == key) {
      m.second = std::move(value);
      return *this;
    }
  }
  members.emplace_back(key, std::move(value));
  return *this;
}

Json& Json::push(Json value) {
  if (type != Type::Array) {
    type = Type::Array;
    members.clear();
  }
  items.push_back(std::move(value));
  return *this;
}

const Json* Json::find(const std::string& key) const {
  if (type != Type::Object) return nullptr;
  for (const auto& m : members) {
    if (m.first == key) return &m.second;
  }
  return nullptr;
}

std::string Json::str(const std::string& key, const std::string& fallback) const {
  const Json* v = find(key);
  return v && v->type == Type::String ? v->text : fallback;
}

double Json::num(const std::string& key, double fallback) const {
  const Json* v = find(key);
  return v && v->type == Type::Number ? v->number : fallback;
}

bool Json::flag(const std::string& key, bool fallback) const {
  const Json* v = find(key);
  return v && v->type == Type::Bool ? v->boolean : fallback;
}

long Json::integer(const std::string& key, long fallback) const {
  const Json* v = find(key);
  if (!v || v->type != Type::Number) return fallback;
  return static_cast<long>(std::llround(v->number));
}

const std::vector<Json>& Json::list(const std::string& key) const {
  static const std::vector<Json> none;
  const Json* v = type == Type::Array && key.empty() ? this : find(key);
  return v && v->type == Type::Array ? v->items : none;
}

namespace {

struct Reader {
  const std::string& text;
  size_t at = 0;
  std::string error;

  explicit Reader(const std::string& t) : text(t) {}

  bool done() const { return at >= text.size(); }
  char peek() const { return at < text.size() ? text[at] : '\0'; }

  void skipSpace() {
    while (at < text.size()) {
      const char c = text[at];
      if (c == ' ' || c == '\t' || c == '\n' || c == '\r') {
        ++at;
      } else {
        break;
      }
    }
  }

  bool fail(const char* why) {
    if (error.empty()) {
      char buf[160];
      std::snprintf(buf, sizeof buf, "%s at byte %zu", why, at);
      error = buf;
    }
    return false;
  }

  bool literal(const char* word) {
    size_t i = 0;
    while (word[i]) {
      if (at >= text.size() || text[at] != word[i]) return fail("unexpected word");
      ++at;
      ++i;
    }
    return true;
  }

  bool hex4(unsigned& out) {
    out = 0;
    for (int i = 0; i < 4; ++i) {
      if (at >= text.size()) return fail("unfinished \\u escape");
      const char c = text[at++];
      out <<= 4;
      if (c >= '0' && c <= '9') {
        out |= static_cast<unsigned>(c - '0');
      } else if (c >= 'a' && c <= 'f') {
        out |= static_cast<unsigned>(c - 'a' + 10);
      } else if (c >= 'A' && c <= 'F') {
        out |= static_cast<unsigned>(c - 'A' + 10);
      } else {
        return fail("bad \\u escape");
      }
    }
    return true;
  }

  static void appendUtf8(std::string& out, unsigned cp) {
    if (cp <= 0x7f) {
      out.push_back(static_cast<char>(cp));
    } else if (cp <= 0x7ff) {
      out.push_back(static_cast<char>(0xc0 | (cp >> 6)));
      out.push_back(static_cast<char>(0x80 | (cp & 0x3f)));
    } else if (cp <= 0xffff) {
      out.push_back(static_cast<char>(0xe0 | (cp >> 12)));
      out.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3f)));
      out.push_back(static_cast<char>(0x80 | (cp & 0x3f)));
    } else {
      out.push_back(static_cast<char>(0xf0 | (cp >> 18)));
      out.push_back(static_cast<char>(0x80 | ((cp >> 12) & 0x3f)));
      out.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3f)));
      out.push_back(static_cast<char>(0x80 | (cp & 0x3f)));
    }
  }

  bool string(std::string& out) {
    out.clear();
    if (peek() != '"') return fail("expected a string");
    ++at;
    while (true) {
      if (at >= text.size()) return fail("unfinished string");
      const char c = text[at++];
      if (c == '"') return true;
      if (c != '\\') {
        out.push_back(c);
        continue;
      }
      if (at >= text.size()) return fail("unfinished escape");
      const char e = text[at++];
      switch (e) {
        case '"': out.push_back('"'); break;
        case '\\': out.push_back('\\'); break;
        case '/': out.push_back('/'); break;
        case 'b': out.push_back('\b'); break;
        case 'f': out.push_back('\f'); break;
        case 'n': out.push_back('\n'); break;
        case 'r': out.push_back('\r'); break;
        case 't': out.push_back('\t'); break;
        case 'u': {
          unsigned cp = 0;
          if (!hex4(cp)) return false;
          // A surrogate pair is two \u escapes; on its own it is not valid text, so it
          // becomes the replacement character rather than mojibake.
          if (cp >= 0xd800 && cp <= 0xdbff) {
            if (at + 1 < text.size() && text[at] == '\\' && text[at + 1] == 'u') {
              const size_t save = at;
              at += 2;
              unsigned low = 0;
              if (hex4(low) && low >= 0xdc00 && low <= 0xdfff) {
                cp = 0x10000 + ((cp - 0xd800) << 10) + (low - 0xdc00);
              } else {
                at = save;
                cp = 0xfffd;
              }
            } else {
              cp = 0xfffd;
            }
          } else if (cp >= 0xdc00 && cp <= 0xdfff) {
            cp = 0xfffd;
          }
          appendUtf8(out, cp);
          break;
        }
        default:
          return fail("unknown escape");
      }
    }
  }

  bool number(Json& out) {
    const size_t start = at;
    if (peek() == '-') ++at;
    while (peek() >= '0' && peek() <= '9') ++at;
    if (peek() == '.') {
      ++at;
      while (peek() >= '0' && peek() <= '9') ++at;
    }
    if (peek() == 'e' || peek() == 'E') {
      ++at;
      if (peek() == '+' || peek() == '-') ++at;
      while (peek() >= '0' && peek() <= '9') ++at;
    }
    if (at == start) return fail("expected a number");
    out.type = Json::Type::Number;
    out.number = std::strtod(text.substr(start, at - start).c_str(), nullptr);
    return true;
  }

  bool value(Json& out, int depth) {
    if (depth > 200) return fail("too deep");
    skipSpace();
    if (done()) return fail("unexpected end");
    const char c = peek();
    if (c == '{') {
      ++at;
      out.type = Json::Type::Object;
      skipSpace();
      if (peek() == '}') {
        ++at;
        return true;
      }
      while (true) {
        skipSpace();
        std::string key;
        if (!string(key)) return false;
        skipSpace();
        if (peek() != ':') return fail("expected a colon");
        ++at;
        Json member;
        if (!value(member, depth + 1)) return false;
        out.set(key, std::move(member));
        skipSpace();
        if (peek() == ',') {
          ++at;
          continue;
        }
        if (peek() == '}') {
          ++at;
          return true;
        }
        return fail("expected a comma or a closing brace");
      }
    }
    if (c == '[') {
      ++at;
      out.type = Json::Type::Array;
      skipSpace();
      if (peek() == ']') {
        ++at;
        return true;
      }
      while (true) {
        Json item;
        if (!value(item, depth + 1)) return false;
        out.push(std::move(item));
        skipSpace();
        if (peek() == ',') {
          ++at;
          continue;
        }
        if (peek() == ']') {
          ++at;
          return true;
        }
        return fail("expected a comma or a closing bracket");
      }
    }
    if (c == '"') {
      out.type = Json::Type::String;
      return string(out.text);
    }
    if (c == 't') {
      if (!literal("true")) return false;
      out.type = Json::Type::Bool;
      out.boolean = true;
      return true;
    }
    if (c == 'f') {
      if (!literal("false")) return false;
      out.type = Json::Type::Bool;
      out.boolean = false;
      return true;
    }
    if (c == 'n') {
      if (!literal("null")) return false;
      out.type = Json::Type::Null;
      return true;
    }
    return number(out);
  }
};

void writeInto(const Json& v, std::string& out, int depth) {
  if (depth > 200) {
    out += "null";
    return;
  }
  switch (v.type) {
    case Json::Type::Null:
      out += "null";
      return;
    case Json::Type::Bool:
      out += v.boolean ? "true" : "false";
      return;
    case Json::Type::Number: {
      // Whole numbers lose the ".0" so ids and durations look like the Hub's own JSON.
      if (std::isfinite(v.number) && v.number == std::floor(v.number) &&
          std::fabs(v.number) < 1e15) {
        char buf[32];
        std::snprintf(buf, sizeof buf, "%lld", static_cast<long long>(v.number));
        out += buf;
      } else {
        char buf[40];
        std::snprintf(buf, sizeof buf, "%.17g", v.number);
        out += buf;
      }
      return;
    }
    case Json::Type::String:
      out += '"';
      out += jsonEscape(v.text);
      out += '"';
      return;
    case Json::Type::Array: {
      out += '[';
      bool first = true;
      for (const auto& item : v.items) {
        if (!first) out += ',';
        first = false;
        writeInto(item, out, depth + 1);
      }
      out += ']';
      return;
    }
    case Json::Type::Object: {
      out += '{';
      bool first = true;
      for (const auto& m : v.members) {
        if (!first) out += ',';
        first = false;
        out += '"';
        out += jsonEscape(m.first);
        out += "\":";
        writeInto(m.second, out, depth + 1);
      }
      out += '}';
      return;
    }
  }
}

}  // namespace

bool parseJson(const std::string& text, Json& out, std::string* error) {
  Reader reader(text);
  Json value;
  if (!reader.value(value, 0)) {
    if (error) *error = reader.error;
    return false;
  }
  reader.skipSpace();
  if (!reader.done()) {
    reader.fail("trailing text after the JSON value");
    if (error) *error = reader.error;
    return false;
  }
  out = std::move(value);
  return true;
}

std::string writeJson(const Json& value) {
  std::string out;
  writeInto(value, out, 0);
  return out;
}

std::string jsonEscape(const std::string& text) {
  std::string out;
  out.reserve(text.size() + 8);
  for (const char c : text) {
    switch (c) {
      case '"': out += "\\\""; break;
      case '\\': out += "\\\\"; break;
      case '\b': out += "\\b"; break;
      case '\f': out += "\\f"; break;
      case '\n': out += "\\n"; break;
      case '\r': out += "\\r"; break;
      case '\t': out += "\\t"; break;
      default:
        if (static_cast<unsigned char>(c) < 0x20) {
          char buf[8];
          std::snprintf(buf, sizeof buf, "\\u%04x", static_cast<unsigned char>(c));
          out += buf;
        } else {
          out.push_back(c);
        }
    }
  }
  return out;
}

}  // namespace utv
