#include "log.hpp"

#include <cstdarg>
#include <cstdio>
#include <ctime>

namespace utv {
namespace {

std::FILE* gLog = nullptr;

}  // namespace

void logTo(const char* path) {
  if (gLog) return;
  if (path && *path) gLog = std::fopen(path, "wb");
}

void logLine(const char* format, ...) {
  char line[512];
  va_list args;
  va_start(args, format);
  std::vsnprintf(line, sizeof(line), format, args);
  va_end(args);

  std::fprintf(stderr, "UltimateTV: %s\n", line);
  if (!gLog) return;

  const std::time_t now = std::time(nullptr);
  std::tm local{};
  localtime_r(&now, &local);
  std::fprintf(gLog, "%02d:%02d:%02d  %s\n", local.tm_hour, local.tm_min, local.tm_sec, line);
  std::fflush(gLog);
}

void logClose() {
  if (!gLog) return;
  std::fclose(gLog);
  gLog = nullptr;
}

}  // namespace utv
