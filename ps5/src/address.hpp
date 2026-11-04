#pragma once

#include <string>

namespace utv {

/**
 * The four numbers and the port of a Hub address, as separate fields.
 *
 * The console has no keyboard, so an address cannot be typed character by character. Splitting
 * it into fields means the controller's up and down change one number at a time and left and
 * right move between them, which is fast enough for an address and impossible to get wrong.
 */
struct AddressFields {
  int octet[4] = {192, 168, 0, 19};
  int port = 8095;
};

/** How many fields there are: four numbers then the port. */
inline constexpr int ADDRESS_FIELDS = 5;

/**
 * Reads `http://a.b.c.d[:port]` (and bare `a.b.c.d[:port]`) into fields.
 *
 * Answers false for anything else — a hostname, a missing number, 256, a bad port — and leaves
 * `out` untouched, so a bad address can be reported rather than silently replaced.
 */
bool parseAddress(const std::string& text, AddressFields& out);

/** Writes the fields back as `http://a.b.c.d:port`. */
std::string formatAddress(const AddressFields& fields);

/** A short label for one field, for the drawing code. */
std::string addressFieldText(const AddressFields& fields, int field);

/**
 * Changes one field by `delta`, keeping it in range: a number stays 0..255 and the port
 * 1..65535, and going past either end stops rather than wrapping to a surprising value.
 */
void stepAddressField(AddressFields& fields, int field, int delta);

}  // namespace utv
