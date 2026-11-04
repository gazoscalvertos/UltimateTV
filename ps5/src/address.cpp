#include "address.hpp"

#include <cctype>
#include <cstdlib>

namespace utv {
namespace {

const char* kPrefix = "http://";

bool allDigits(const std::string& text) {
  if (text.empty()) return false;
  for (const char c : text) {
    if (c < '0' || c > '9') return false;
  }
  return true;
}

/** Reads 0..max into `out`, answering false for anything that isn't a plain number in range. */
bool number(const std::string& text, int max, int& out) {
  if (!allDigits(text)) return false;
  const long value = std::strtol(text.c_str(), nullptr, 10);
  if (value < 0 || value > max) return false;
  out = static_cast<int>(value);
  return true;
}

std::string trim(const std::string& text) {
  size_t begin = 0;
  size_t end = text.size();
  while (begin < end && std::isspace(static_cast<unsigned char>(text[begin]))) ++begin;
  while (end > begin && std::isspace(static_cast<unsigned char>(text[end - 1]))) --end;
  return text.substr(begin, end - begin);
}

}  // namespace

bool parseAddress(const std::string& text, AddressFields& out) {
  std::string rest = trim(text);
  if (rest.compare(0, 7, kPrefix) == 0) rest = rest.substr(7);
  // A trailing slash is harmless.
  while (!rest.empty() && rest.back() == '/') rest.pop_back();
  if (rest.empty()) return false;

  std::string host = rest;
  std::string portText;
  const size_t colon = rest.find(':');
  if (colon != std::string::npos) {
    host = rest.substr(0, colon);
    portText = rest.substr(colon + 1);
  }

  AddressFields fields;
  size_t begin = 0;
  for (int index = 0; index < 4; ++index) {
    const size_t dot = host.find('.', begin);
    const std::string part =
        dot == std::string::npos ? host.substr(begin) : host.substr(begin, dot - begin);
    if (!number(part, 255, fields.octet[index])) return false;
    if (index < 3 && dot == std::string::npos) return false;   // too few numbers
    if (index == 3 && dot != std::string::npos) return false;  // a fifth number
    begin = dot + 1;
  }

  if (!portText.empty()) {
    if (!number(portText, 65535, fields.port) || fields.port < 1) return false;
  }
  out = fields;
  return true;
}

std::string formatAddress(const AddressFields& fields) {
  return std::string(kPrefix) + addressFieldText(fields, 0) + "." + addressFieldText(fields, 1) +
         "." + addressFieldText(fields, 2) + "." + addressFieldText(fields, 3) + ":" +
         addressFieldText(fields, 4);
}

std::string addressFieldText(const AddressFields& fields, int field) {
  if (field >= 0 && field < 4) return std::to_string(fields.octet[field]);
  return std::to_string(fields.port);
}

void stepAddressField(AddressFields& fields, int field, int delta) {
  if (field >= 0 && field < 4) {
    int value = fields.octet[field] + delta;
    // Stopping at the ends is clearer than wrapping: 255 down would otherwise become 0 and
    // look like nothing happened.
    if (value < 0) value = 0;
    if (value > 255) value = 255;
    fields.octet[field] = value;
    return;
  }
  int value = fields.port + delta;
  if (value < 1) value = 1;
  if (value > 65535) value = 65535;
  fields.port = value;
}

}  // namespace utv
