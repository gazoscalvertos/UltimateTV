// A tiny JSON reader and writer.
//
// The Hub speaks JSON and the console has no JSON library in the SDK sysroot, so this is
// ours: a recursive-descent parser that never throws, plus just enough writing to build
// request bodies. It is deliberately small — a few hundred lines — and is tested on the
// host by `make -C ps5 test`, because the console build can only be run on a PS5.
#ifndef UTV_JSON_HPP
#define UTV_JSON_HPP

#include <string>
#include <utility>
#include <vector>

namespace utv {

class Json {
 public:
  enum class Type { Null, Bool, Number, String, Array, Object };

  Type type = Type::Null;
  bool boolean = false;
  double number = 0;
  std::string text;
  std::vector<Json> items;
  std::vector<std::pair<std::string, Json>> members;

  Json() = default;
  static Json null() { return Json(); }
  static Json of(bool v);
  static Json of(double v);
  static Json of(int v) { return of(static_cast<double>(v)); }
  static Json of(long v) { return of(static_cast<double>(v)); }
  static Json of(const std::string& v);
  static Json of(const char* v) { return of(std::string(v)); }
  static Json array();
  static Json object();

  bool isNull() const { return type == Type::Null; }
  bool isObject() const { return type == Type::Object; }
  bool isArray() const { return type == Type::Array; }
  bool isString() const { return type == Type::String; }
  bool isNumber() const { return type == Type::Number; }

  /** Adds a member to an object, replacing an existing one with the same key. */
  Json& set(const std::string& key, Json value);
  /** Appends to an array. */
  Json& push(Json value);
  /** A member, or nullptr when this isn't an object or the key is absent. */
  const Json* find(const std::string& key) const;

  // Convenience readers: they answer the default rather than throwing when the value is
  // missing or is of another type, so a Hub that grows a field never crashes the console.
  std::string str(const std::string& key, const std::string& fallback = "") const;
  double num(const std::string& key, double fallback = 0) const;
  bool flag(const std::string& key, bool fallback = false) const;
  long integer(const std::string& key, long fallback = 0) const;
  /** The array at `key` (`items` when null), which is empty when it isn't an array. */
  const std::vector<Json>& list(const std::string& key) const;
};

/**
 * Parses `text`. On failure answers false and puts a short reason in `error` (with the
 * byte offset) — a Hub serving an error page should give a message, not a crash.
 */
bool parseJson(const std::string& text, Json& out, std::string* error);

/** Writes a compact JSON string. Object members keep the order they were added in. */
std::string writeJson(const Json& value);

/** Escapes `text` for a JSON string (no surrounding quotes). */
std::string jsonEscape(const std::string& text);

}  // namespace utv

#endif  // UTV_JSON_HPP
