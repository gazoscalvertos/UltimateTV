#include "address.hpp"

#include "test.hpp"

using utv::ADDRESS_FIELDS;
using utv::AddressFields;
using utv::addressFieldText;
using utv::formatAddress;
using utv::parseAddress;
using utv::stepAddressField;

TEST(reads_the_default_hub_address) {
  AddressFields fields;
  CHECK(parseAddress("http://192.168.0.19:8095", fields));
  CHECK_EQ(fields.octet[0], 192);
  CHECK_EQ(fields.octet[1], 168);
  CHECK_EQ(fields.octet[2], 0);
  CHECK_EQ(fields.octet[3], 19);
  CHECK_EQ(fields.port, 8095);
}

TEST(reads_an_address_with_no_scheme_and_no_port) {
  AddressFields fields;
  CHECK(parseAddress("10.0.0.5", fields));
  CHECK_EQ(fields.octet[0], 10);
  CHECK_EQ(fields.octet[3], 5);
  CHECK_EQ(fields.port, 8095);  // left alone, so a bare address keeps a sensible port
}

TEST(ignores_a_trailing_slash_and_spaces) {
  AddressFields fields;
  CHECK(parseAddress("  http://192.168.1.2:9000/  ", fields));
  CHECK_EQ(fields.octet[3], 2);
  CHECK_EQ(fields.port, 9000);
}

TEST(accepts_the_ends_of_the_range) {
  AddressFields fields;
  CHECK(parseAddress("0.0.0.0:1", fields));
  CHECK_EQ(fields.port, 1);
  CHECK(parseAddress("255.255.255.255:65535", fields));
  CHECK_EQ(fields.octet[0], 255);
  CHECK_EQ(fields.port, 65535);
}

TEST(refuses_anything_that_is_not_an_address) {
  AddressFields fields;
  CHECK(!parseAddress("", fields));
  CHECK(!parseAddress("http://", fields));
  CHECK(!parseAddress("hub.local:8095", fields));   // a name needs a keyboard
  CHECK(!parseAddress("192.168.0", fields));        // too few numbers
  CHECK(!parseAddress("192.168.0.19.5", fields));   // too many
  CHECK(!parseAddress("192.168.0.256", fields));    // out of range
  CHECK(!parseAddress("192.168.0.-1", fields));
  CHECK(!parseAddress("192.168.0.19:0", fields));   // no such port
  CHECK(!parseAddress("192.168.0.19:70000", fields));
  CHECK(!parseAddress("192.168.0.19:80a", fields));
}

TEST(refusing_an_address_leaves_the_fields_alone) {
  AddressFields fields;
  fields.octet[0] = 7;
  fields.port = 1234;
  CHECK(!parseAddress("nonsense", fields));
  CHECK_EQ(fields.octet[0], 7);
  CHECK_EQ(fields.port, 1234);
}

TEST(writes_the_fields_back_as_an_address) {
  AddressFields fields;
  fields.octet[0] = 192;
  fields.octet[1] = 168;
  fields.octet[2] = 4;
  fields.octet[3] = 7;
  fields.port = 8095;
  CHECK_EQ(formatAddress(fields), "http://192.168.4.7:8095");
  CHECK(parseAddress(formatAddress(fields), fields));
}

TEST(labels_each_field) {
  AddressFields fields;
  CHECK_EQ(addressFieldText(fields, 0), "192");
  CHECK_EQ(addressFieldText(fields, 4), "8095");
  CHECK_EQ(ADDRESS_FIELDS, 5);
}

TEST(steps_a_number_up_and_down) {
  AddressFields fields;
  stepAddressField(fields, 2, 1);
  CHECK_EQ(fields.octet[2], 1);
  stepAddressField(fields, 2, -1);
  CHECK_EQ(fields.octet[2], 0);
}

TEST(stops_at_the_ends_rather_than_wrapping) {
  AddressFields fields;
  fields.octet[3] = 255;
  stepAddressField(fields, 3, 1);
  CHECK_EQ(fields.octet[3], 255);
  fields.octet[0] = 0;
  stepAddressField(fields, 0, -1);
  CHECK_EQ(fields.octet[0], 0);
  fields.port = 65535;
  stepAddressField(fields, 4, 10);
  CHECK_EQ(fields.port, 65535);
  fields.port = 1;
  stepAddressField(fields, 4, -10);
  CHECK_EQ(fields.port, 1);
}

TEST(steps_the_port_by_ten_so_a_wrong_port_is_quick_to_fix) {
  AddressFields fields;
  stepAddressField(fields, 4, 10);
  CHECK_EQ(fields.port, 8105);
}

int main() { return utvtest::run(); }
