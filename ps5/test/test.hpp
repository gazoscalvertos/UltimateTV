// A 120-line test runner, because the console's SDK has no test framework.
//
// Everything here is header-only and the tests are plain functions: a test is a lambda
// registered with TEST(), and CHECK/CHECK_EQ record a failure and carry on so one run shows
// every problem instead of only the first. `make -C ps5 test` builds and runs them on the
// build machine; nothing here is ever compiled into the console app.
#ifndef UTV_TEST_HPP
#define UTV_TEST_HPP

#include <cstdio>
#include <exception>
#include <functional>
#include <sstream>
#include <string>
#include <vector>

namespace utvtest {

struct Case {
  const char* name;
  std::function<void()> body;
};

/** Every registered test, in registration order. */
inline std::vector<Case>& registry() {
  static std::vector<Case> cases;
  return cases;
}

/** Set when a CHECK in the running test failed. */
inline int& failures() {
  static int count = 0;
  return count;
}

/** The name of the test now running, for the failure messages. */
inline const char*& current() {
  static const char* name = "";
  return name;
}

inline void fail(const char* file, int line, const std::string& what) {
  ++failures();
  std::printf("    FAIL %s:%d %s\n", file, line, what.c_str());
}

struct Register {
  Register(const char* name, std::function<void()> body) {
    registry().push_back(Case{name, std::move(body)});
  }
};

/** Runs every registered test and answers the process exit code. */
inline int run() {
  int failed = 0;
  for (const Case& test : registry()) {
    current() = test.name;
    const int before = failures();
    std::printf("  %s ... ", test.name);
    std::fflush(stdout);
    try {
      test.body();
    } catch (const std::exception& e) {
      fail(__FILE__, __LINE__, std::string("threw: ") + e.what());
    } catch (...) {
      fail(__FILE__, __LINE__, "threw something that isn't an exception");
    }
    const bool ok = failures() == before;
    std::printf("%s\n", ok ? "ok" : "FAILED");
    if (!ok) ++failed;
  }
  const int total = static_cast<int>(registry().size());
  std::printf("%d test%s, %d failed\n", total, total == 1 ? "" : "s", failed);
  return failed == 0 ? 0 : 1;
}

/** Turns a value into something printable: strings as themselves, everything else via <<. */
template <typename T>
std::string show(const T& value) {
  std::ostringstream out;
  out << value;
  return out.str();
}

template <>
inline std::string show<std::string>(const std::string& value) {
  return "\"" + value + "\"";
}

template <>
inline std::string show<bool>(const bool& value) {
  return value ? "true" : "false";
}

}  // namespace utvtest

#define TEST(name)                                              \
  static void test_##name();                                    \
  static ::utvtest::Register register_##name(#name, test_##name); \
  static void test_##name()

#define CHECK(condition)                                                        \
  do {                                                                          \
    if (!(condition)) ::utvtest::fail(__FILE__, __LINE__, "expected " #condition); \
  } while (0)

#define CHECK_EQ(actual, expected)                                                                \
  do {                                                                                            \
    const auto& a = (actual);                                                                     \
    const auto& e = (expected);                                                                   \
    if (!(a == e)) {                                                                              \
      ::utvtest::fail(__FILE__, __LINE__,                                                         \
                      ::utvtest::show(a) + " != " + ::utvtest::show(e) + " (" #actual ")");       \
    }                                                                                             \
  } while (0)

#define CHECK_NEAR(actual, expected, tolerance)                                     \
  do {                                                                              \
    const double a = static_cast<double>(actual);                                   \
    const double e = static_cast<double>(expected);                                 \
    if (a < e - (tolerance) || a > e + (tolerance)) {                               \
      ::utvtest::fail(__FILE__, __LINE__,                                           \
                      ::utvtest::show(a) + " is not near " + ::utvtest::show(e));    \
    }                                                                               \
  } while (0)

/** Fails the test with a message, for a case a CHECK can't express. */
#define CHECK_MESSAGE(condition, message) \
  do {                                    \
    if (!(condition)) ::utvtest::fail(__FILE__, __LINE__, (message)); \
  } while (0)

#endif  // UTV_TEST_HPP
